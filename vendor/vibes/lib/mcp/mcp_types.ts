// ---------------------------------------------------------------------------
// Shared MCP types
// ---------------------------------------------------------------------------

/** A tool exposed by an MCP server. */
export type MCPTool = {
  name: string;
  description?: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
};

/** A resource published by an MCP server. */
export type MCPResource = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

/** A parameterized resource URI published by an MCP server. */
export type MCPResourceTemplate = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

/** Text or base64 content returned when an MCP resource is read. */
export type MCPResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

/** Result of reading an MCP resource URI. */
export type MCPReadResourceResult = {
  contents: MCPResourceContent[];
};

/** A single content item returned by an MCP tool call. */
export type MCPTextContent = { type: "text"; text: string };
export type MCPImageContent = { type: "image"; data: string; mimeType: string };
export type MCPContentItem = MCPTextContent | MCPImageContent;

/** The result of calling an MCP tool. */
export type MCPCallResult = {
  content: MCPContentItem[];
  isError?: boolean;
};

/** Configuration for an MCP server. */
export type MCPServerConfig =
  | {
    type: "stdio";
    name?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }
  | {
    type: "http";
    name?: string;
    url: string;
    headers?: Record<string, string>;
  };

/** A request from an MCP server asking for user input. */
export type ElicitationRequest = {
  message: string;
  schema: Record<string, unknown>;
};

/** A callback invoked when the MCP server sends an elicitation request. */
export type ElicitationCallback = (
  request: ElicitationRequest,
) => Promise<Record<string, unknown>>;

// denoCacheMetadata={"headers":{"content-type":"text/typescript","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-expose-headers":"*","cross-origin-resource-policy":"cross-origin","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=C%2BpGeEF1UDpdxzRDyku5M42eNpDFGUtaGHeuYseShzzqg7WHj33hJz2Wilgle784Otm0fGOJLUnidd4ZmQXyf9u6rcWRpvSUqqXULSdH0ax8ZgJQngZzrug%3D\"}]}","access-control-allow-origin":"*","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","alt-svc":"h3=\":443\"; ma=86400","date":"Thu, 11 Jun 2026 13:33:23 GMT","cache-control":"public, max-age=31536000, immutable","vary":"Origin","cf-ray":"a0a0fcb86ffb31aa-LHR","x-jsr-backend":"modules","content-encoding":"identity","x-robots-tag":"noindex","content-length":"1404","etag":"\"487f74cbfda7ee9ae233ee344a378763\"","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/mcp/mcp_types.ts","time":1781184802}
