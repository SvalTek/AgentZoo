/**
 * WebSocket endpoint for the runtime-host service.
 *
 * One connection per runtime container. The client must send a `hello` with the
 * per-container token and protocol version before any operation. Requests are
 * multiplexed; `fs.watch` subscriptions push coalesced events until they are
 * cancelled or the connection closes.
 */

import {
  decodeBinaryFrame,
  DEFAULT_PORT,
  encodeBinaryFrame,
  HelloSchema,
  HELPER_VERSION,
  HostError,
  type HostErrorCode,
  MAX_REQUEST_BYTES,
  PROTOCOL_VERSION,
  RequestSchema,
  type ServerMessage,
  SubscribeSchema,
  type SubscriptionEvent,
  UnsubscribeSchema,
} from "./protocol.ts";
import { executeOperation, startAgentWatch } from "./operations.ts";
import { UploadManager } from "./uploads.ts";
import type { WatchHandle } from "./watch.ts";

const MAX_SUBSCRIPTIONS = 64;
/** Bytes of request payload one connection may buffer at once. */
const MAX_BUFFERED_PAYLOAD_BYTES = 4 * 1_048_576;

export interface RuntimeHostServerOptions {
  readonly agentsRoot: string;
  readonly token: string;
  readonly port?: number;
}

export interface RuntimeHostServer {
  readonly port: number;
  close(): Promise<void>;
}

function unauthorized(message: string): ServerMessage {
  return { ok: false, error: { code: "unauthorized", message } };
}

function invalidRequest(message: string): ServerMessage {
  return { ok: false, error: { code: "invalid_request", message } };
}

