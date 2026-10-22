/**
 * Client for the resident runtime-host service.
 *
 * One WebSocket per runtime container. Requests are multiplexed by id; binary
 * responses carry a sequence number that the JSON result repeats. Only the
 * read-only operations and `fs.watch` exist today, which is what the tools need
 * to migrate onto this transport.
 */

import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  HostError,
  HostErrorCodeSchema,
  MAX_REQUEST_BYTES,
  PROTOCOL_VERSION,
} from "@agent-zoo/runtime-host/protocol";

export interface RuntimeHostEndpoint {
  /** WebSocket URL, for example `ws://127.0.0.1:49152`. */
  readonly url: string;
  /** Per-container token required by the handshake. */
  readonly token: string;
}

export interface RuntimeHostRequestOptions {
  readonly timeoutMs?: number;
}

export interface RuntimeHostResult {
  readonly result: Record<string, unknown>;
  readonly payload?: Uint8Array;
}

export interface RuntimeHostSubscription {
  close(): void;
}

interface PendingRequest {
  readonly resolve: (value: RuntimeHostResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export class RuntimeHostClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #payloads = new Map<number, Uint8Array>();
  readonly #subscriptions = new Map<
    string,
    (event: Record<string, unknown>) => void
  >();
  readonly #pendingSubscriptions = new Map<string, PendingRequest>();
  #sequence = 0;
  #payloadSequence = 0;
  #closed = false;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onclose = () =>
      this.#failAll(new Error("runtime host disconnected"));
    socket.onerror = () =>
      this.#failAll(new Error("runtime host socket error"));
  }

