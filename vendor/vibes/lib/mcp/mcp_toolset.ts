import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import { fromSchema } from "../tool.ts";
import type { Toolset } from "../toolsets/toolset.ts";
import type { MCPClient } from "./mcp_client.ts";
import type { MCPTool } from "./mcp_types.ts";

// ---------------------------------------------------------------------------
// MCPToolset
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_TTL_MS = 60_000;

/** Options for MCPToolset construction. */
export type MCPToolsetOptions = {
  /**
   * How long (in milliseconds) to cache the tool list returned by the server.
   * Defaults to 60 000 ms (1 minute).
   */
  toolCacheTtlMs?: number;
  /**
   * When true, server-level instructions are available via `getServerInstructions()`.
   * Defaults to true.
   */
  instructions?: boolean;
};

type ToolCache<TDeps> = {
  tools: ToolDefinition<TDeps>[];
  fetchedAt: number;
};

/**
 * A `Toolset` that exposes all tools from a connected MCP server.
 * Tools are discovered lazily on the first call to `tools()` and cached
 * for `toolCacheTtlMs` milliseconds.
 *
 * @example
 * ```ts
 * const client = new MCPStdioClient({ command: "npx", args: ["-y", "my-mcp-server"] });
 * await client.connect();
 *
 * const toolset = new MCPToolset(client);
 * const agent = new Agent({ model, toolsets: [toolset] });
 * await agent.run("Do something");
 * await client.disconnect();
 * ```
 */
export class MCPToolset<TDeps = undefined> implements Toolset<TDeps> {
  private _client: MCPClient;
  private _cacheTtlMs: number;
  private _useInstructions: boolean;
  private _cache: ToolCache<TDeps> | null = null;

  constructor(client: MCPClient, options?: MCPToolsetOptions) {
    this._client = client;
    this._cacheTtlMs = options?.toolCacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this._useInstructions = options?.instructions ?? true;
  }

  /**
   * Returns tools from the MCP server. Results are cached for `toolCacheTtlMs`.
   */
  async tools(_ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const now = Date.now();
    if (
      this._cache !== null && now - this._cache.fetchedAt < this._cacheTtlMs
    ) {
      return this._cache.tools;
    }

    const mcpTools = await this._client.listTools();
    const toolDefs = mcpTools.map((t) => this._mcpToolToDefinition(t));
    this._cache = { tools: toolDefs, fetchedAt: now };
    return toolDefs;
  }

  /**
   * Returns server-level instructions if the server provided them and
   * the `instructions` option is enabled.
   */
  getServerInstructions(): string | undefined {
    if (!this._useInstructions) return undefined;
    return this._client.getServerInstructions();
  }

  /** Force invalidate the tool cache on the next `tools()` call. */
  invalidateCache(): void {
    this._cache = null;
  }

  private _mcpToolToDefinition(mcpTool: MCPTool): ToolDefinition<TDeps> {
    const client = this._client;
    return fromSchema<TDeps>({
      name: mcpTool.name,
      description: mcpTool.description ?? mcpTool.name,
      jsonSchema: mcpTool.inputSchema,
      execute: async (
        _ctx: RunContext<TDeps>,
        args: Record<string, unknown>,
      ) => {
        const result = await client.callTool(mcpTool.name, args);

        if (result.isError) {
          const errorText = result.content
            .filter((c): c is { type: "text"; text: string } =>
              c.type === "text"
            )
            .map((c) => c.text)
            .join("\n");
          throw new Error(`MCP tool error: ${errorText}`);
        }

        // Extract text content items and join them
        const textParts = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text);

        if (textParts.length > 0) {
          return textParts.join("\n");
        }

        // If only image content, return a placeholder message
        return "Tool returned non-text content.";
      },
    }) as ToolDefinition<TDeps>;
  }
}


// denoCacheMetadata={"headers":{"alt-svc":"h3=\":443\"; ma=86400","x-jsr-backend":"modules","content-type":"text/typescript","x-content-type-options":"nosniff","content-encoding":"identity","content-length":"4071","date":"Thu, 11 Jun 2026 13:33:23 GMT","etag":"\"d6a5b866ad58f905a13a0581e5e3f915\"","x-robots-tag":"noindex","cf-ray":"a0a0fcb8680431aa-LHR","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","server":"cloudflare","vary":"Origin","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-allow-origin":"*","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=jHCyfT4JGO1uu90VzUxAv5xyBVHmceQW4mfHIvSvJUaq17ptOaUeVsWLJ5vl5xktYI%2FJ0Xzx29cdoCXiRcbpu2%2FdeBckZ81Os%2BlQa246ava9SIbZQeax4sA%3D\"}]}","cross-origin-resource-policy":"cross-origin"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/mcp/mcp_toolset.ts","time":1781184802}