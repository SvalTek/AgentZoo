/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import {
  type RunContext,
  type ToolCallNext,
  type ToolDefinition,
  type Toolset,
  WrapperToolset,
} from "@vibesjs/sdk";
import type { AgentRunDeps } from "../Agent.ts";
import { MCPServerUnavailableError } from "./MCPPool.ts";

export type ObserveToolCall = (
  toolName: string,
  args: Record<string, unknown>,
  execute: () => Promise<unknown>,
) => Promise<unknown>;

/** Adds AgentZoo observation to dynamically resolved Vibes toolsets. */
export class ObservedToolset extends WrapperToolset<AgentRunDeps> {
  readonly #staticNames: ReadonlySet<string>;
  readonly #observe: ObserveToolCall;

  constructor(
    inner: Toolset<AgentRunDeps>,
    staticNames: Iterable<string>,
    observe: ObserveToolCall,
  ) {
    super(inner);
    this.#staticNames = new Set(staticNames);
    this.#observe = observe;
  }

  override async tools(
    context: RunContext<AgentRunDeps>,
  ): Promise<ToolDefinition<AgentRunDeps>[]> {
    const resolved = await super.tools(context);
    for (const tool of resolved) {
      if (this.#staticNames.has(tool.name)) {
        throw new Error(
          `MCP tool "${tool.name}" collides with an AgentZoo tool after namespacing`,
        );
      }
    }
    return resolved;
  }

  override callTool(
    context: RunContext<AgentRunDeps>,
    toolName: string,
    args: Record<string, unknown>,
    next: ToolCallNext<AgentRunDeps>,
  ): Promise<unknown> {
    return this.#observe(toolName, args, () => next(context, args));
  }
}

/** Omits unavailable optional servers while retaining the available toolsets. */
export class OptionalMCPToolset implements Toolset<AgentRunDeps> {
  readonly #servers: readonly {
    name: string;
    toolset: Toolset<AgentRunDeps>;
  }[];
  readonly #warn: (
    serverName: string,
    error: MCPServerUnavailableError,
  ) => void;

  constructor(
    servers: readonly {
      name: string;
      toolset: Toolset<AgentRunDeps>;
    }[],
    warn: (serverName: string, error: MCPServerUnavailableError) => void,
  ) {
    this.#servers = servers;
    this.#warn = warn;
  }

  async tools(
    context: RunContext<AgentRunDeps>,
  ): Promise<ToolDefinition<AgentRunDeps>[]> {
    const resolved: ToolDefinition<AgentRunDeps>[] = [];
    for (const server of this.#servers) {
      try {
        resolved.push(...await server.toolset.tools(context));
      } catch (error) {
        if (!(error instanceof MCPServerUnavailableError)) throw error;
        this.#warn(server.name, error);
      }
    }
    return resolved;
  }
}
