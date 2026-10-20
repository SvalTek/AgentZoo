/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type {
  RunContext,
  ToolDefinition,
  Toolset,
} from "@vibesjs/sdk";

/**
 * Name an MCP tool the way the model will call it.
 *
 * Providers only accept `[A-Za-z0-9_-]` names up to 64 characters, and one
 * unusable name rejects the whole request. Servers are free to publish names
 * with dots, spaces, or excessive length, so the exposed name is derived here
 * and used for both the `list_tools` listing and the exposed toolset.
 */
export function mcpToolName(serverName: string, toolName: string): string {
  const prefix = `mcp_${serverName.replaceAll("-", "_")}_`;
  const normalized = toolName
    .replaceAll(/[^A-Za-z0-9_-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}${normalized || "tool"}`.slice(0, 64);
}

/** Exposes a server's tools under their provider-safe AgentZoo names. */
export class MCPNamedToolset<TDeps> implements Toolset<TDeps> {
  constructor(
    private readonly inner: Toolset<TDeps>,
    private readonly serverName: string,
  ) {}

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const list = await this.inner.tools(ctx);
    return list.map((definition) => ({
      ...definition,
      name: mcpToolName(this.serverName, definition.name),
    }));
  }
}
