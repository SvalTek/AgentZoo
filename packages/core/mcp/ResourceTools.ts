/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { tool, type ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import { actionableToolError } from "../ToolSupport.ts";
import {
  MCPResourceUnsupportedError,
  type MCPServerEntry,
  MCPServerUnavailableError,
} from "./MCPPool.ts";

const MCPName = z.string().min(1).describe(
  "Name of an MCP server available to this agent",
);
const ListResourcesParameters = z.object({ mcp_name: MCPName });
const ReadResourceParameters = z.object({
  mcp_name: MCPName,
  uri: z.string().min(1).describe(
    "A concrete resource URI from list_resources, or one expanded from a listed URI template. For example, expand agent-chat://feed{?cursor,limit} to agent-chat://feed?limit=10.",
  ),
});

/** MCP resource discovery and reading tools, scoped to the agent's assigned servers. */
export function createMCPResourceTools(
  servers: readonly MCPServerEntry[],
  onUnavailable?: (
    serverName: string,
    error: MCPServerUnavailableError,
  ) => void,
): ToolDefinition<AgentRunDeps>[] {
  const byName = new Map(servers.map((server) => [server.name, server]));
  const availableNames = servers.map((server) => server.name).join(", ");

  function serverFor(name: string): MCPServerEntry {
    const server = byName.get(name);
    if (!server) {
      throw actionableToolError([
        `MCP server "${name}" is not available to this agent.`,
        availableNames
          ? `Use one of these MCP servers: ${availableNames}.`
          : "No MCP servers are available to this agent.",
      ]);
    }
    return server;
  }

  function reportError(server: MCPServerEntry, error: unknown): never {
    if (error instanceof MCPResourceUnsupportedError) {
      throw actionableToolError([
        `MCP server "${server.name}" does not provide resources.`,
        "Use list_tools to discover its available tools instead.",
      ], error);
    }
    if (error instanceof MCPServerUnavailableError) {
      onUnavailable?.(server.name, error);
      throw actionableToolError([
        `MCP server "${server.name}" is currently unavailable.`,
        "Try the resource request again later.",
      ], error);
    }
    throw error;
  }

  return [
    tool<AgentRunDeps, typeof ListResourcesParameters>({
      name: "list_resources",
      description:
        "List the resources and resource templates published by an available MCP server.",
      parameters: ListResourcesParameters,
      execute: async (_context, { mcp_name }) => {
        const server = serverFor(mcp_name);
        try {
          const [resources, resourceTemplates] = await Promise.all([
            server.resources.listResources(),
            server.resources.listResourceTemplates(),
          ]);
          return JSON.stringify({ resources, resourceTemplates });
        } catch (error) {
          return reportError(server, error);
        }
      },
    }),
    tool<AgentRunDeps, typeof ReadResourceParameters>({
      name: "read_resource",
      description:
        "Read an MCP resource by URI. Use list_resources first. For a resource template, expand its URI-template expressions with concrete values (for example, agent-chat://feed{?cursor,limit} becomes agent-chat://feed?limit=10) and pass the resulting URI.",
      parameters: ReadResourceParameters,
      execute: async (_context, { mcp_name, uri }) => {
        const server = serverFor(mcp_name);
        try {
          return JSON.stringify(await server.resources.readResource(uri));
        } catch (error) {
          return reportError(server, error);
        }
      },
    }),
  ];
}
