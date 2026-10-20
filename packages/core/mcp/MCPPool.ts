/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import {
  type MCPClient,
  MCPHttpClient,
  type MCPReadResourceResult,
  type MCPResource,
  type MCPResourceTemplate,
  MCPStdioClient,
  MCPToolset,
  type RunContext,
  type Toolset,
} from "@vibesjs/sdk";
import type { MCPServerConfig } from "../Config.ts";
import type { AgentRunDeps } from "../Agent.ts";

export interface MCPServerEntry {
  readonly name: string;
  /** Configured model-facing purpose for this selected server. */
  readonly description: string;
  readonly toolset: Toolset<AgentRunDeps>;
  readonly resources: MCPResourceAccess;
}

export interface MCPResourceAccess {
  listResources(): Promise<MCPResource[]>;
  listResourceTemplates(): Promise<MCPResourceTemplate[]>;
  readResource(uri: string): Promise<MCPReadResourceResult>;
}

/** A server could not safely expose its tools for this model turn. */
export class MCPServerUnavailableError extends Error {
  constructor(
    readonly serverName: string,
    readonly initialError: unknown,
    readonly recoveryError?: unknown,
  ) {
    super(
      `MCP server "${serverName}" is unavailable during discovery: ${
        errorMessage(recoveryError ?? initialError)
      }`,
      { cause: recoveryError ?? initialError },
    );
    this.name = "MCPServerUnavailableError";
  }
}

export class MCPResourceUnsupportedError extends Error {
  constructor(readonly serverName: string) {
    super(`MCP server "${serverName}" does not advertise resources`);
    this.name = "MCPResourceUnsupportedError";
  }
}

export interface MCPPoolOptions {
  clientFactory?: (config: MCPServerConfig) => MCPClient;
}

/** Zoo-owned connections for configured host-side MCP servers. */
export class MCPPool {
  readonly #servers: readonly (MCPServerEntry & { client: MCPClient })[];

  constructor(
    configs: readonly MCPServerConfig[],
    hostSharedPath: string,
    options: MCPPoolOptions = {},
  ) {
    const clientFactory = options.clientFactory ?? createClient;
    this.#servers = configs.map((config) => {
      const resolved = substituteSharedPathTokens(config, hostSharedPath);
      const client = clientFactory(resolved);
      const managed = new ManagedMCPToolset<AgentRunDeps>(
        resolved.name,
        client,
      );
      return {
        name: resolved.name,
        description: resolved.description,
        client,
        toolset: managed,
        resources: managed,
      };
    });
  }

  names(): readonly string[] {
    return this.#servers.map((server) => server.name);
  }

  select(
    agentId: string,
    names: readonly string[] | undefined,
  ): MCPServerEntry[] {
    if (!names?.length) return [];
    if (names.length === 1 && names[0] === "*") {
      return this.#servers.map(({ name, description, toolset, resources }) => ({
        name,
        description,
        toolset,
        resources,
      }));
    }
    return names.map((name) => {
      const server = this.#servers.find((candidate) => candidate.name === name);
      if (!server) {
        throw new Error(
          `Agent "${agentId}" references unknown MCP server "${name}"`,
        );
      }
      return {
        name: server.name,
        description: server.description,
        toolset: server.toolset,
        resources: server.resources,
      };
    });
  }

  async disconnectAll(): Promise<void> {
    const errors = await disconnectClients(
      this.#servers.map(({ client }) => client),
    );
    if (errors.length) {
      throw new AggregateError(errors, "MCP disconnection failed");
    }
  }
}

/**
 * Lazily owns a single MCP transport. Discovery is safe to retry once after a
 * previously healthy connection becomes stale; tool calls themselves are never
 * replayed because they may mutate external state.
 */
class ManagedMCPToolset<TDeps> implements Toolset<TDeps> {
  #state: "new" | "ready" = "new";
  #connecting?: Promise<void>;
  #toolset: MCPToolset<TDeps>;
  readonly #name: string;
  readonly #client: MCPClient;

  constructor(
    name: string,
    client: MCPClient,
  ) {
    this.#name = name;
    this.#client = client;
    this.#toolset = new MCPToolset<TDeps>(this.#client);
  }

