/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { tool, type ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import { actionableToolError } from "../ToolSupport.ts";
import {
  type MCPServerEntry,
  MCPServerUnavailableError,
  mcpToolPrefix,
} from "./MCPPool.ts";

const ListToolsParameters = z.object({
  mcp_name: z.string().min(1).describe(
    "Name of an MCP server available to this agent",
  ),
});

/** Lists one assigned MCP server's tools and exposes that full toolset next turn. */
export function createMCPListToolsTool(
  servers: readonly MCPServerEntry[],
  onUnavailable?: (
    serverName: string,
    error: MCPServerUnavailableError,
  ) => void,
): ToolDefinition<AgentRunDeps> {
  const byName = new Map(servers.map((server) => [server.name, server]));
  const availableNames = servers.map((server) => server.name).join(", ");

  return tool<AgentRunDeps, typeof ListToolsParameters>({
    name: "list_tools",
    description:
      "Discover the tools provided by an available MCP server. The server's direct tools will be available on your next turn.",
    parameters: ListToolsParameters,
    execute: async (context, { mcp_name }) => {
      const server = byName.get(mcp_name);
      if (!server) {
        throw actionableToolError([
          `MCP server "${mcp_name}" is not available to this agent.`,
          availableNames
            ? `Call list_tools with one of: ${availableNames}.`
            : "No MCP servers are available to this agent.",
        ]);
      }

      let tools;
      try {
        tools = await server.toolset.tools(context);
      } catch (error) {
        if (error instanceof MCPServerUnavailableError) {
          onUnavailable?.(server.name, error);
          throw actionableToolError([
            `MCP server "${server.name}" is currently unavailable.`,
            "Try listing its tools again later.",
          ], error);
        }
        throw error;
      }

      context.deps.control.enabledMcpServers ??= new Set<string>();
      context.deps.control.enabledMcpServers.add(server.name);

      return JSON.stringify(tools.map((definition) => ({
        name: `${mcpToolPrefix(server.name)}${definition.name}`,
        description: definition.description,
      })));
    },
  });
}