function failureForSubscription(
  sub: string,
  error: unknown,
): ServerMessage {
  const code: HostErrorCode = error instanceof HostError
    ? error.code
    : "internal";
  return {
    ok: false,
    sub,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function failure(id: string | undefined, error: unknown): ServerMessage {
  const code: HostErrorCode = error instanceof HostError
    ? error.code
    : "internal";
  return {
    ok: false,
    ...(id === undefined ? {} : { id }),
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function logFailure(
  op: string,
  agent: string | undefined,
  error: unknown,
): void {
  const code = error instanceof HostError ? error.code : "internal";
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[${new Date().toISOString()}] ${op} agent=${
      agent ?? "-"
    } code=${code}: ${message}`,
  );
  if (!(error instanceof HostError) && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}

export function createRuntimeHostServer(
  options: RuntimeHostServerOptions,
): RuntimeHostServer {
  let sequence = 0;
  const server = Deno.serve({
    hostname: "0.0.0.0",
    port: options.port ?? DEFAULT_PORT,
    onListen: () => {},
  }, (request) => {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }
    const { socket, response } = Deno.upgradeWebSocket(request);
    const context = { agentsRoot: options.agentsRoot };
    const uploads = new UploadManager(options.agentsRoot);
    const subscriptions = new Map<string, WatchHandle>();
    let subscriptionCount = 0;
    let bufferedPayloadBytes = 0;
    // Request payloads arrive as binary frames before the JSON request that
    // names their sequence. Bound the map so an abandoned payload cannot grow
    // memory without limit.
    const payloads = new Map<number, Uint8Array>();
    let authorized = false;

    const send = (message: ServerMessage) =>
      socket.send(JSON.stringify(message));

    const closeSubscriptions = () => {
      for (const handle of subscriptions.values()) handle.close();
      subscriptions.clear();
      subscriptionCount = 0;
    };

    const dropPayload = (sequence: number) => {
      const payload = payloads.get(sequence);
      if (payload === undefined) return;
      payloads.delete(sequence);
      bufferedPayloadBytes -= payload.length;
    };

    const clearPayloads = () => {
      payloads.clear();
      bufferedPayloadBytes = 0;
    };

    const handleSubscribe = async (message: unknown): Promise<boolean> => {
      const subscribe = SubscribeSchema.safeParse(message);
      if (!subscribe.success) return false;
      const { sub, agent, params } = subscribe.data;
      if (subscriptionCount >= MAX_SUBSCRIPTIONS) {
        send(failureForSubscription(
          sub,
          new HostError(
            "watch_limit",
            `at most ${MAX_SUBSCRIPTIONS} subscriptions are allowed`,
          ),
        ));
        return true;
      }
      if (subscriptions.has(sub)) {
        send(failureForSubscription(
          sub,
          new HostError(
            "invalid_request",
            `subscription "${sub}" already exists`,
          ),
        ));
        return true;
      }
      subscriptionCount++;
      try {
        const handle = await startAgentWatch(
          context,
          agent,
          params,
          (paths, dropped) => {
            const event: SubscriptionEvent = {
              sub,
              event: {
                kind: "changed",
                paths,
                ...(dropped > 0 ? { dropped } : {}),
              },
            };
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(event));
            }
          },
        );
        if (socket.readyState !== WebSocket.OPEN) {
          // The client disconnected while the watch was being established.
          handle.close();
          subscriptionCount--;
          return true;
        }
        subscriptions.set(sub, handle);
        send({
          ok: true,
          sub,
          result: {
            agent,
            ...(typeof params === "object" && params !== null &&
                "path" in params && typeof params.path === "string"
              ? { path: params.path }
              : {}),
          },
        });
      } catch (error) {
        subscriptionCount--;
        logFailure("subscribe", agent, error);
        send(failureForSubscription(sub, error));
      }
      return true;
    };

    const handleUnsubscribe = (message: unknown): boolean => {
      const unsubscribe = UnsubscribeSchema.safeParse(message);
      if (!unsubscribe.success) return false;
      const handle = subscriptions.get(unsubscribe.data.sub);
      if (!handle) {
        send(failure(
          unsubscribe.data.sub,
          new HostError(
            "invalid_request",
            `subscription "${unsubscribe.data.sub}" does not exist`,
          ),
        ));
        return true;
      }
      handle.close();
      subscriptions.delete(unsubscribe.data.sub);
      subscriptionCount = Math.max(0, subscriptionCount - 1);
      send({ ok: true, sub: unsubscribe.data.sub, result: {} });
      return true;
    };

    const handleRequest = async (data: string) => {
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        send(invalidRequest("message is not valid JSON"));
        socket.close(1008, "invalid message");
        return;
      }

      const hello = HelloSchema.safeParse(message);
      if (hello.success) {
        if (hello.data.protocol !== PROTOCOL_VERSION) {
          console.error(
            `[${
              new Date().toISOString()
            }] hello rejected: protocol ${hello.data.protocol}`,
          );
          send(unauthorized(
            `protocol ${hello.data.protocol} is not supported (expected ${PROTOCOL_VERSION})`,
          ));
          socket.close(1008, "protocol mismatch");
          return;
        }
        if (hello.data.token !== options.token) {
          console.error(`[${new Date().toISOString()}] hello rejected: token`);
          send(unauthorized("token rejected"));
          socket.close(1008, "unauthorized");
          return;
        }
        authorized = true;
        send({
          ok: true,
          result: { protocol: PROTOCOL_VERSION, helperVersion: HELPER_VERSION },
        });
        return;
      }

      if (!authorized) {
        send(unauthorized("send hello first"));
        socket.close(1008, "unauthorized");
        return;
      }

      if (await handleSubscribe(message)) return;
      if (handleUnsubscribe(message)) return;

      const request = RequestSchema.safeParse(message);
      if (!request.success) {
        send(invalidRequest(
          request.error.issues[0]?.message ?? "request is malformed",
        ));
        return;
      }
      const { id, op, agent, params, payloadSeq } = request.data;
      const payload = payloadSeq === undefined
        ? undefined
        : payloads.get(payloadSeq);
      if (payloadSeq !== undefined) dropPayload(payloadSeq);
      if (payloadSeq !== undefined && payload === undefined) {
        send(failure(
          id,
          new HostError(
            "invalid_request",
            `payload frame ${payloadSeq} was not received`,
          ),
        ));
        return;
      }
      sequence = (sequence + 1) >>> 0 || 1;
      try {
        const result = op === "fs.writeStart"
          ? await uploads.start(agent, params)
          : op === "fs.writeChunk"
          ? await uploads.chunk(agent, params, payload)
          : op === "fs.writeCommit"
          ? await uploads.commit(agent, params)
          : op === "fs.writeAbort"
          ? uploads.abort(agent, params)
          : await executeOperation(context, op, agent, params, payload);
        const resultPayload = "payload" in result ? result.payload : undefined;
        const hasPayload = (resultPayload?.length ?? 0) > 0;
        if (hasPayload) {
          socket.send(encodeBinaryFrame(sequence, resultPayload!));
        }
        send({
          ok: true,
          id,
          ...(hasPayload ? { seq: sequence } : {}),
          result: result.result,
        });
      } catch (error) {
        logFailure(op, agent, error);
        send(failure(id, error));
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        if (!(event.data instanceof ArrayBuffer)) return;
        if (!authorized) {
          socket.close(1008, "send hello first");
          return;
        }
        let frame;
        try {
          frame = decodeBinaryFrame(new Uint8Array(event.data));
        } catch {
          socket.close(1003, "invalid binary frame");
          return;
        }
        if (frame.payload.length > MAX_REQUEST_BYTES) {
          socket.close(1009, "payload too large");
          return;
        }
        if (
          bufferedPayloadBytes + frame.payload.length >
            MAX_BUFFERED_PAYLOAD_BYTES
        ) {
          socket.close(1009, "payload buffer is full");
          return;
        }
        dropPayload(frame.sequence);
        payloads.set(frame.sequence, frame.payload);
        bufferedPayloadBytes += frame.payload.length;
        return;
      }
      void handleRequest(event.data);
    };
    socket.onclose = () => {
      closeSubscriptions();
      clearPayloads();
      void uploads.close();
    };
    socket.onerror = () => {
      closeSubscriptions();
      clearPayloads();
      void uploads.close();
    };
    return response;
  });

  return {
    port: server.addr.port,
    close: () => server.shutdown(),
  };
}