  async tools(context: import("@vibesjs/sdk").RunContext<TDeps>) {
    const tools = await this.withRecovery(() => this.discover(context));
    return tools.map((tool) => ({
      ...tool,
      execute: async (callContext: RunContext<TDeps>, args: unknown) => {
        try {
          return await tool.execute(callContext, args);
        } catch (error) {
          // Do not retry the call: it may have already mutated its target.
          await this.reset().catch(() => undefined);
          throw error;
        }
      },
    }));
  }

  listResources(): Promise<MCPResource[]> {
    return this.withRecovery(() => {
      this.assertResourcesSupported();
      return this.#client.listResources!();
    });
  }

  listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    return this.withRecovery(() => {
      this.assertResourcesSupported();
      return this.#client.listResourceTemplates!();
    });
  }

  readResource(uri: string): Promise<MCPReadResourceResult> {
    return this.withRecovery(() => {
      this.assertResourcesSupported();
      return this.#client.readResource!(uri);
    });
  }

  private async discover(context: import("@vibesjs/sdk").RunContext<TDeps>) {
    const tools = await this.#toolset.tools(context);
    return tools;
  }

  private async withRecovery<T>(operation: () => Promise<T>): Promise<T> {
    const wasReady = this.#state === "ready";
    try {
      if (!wasReady) {
        await this.connect();
      }
      return await operation();
    } catch (initialError) {
      if (initialError instanceof MCPResourceUnsupportedError) {
        throw initialError;
      }
      // A JSON-RPC error means the server answered: the transport is healthy,
      // and reconnecting would only repeat the same request.
      if (isServerResponseError(initialError)) throw initialError;
      if (!wasReady) {
        await this.reset().catch(() => undefined);
        throw new MCPServerUnavailableError(this.#name, initialError);
      }
      try {
        await this.reset();
        await this.connect();
        return await operation();
      } catch (recoveryError) {
        await this.reset().catch(() => undefined);
        if (recoveryError instanceof MCPResourceUnsupportedError) {
          throw recoveryError;
        }
        if (isServerResponseError(recoveryError)) throw recoveryError;
        throw new MCPServerUnavailableError(
          this.#name,
          initialError,
          recoveryError,
        );
      }
    }
  }

  /**
   * Connect at most once for all concurrent callers. Discovery and resource
   * reads may run in parallel, and two transports on one server would leak.
   */
  private connect(): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    this.#connecting ??= (async () => {
      await this.#client.connect();
      this.#state = "ready";
    })().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  private assertResourcesSupported(): void {
    if (
      !this.#client.listResources || !this.#client.listResourceTemplates ||
      !this.#client.readResource ||
      this.#client.supportsResources?.() === false
    ) {
      throw new MCPResourceUnsupportedError(this.#name);
    }
  }

  private async reset(): Promise<void> {
    await this.#client.disconnect();
    this.#toolset = new MCPToolset<TDeps>(this.#client);
    this.#state = "new";
  }
}

export function mcpToolPrefix(serverName: string): string {
  return `mcp_${serverName.replaceAll("-", "_")}_`;
}

/**
 * A JSON-RPC error (numeric `code`) is a server response, not a transport
 * failure: the connection worked and the request itself was rejected.
 */
export function isServerResponseError(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === "number";
}

export function substituteSharedPathTokens(
  config: MCPServerConfig,
  hostSharedPath: string,
): MCPServerConfig {
  const substitute = (value: string) =>
    value
      .replaceAll("{shared.host}", hostSharedPath)
      .replaceAll("{shared.agent}", "/shared");
  if (config.type === "stdio") {
    return {
      ...config,
      command: substitute(config.command),
      args: config.args.map(substitute),
      env: config.env && Object.fromEntries(
        Object.entries(config.env).map((
          [key, value],
        ) => [key, substitute(value)]),
      ),
    };
  }
  return {
    ...config,
    url: substitute(config.url),
    headers: config.headers && Object.fromEntries(
      Object.entries(config.headers).map((
        [key, value],
      ) => [key, substitute(value)]),
    ),
  };
}

function createClient(config: MCPServerConfig): MCPClient {
  return config.type === "stdio"
    ? new MCPStdioClient({
      command: config.command,
      args: config.args,
      env: config.env,
    })
    : new MCPHttpClient({ url: config.url, headers: config.headers });
}

async function disconnectClients(
  clients: readonly MCPClient[],
): Promise<unknown[]> {
  const results = await Promise.allSettled(
    clients.map((client) => client.disconnect()),
  );
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
