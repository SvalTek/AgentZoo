/**
 * Read-only filesystem access through the resident runtime host.
 *
 * The adapter keeps one WebSocket per agent environment and reconnects once
 * after a transport failure. Protocol errors keep their code so tools can map
 * them onto their existing model-facing feedback.
 */

import {
  HostError,
  HostErrorCodeSchema,
} from "@agent-zoo/runtime-host/protocol";
import type {
  RuntimeFiles,
  RuntimeListEntry,
  RuntimeSearchMatch,
  RuntimeSearchOptions,
} from "./types.ts";
import {
  RuntimeHostClient,
  type RuntimeHostEndpoint,
} from "./RuntimeHostClient.ts";

export class RuntimeFilesError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeFilesError";
  }
}

export class RuntimeHostFiles implements RuntimeFiles {
  #client?: RuntimeHostClient;
  #connecting?: Promise<RuntimeHostClient>;

  constructor(
    readonly agentId: string,
    readonly endpoint: () => RuntimeHostEndpoint | undefined,
  ) {}

  async readBytes(
    path: string,
    offset: number,
    limit: number,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly offset: number;
    readonly sizeBytes: number;
    readonly truncated: boolean;
    readonly nextOffset?: number;
  }> {
    const { result, payload } = await this.#request("fs.read", {
      path,
      unit: "bytes",
      offset,
      limit,
    });
    return {
      bytes: payload ?? new Uint8Array(),
      offset: numberField(result, "offset"),
      sizeBytes: numberField(result, "sizeBytes"),
      truncated: result.truncated === true,
      ...(typeof result.nextByteOffset === "number"
        ? { nextOffset: result.nextByteOffset }
        : {}),
    };
  }

  async list(
    path: string,
    limit?: number,
  ): Promise<{
    readonly entries: readonly RuntimeListEntry[];
    readonly truncated: boolean;
  }> {
    const { result } = await this.#request("fs.list", {
      path,
      ...(limit === undefined ? {} : { limit }),
    });
    const entries = Array.isArray(result.entries)
      ? result.entries as RuntimeListEntry[]
      : [];
    return { entries, truncated: result.truncated === true };
  }

  async write(
    path: string,
    mode: "create" | "overwrite" | "append",
    bytes: Uint8Array,
  ): Promise<{ readonly created: boolean; readonly sizeBytes: number }> {
    const { result } = await this.#request(
      "fs.write",
      { path, mode },
      bytes,
    );
    return {
      created: result.created === true,
      sizeBytes: numberField(result, "sizeBytes"),
    };
  }

  async search(options: RuntimeSearchOptions): Promise<{
    readonly results: readonly RuntimeSearchMatch[];
    readonly truncated: boolean;
  }> {
    const { result } = await this.#request("fs.search", options);
    const results = Array.isArray(result.results)
      ? result.results as RuntimeSearchMatch[]
      : [];
    return { results, truncated: result.truncated === true };
  }

  /** Close the socket; the next request reconnects. */
  close(): void {
    const client = this.#client;
    this.#client = undefined;
    client?.close();
  }

  async #request(
    op: string,
    params: unknown,
    payload?: Uint8Array,
  ): Promise<{ result: Record<string, unknown>; payload?: Uint8Array }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await this.#connection();
      try {
        return payload === undefined
          ? await client.request(op, this.agentId, params)
          : await client.requestWithPayload(op, this.agentId, params, payload);
      } catch (error) {
        if (error instanceof HostError) {
          throw new RuntimeFilesError(error.code, error.message);
        }
        lastError = error;
        // The socket closed or timed out; the next attempt reconnects.
        this.#client = undefined;
        client.close();
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("runtime host request failed");
  }

  async #connection(): Promise<RuntimeHostClient> {
    if (this.#client) return this.#client;
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = undefined;
    });
    return await this.#connecting;
  }

  async #open(): Promise<RuntimeHostClient> {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error("runtime host is not available");
    const client = await RuntimeHostClient.connect(endpoint);
    this.#client = client;
    return client;
  }
}

function numberField(result: Record<string, unknown>, key: string): number {
  return typeof result[key] === "number" ? result[key] : 0;
}

/** Whether a thrown value carries a known runtime-host error code. */
export function runtimeFilesErrorCode(error: unknown): string | undefined {
  if (error instanceof RuntimeFilesError) return error.code;
  if (error instanceof HostError) return error.code;
  return typeof error === "object" && error !== null &&
      "code" in error && typeof error.code === "string"
    ? HostErrorCodeSchema.safeParse(error.code).success ? error.code : undefined
    : undefined;
}
