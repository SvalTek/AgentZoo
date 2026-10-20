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
 *
 * A name that had to be rewritten, or shortened, carries a hash of its source
 * name: `get.issue` and `get issue` would otherwise collapse onto one name in
 * the provider tool map and make one of them unreachable.
 */
export function mcpToolName(serverName: string, toolName: string): string {
  const prefix = `mcp_${serverName.replaceAll("-", "_")}_`;
  const normalized = toolName
    .replaceAll(/[^A-Za-z0-9_-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
  const base = `${prefix}${normalized}`;
  if (normalized === toolName && base.length <= 64) return base;
  let hash = 0x811c9dc5;
  for (let index = 0; index < toolName.length; index++) {
    hash = Math.imul(hash ^ toolName.charCodeAt(index), 0x01000193) >>> 0;
  }
  const suffix = `_${hash.toString(16).padStart(8, "0")}`;
  return `${base.slice(0, 64 - suffix.length)}${suffix}`;
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
