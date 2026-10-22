/**
 * WebSocket endpoint for the runtime-host service.
 *
 * One connection per runtime container. The client must send a `hello` with the
 * per-container token and protocol version before any operation. Requests are
 * multiplexed; `fs.watch` subscriptions push coalesced events until they are
 * cancelled or the connection closes.
 */

import {
  DEFAULT_PORT,
  encodeBinaryFrame,
  HelloSchema,
  HELPER_VERSION,
  HostError,
  type HostErrorCode,
  PROTOCOL_VERSION,
  RequestSchema,
  type ServerMessage,
  SubscribeSchema,
  type SubscriptionEvent,
  UnsubscribeSchema,
} from "./protocol.ts";
import { executeOperation, startAgentWatch } from "./operations.ts";
import type { WatchHandle } from "./watch.ts";

const MAX_SUBSCRIPTIONS = 64;

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
    const subscriptions = new Map<string, WatchHandle>();
    let authorized = false;

    const send = (message: ServerMessage) =>
      socket.send(JSON.stringify(message));

    const closeSubscriptions = () => {
      for (const handle of subscriptions.values()) handle.close();
      subscriptions.clear();
    };

    const handleSubscribe = async (message: unknown): Promise<boolean> => {
      const subscribe = SubscribeSchema.safeParse(message);
      if (!subscribe.success) return false;
      const { sub, agent, params } = subscribe.data;
      if (subscriptions.size >= MAX_SUBSCRIPTIONS) {
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
          send(unauthorized(
            `protocol ${hello.data.protocol} is not supported (expected ${PROTOCOL_VERSION})`,
          ));
          socket.close(1008, "protocol mismatch");
          return;
        }
        if (hello.data.token !== options.token) {
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
      const { id, op, agent, params } = request.data;
      sequence = (sequence + 1) >>> 0 || 1;
      try {
        const result = await executeOperation(context, op, agent, params);
        const hasPayload = (result.payload?.length ?? 0) > 0;
        if (hasPayload) {
          socket.send(encodeBinaryFrame(sequence, result.payload!));
        }
        send({
          ok: true,
          id,
          ...(hasPayload ? { seq: sequence } : {}),
          result: result.result,
        });
      } catch (error) {
        send(failure(id, error));
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        socket.close(1003, "text frames only");
        return;
      }
      void handleRequest(event.data);
    };
    socket.onclose = closeSubscriptions;
    socket.onerror = closeSubscriptions;
    return response;
  });

  return {
    port: server.addr.port,
    close: () => server.shutdown(),
  };
}
