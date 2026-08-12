import type { MCPCallResult, MCPTool } from "./mcp_types.ts";

// ---------------------------------------------------------------------------
// MCPClient interface
// ---------------------------------------------------------------------------

/**
 * Base interface for MCP client implementations.
 * Concrete implementations connect to MCP servers via different transports
 * (stdio, HTTP, etc.) and expose the server's tools to the framework.
 */
export interface MCPClient {
  /** Connect to the MCP server. Must be called before any other method. */
  connect(): Promise<void>;

  /** Disconnect from the MCP server and clean up resources. */
  disconnect(): Promise<void>;

  /** List all tools available on the connected MCP server. */
  listTools(): Promise<MCPTool[]>;

  /**
   * Call a tool on the MCP server.
   * @param name - The name of the tool to call.
   * @param args - The arguments to pass to the tool.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;

  /**
   * Returns server-level instructions if provided during initialization.
   * Agents may include these in their system prompt.
   */
  getServerInstructions(): string | undefined;
}

// denoCacheMetadata={"headers":{"server":"cloudflare","content-type":"text/typescript","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Iel1rOtecAf9AjOHZ2MiwyFpTCztZ%2BwYhN97F5mVIr8bRLydJvkBc516VBeBSlRcgdiXq8uymT3lYT7IxSQiyRrZtvypfK6G4AtFnEPugWiuDyRVW%2BNSmV0%3D\"}]}","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","alt-svc":"h3=\":443\"; ma=86400","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cf-ray":"a0a0fcb86ffd31aa-LHR","access-control-allow-origin":"*","x-jsr-backend":"modules","vary":"Origin","x-content-type-options":"nosniff","etag":"\"d5b14822318301a48e929387a7eba393\"","date":"Thu, 11 Jun 2026 13:33:23 GMT","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-length":"1201","x-robots-tag":"noindex","content-encoding":"identity","cross-origin-resource-policy":"cross-origin"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/mcp/mcp_client.ts","time":1781184802}