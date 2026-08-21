/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import {
  type MCPClient,
  MCPHttpClient,
  MCPStdioClient,
  MCPToolset,
  type RunContext,
  type Toolset,
} from "@vibesjs/sdk";
import type { MCPServerConfig } from "../Config.ts";
import type { AgentRunDeps } from "../Agent.ts";

export interface MCPServerEntry {
  readonly name: string;
  readonly toolset: Toolset<AgentRunDeps>;
}

/** A server could not safely expose its tools for this model turn. */
export class MCPServerUnavailableError extends Error {
  constructor(
    readonly serverName: string,
    readonly initialError: unknown,
    readonly recoveryError?: unknown,
  ) {
    super(
      `MCP server "${serverName}" is unavailable while discovering tools: ${
        errorMessage(recoveryError ?? initialError)
      }`,
      { cause: recoveryError ?? initialError },
    );
    this.name = "MCPServerUnavailableError";
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
      return {
        name: resolved.name,
        client,
        toolset: new ManagedMCPToolset<AgentRunDeps>(resolved.name, client),
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
      return this.#servers.map(({ name, toolset }) => ({ name, toolset }));
    }
    return names.map((name) => {
      const server = this.#servers.find((candidate) => candidate.name === name);
      if (!server) {
        throw new Error(
          `Agent "${agentId}" references unknown MCP server "${name}"`,
        );
      }
      return { name: server.name, toolset: server.toolset };
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
    try {
      return await this.discover(context);
    } catch (initialError) {
      if (this.#state !== "ready") {
        await this.reset().catch(() => undefined);
        throw new MCPServerUnavailableError(this.#name, initialError);
      }
      try {
        await this.reset();
        return await this.discover(context);
      } catch (recoveryError) {
        await this.reset().catch(() => undefined);
        throw new MCPServerUnavailableError(
          this.#name,
          initialError,
          recoveryError,
        );
      }
    }
  }

  private async discover(context: import("@vibesjs/sdk").RunContext<TDeps>) {
    if (this.#state === "new") await this.#client.connect();
    const tools = await this.#toolset.tools(context);
    this.#state = "ready";
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

  private async reset(): Promise<void> {
    await this.#client.disconnect();
    this.#toolset = new MCPToolset<TDeps>(this.#client);
    this.#state = "new";
  }
}

export function mcpToolPrefix(serverName: string): string {
  return `mcp_${serverName.replaceAll("-", "_")}_`;
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
