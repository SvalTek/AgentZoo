import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "../toolsets/toolset.ts";
import type { MCPClient } from "./mcp_client.ts";
import { MCPToolset, type MCPToolsetOptions } from "./mcp_toolset.ts";

// ---------------------------------------------------------------------------
// MCPManager
// ---------------------------------------------------------------------------

type ServerEntry<TDeps> = {
  client: MCPClient;
  toolset: MCPToolset<TDeps>;
  name: string | undefined;
};

/**
 * Manages multiple MCP server connections and combines their tools into a
 * single `Toolset`. Implements `connect()` / `disconnect()` lifecycle methods
 * for batch connection management.
 *
 * @example
 * ```ts
 * const manager = new MCPManager();
 * manager.addServer(new MCPStdioClient({ command: "npx", args: ["-y", "server-a"] }));
 * manager.addServer(new MCPHttpClient({ url: "https://mcp.example.com" }), { name: "remote" });
 * await manager.connect();
 *
 * const agent = new Agent({ model, toolsets: [manager] });
 * await agent.run("Do something");
 * await manager.disconnect();
 * ```
 */
export class MCPManager<TDeps = undefined> implements Toolset<TDeps> {
  private _servers: ServerEntry<TDeps>[] = [];

  /**
   * Add an MCP server to this manager. The server will be connected when
   * `connect()` is called, or should already be connected if `connect()` has
   * already been called.
   */
  addServer(
    client: MCPClient,
    options?: MCPToolsetOptions & { name?: string },
  ): this {
    const { name, ...toolsetOptions } = options ?? {};
    const toolset = new MCPToolset<TDeps>(client, toolsetOptions);
    this._servers = [...this._servers, { client, toolset, name }];
    return this;
  }

  /**
   * Connect to all registered MCP servers in parallel.
   * Safe to call even if some servers are already connected - the MCP SDK
   * will handle duplicate connect gracefully.
   */
  async connect(): Promise<void> {
    await Promise.all(this._servers.map((s) => s.client.connect()));
  }

  /**
   * Disconnect from all registered MCP servers in parallel.
   * Errors from individual servers are collected and re-thrown as an
   * `AggregateError` after all disconnects have been attempted.
   */
  async disconnect(): Promise<void> {
    const errors: unknown[] = [];
    await Promise.all(
      this._servers.map(async (s) => {
        try {
          await s.client.disconnect();
        } catch (err) {
          errors.push(err);
        }
      }),
    );
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Errors while disconnecting MCP servers",
      );
    }
  }

  /**
   * Returns the combined tools from all connected servers.
   * Tools are fetched from each server's toolset (with caching) and merged.
   * If two servers expose a tool with the same name, the last one wins.
   */
  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const byName = new Map<string, ToolDefinition<TDeps>>();
    for (const server of this._servers) {
      const serverTools = await server.toolset.tools(ctx);
      for (const t of serverTools) {
        byName.set(t.name, t);
      }
    }
    return [...byName.values()];
  }

  /**
   * Returns aggregated server instructions from all servers that provide them.
   * Each server's instructions are separated by a blank line.
   */
  getServerInstructions(): string | undefined {
    const parts: string[] = [];
    for (const server of this._servers) {
      const instr = server.toolset.getServerInstructions();
      if (instr) {
        parts.push(server.name ? `[${server.name}]\n${instr}` : instr);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  /** Returns the number of registered servers. */
  get serverCount(): number {
    return this._servers.length;
  }
}

// denoCacheMetadata={"headers":{"cross-origin-resource-policy":"cross-origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","x-content-type-options":"nosniff","cf-ray":"a0a0fcb8680531aa-LHR","x-jsr-backend":"modules","server":"cloudflare","access-control-allow-origin":"*","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","vary":"Origin","x-robots-tag":"noindex","cache-control":"public, max-age=31536000, immutable","etag":"\"586ea95de7b78137b211409ee72233dd\"","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Yn%2B8g91wnzGTINfTUsqPidaHD3biDjKt1%2FAv8xfOQarueMQnJDD4ftK%2B%2F5gi6ct65Naxk8K%2FV8eWdrBWRiomrOYeMUfzp%2B3vd5YtWoby%2FItRN22Xa4I%2FyCo%3D\"}]}","alt-svc":"h3=\":443\"; ma=86400","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-type":"text/typescript","content-length":"3923","access-control-expose-headers":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/mcp/mcp_manager.ts","time":1781184802}