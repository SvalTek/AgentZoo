import { Client } from "npm:@modelcontextprotocol/sdk@^1/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@^1/client/streamableHttp.js";
import type { MCPClient } from "./mcp_client.ts";
import type {
  ElicitationCallback,
  MCPCallResult,
  MCPContentItem,
  MCPTool,
} from "./mcp_types.ts";

// ---------------------------------------------------------------------------
// MCPHttpClient - HTTP streamable transport
// ---------------------------------------------------------------------------

/** Configuration for an HTTP-based MCP server. */
export type MCPHttpConfig = {
  url: string;
  headers?: Record<string, string>;
};

/**
 * MCP client that communicates with a server via HTTP streaming (SSE).
 * Connects to a remote MCP server endpoint using the streamable HTTP transport.
 *
 * @example
 * ```ts
 * const client = new MCPHttpClient({ url: "https://mcp.example.com/api" });
 * await client.connect();
 * const tools = await client.listTools();
 * ```
 */
export class MCPHttpClient implements MCPClient {
  private _config: MCPHttpConfig;
  private _client: Client | null = null;
  private _serverInstructions: string | undefined;
  private _elicitationCallback: ElicitationCallback | undefined;

  constructor(
    config: MCPHttpConfig,
    options?: { elicitationCallback?: ElicitationCallback },
  ) {
    this._config = config;
    this._elicitationCallback = options?.elicitationCallback;
  }

  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(
      new URL(this._config.url),
      {
        requestInit: this._config.headers
          ? { headers: this._config.headers }
          : undefined,
      },
    );

    const client = new Client(
      { name: "vibes-sdk", version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    this._client = client;

    // Extract server instructions if provided in the server info
    const serverInfo = client.getServerVersion();
    if (
      serverInfo && typeof serverInfo === "object" &&
      "instructions" in serverInfo
    ) {
      this._serverInstructions = serverInfo.instructions as string | undefined;
    }

    // Register elicitation handler if callback provided
    if (this._elicitationCallback) {
      this._registerElicitationHandler(client);
    }
  }

  async disconnect(): Promise<void> {
    if (this._client) {
      await this._client.close();
      this._client = null;
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const client = this._assertConnected();
    const result = await client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPCallResult> {
    const client = this._assertConnected();
    const result = await client.callTool({ name, arguments: args });

    const content: MCPContentItem[] = (result.content as unknown[]).map(
      (item) => {
        const c = item as Record<string, unknown>;
        if (c["type"] === "image") {
          return {
            type: "image" as const,
            data: c["data"] as string,
            mimeType: c["mimeType"] as string,
          };
        }
        return {
          type: "text" as const,
          text: c["text"] as string ?? String(c),
        };
      },
    );

    return {
      content,
      isError: result.isError as boolean | undefined,
    };
  }

  getServerInstructions(): string | undefined {
    return this._serverInstructions;
  }

  private _assertConnected(): Client {
    if (!this._client) {
      throw new Error("MCPHttpClient: not connected. Call connect() first.");
    }
    return this._client;
  }

  private _registerElicitationHandler(client: Client): void {
    try {
      const c = client as unknown as Record<string, unknown>;
      if (typeof c["setRequestHandler"] === "function") {
        const setRequestHandler = c["setRequestHandler"] as (
          schema: { method: string },
          handler: (req: { params: { message: string; requestedSchema: Record<string, unknown> } }) => Promise<unknown>,
        ) => void;
        setRequestHandler(
          { method: "elicitation/create" },
          async (req) => {
            const cb = this._elicitationCallback!;
            const response = await cb({
              message: req.params.message,
              schema: req.params.requestedSchema,
            });
            return { action: "accept", content: response };
          },
        );
      }
    } catch {
      // Elicitation not supported by this server version - ignore
    }
  }
}

// denoCacheMetadata={"headers":{"nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=H4wNbu9zkCzkSqkknRZ%2FAj7R4ta%2F6s%2Bl6uKuh7ZG%2B0vM%2F8S2BAwkpiDSFYYWtD%2Btr2oe6ge%2F7yoVMg7qv0jER0sFPezg6yDNB7mFMDebO%2BS5aJIwuOIHf%2Fs%3D\"}]}","access-control-allow-origin":"*","access-control-expose-headers":"*","cross-origin-resource-policy":"cross-origin","alt-svc":"h3=\":443\"; ma=86400","cf-ray":"a0a0fcb8680331aa-LHR","server":"cloudflare","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","content-type":"text/typescript","etag":"\"cc3c4719edf836ba00966b94da21b194\"","cache-control":"public, max-age=31536000, immutable","vary":"Origin","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex","content-length":"4762","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/mcp/mcp_http.ts","time":1781184802}