  static connect(
    endpoint: RuntimeHostEndpoint,
    options: RuntimeHostRequestOptions = {},
  ): Promise<RuntimeHostClient> {
    const { promise, resolve, reject } = Promise.withResolvers<
      RuntimeHostClient
    >();
    const socket = new WebSocket(endpoint.url);
    socket.binaryType = "arraybuffer";
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("runtime host did not answer the handshake"));
    }, options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        op: "hello",
        protocol: PROTOCOL_VERSION,
        token: endpoint.token,
      }));
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("runtime host connection failed"));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.ok === true && message.result && !message.id) {
        clearTimeout(timeout);
        socket.onmessage = null;
        const client = new RuntimeHostClient(socket);
        resolve(client);
      } else if (message.ok === false) {
        clearTimeout(timeout);
        socket.close();
        reject(
          new Error(
            (message.error as { message?: string } | undefined)?.message ??
              "runtime host rejected the handshake",
          ),
        );
      }
    };
    return promise;
  }

  async request(
    op: string,
    agent?: string,
    params?: unknown,
    options: RuntimeHostRequestOptions = {},
  ): Promise<RuntimeHostResult> {
    return await this.#sendRequest(op, agent, params, options);
  }

  /**
   * Send a request whose payload travels as a binary frame. The frame is sent
   * first so the server can attach it to the JSON request that names its
   * sequence.
   */
  async requestWithPayload(
    op: string,
    agent: string | undefined,
    params: unknown,
    payload: Uint8Array,
    options: RuntimeHostRequestOptions = {},
  ): Promise<RuntimeHostResult> {
    if (this.#closed) throw new Error("runtime host client is closed");
    if (payload.length > MAX_REQUEST_BYTES) {
      throw new Error("runtime host payload is too large");
    }
    const payloadSeq = (this.#payloadSequence + 1) >>> 0 || 1;
    this.#payloadSequence = payloadSeq;
    this.#socket.send(encodeBinaryFrame(payloadSeq, payload));
    return await this.#sendRequest(op, agent, params, options, payloadSeq);
  }

  async #sendRequest(
    op: string,
    agent: string | undefined,
    params: unknown,
    options: RuntimeHostRequestOptions,
    payloadSeq?: number,
  ): Promise<RuntimeHostResult> {
    if (this.#closed) throw new Error("runtime host client is closed");
    const id = `${++this.#sequence}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { promise, resolve, reject } = Promise.withResolvers<
      RuntimeHostResult
    >();
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new Error(`runtime host request "${op}" timed out`));
    }, timeoutMs);
    this.#pending.set(id, { resolve, reject, timer });
    try {
      this.#socket.send(JSON.stringify({
        id,
        op,
        ...(agent === undefined ? {} : { agent }),
        ...(params === undefined ? {} : { params }),
        ...(payloadSeq === undefined ? {} : { payloadSeq }),
      }));
    } catch (error) {
      this.#pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return await promise;
  }

  async subscribe(
    agent: string,
    params: unknown,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<RuntimeHostSubscription> {
    if (this.#closed) throw new Error("runtime host client is closed");
    const sub = `sub:${++this.#sequence}`;
    const acknowledgement = Promise.withResolvers<RuntimeHostResult>();
    const timer = setTimeout(() => {
      this.#pendingSubscriptions.delete(sub);
      acknowledgement.reject(new Error("runtime host subscription timed out"));
    }, DEFAULT_TIMEOUT_MS);
    this.#pendingSubscriptions.set(sub, {
      resolve: acknowledgement.resolve,
      reject: acknowledgement.reject,
      timer,
    });
    this.#subscriptions.set(sub, onEvent);
    this.#socket.send(JSON.stringify({
      op: "subscribe",
      sub,
      channel: "fs.watch",
      agent,
      params,
    }));
    await acknowledgement.promise;
    return {
      close: () => {
        this.#subscriptions.delete(sub);
        if (this.#closed) return;
        this.#socket.send(JSON.stringify({ op: "unsubscribe", sub }));
      },
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failAll(new Error("runtime host client closed"));
    this.#socket.close();
  }

  #handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      if (data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(new Uint8Array(data));
        this.#payloads.set(frame.sequence, frame.payload);
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.sub === "string" && message.event) {
      const callback = this.#subscriptions.get(message.sub);
      if (callback) callback(message.event as Record<string, unknown>);
      return;
    }
    if (typeof message.sub === "string" && message.ok === true) {
      const pending = this.#pendingSubscriptions.get(message.sub);
      if (!pending) return;
      this.#pendingSubscriptions.delete(message.sub);
      clearTimeout(pending.timer);
      pending.resolve({ result: {} });
      return;
    }
    if (typeof message.id !== "string") return;
    const subscriptionKey = typeof message.sub === "string"
      ? message.sub
      : message.id;
    const pendingSubscription = subscriptionKey === undefined
      ? undefined
      : this.#pendingSubscriptions.get(subscriptionKey);
    if (pendingSubscription && message.ok === false) {
      this.#pendingSubscriptions.delete(subscriptionKey!);
      this.#subscriptions.delete(subscriptionKey!);
      clearTimeout(pendingSubscription.timer);
      const error = message.error as { message?: string } | undefined;
      pendingSubscription.reject(
        new Error(error?.message ?? "runtime host subscription failed"),
      );
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok === false) {
      const error = message.error as
        | { code?: string; message?: string }
        | undefined;
      const messageText = error?.message ?? "runtime host request failed";
      const code = error?.code
        ? HostErrorCodeSchema.safeParse(error.code)
        : undefined;
      pending.reject(
        code?.success
          ? new HostError(code.data, messageText)
          : new Error(messageText),
      );
      return;
    }
    const sequence = typeof message.seq === "number" ? message.seq : undefined;
    const payload = sequence === undefined
      ? undefined
      : this.#payloads.get(sequence);
    if (sequence !== undefined) this.#payloads.delete(sequence);
    pending.resolve({
      result: (message.result as Record<string, unknown>) ?? {},
      ...(payload ? { payload } : {}),
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const pending of this.#pendingSubscriptions.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pendingSubscriptions.clear();
    this.#payloads.clear();
    for (const callback of this.#subscriptions.values()) {
      callback({ kind: "closed", error: error.message });
    }
    this.#subscriptions.clear();
  }
}
