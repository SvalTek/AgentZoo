import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * A simple toolset that wraps an array of tool definitions.
 * Equivalent to Pydantic AI's `FunctionToolset`.
 *
 * @example
 * ```ts
 * const myToolset = new FunctionToolset([searchTool, fetchTool]);
 * const agent = new Agent({ model, toolsets: [myToolset] });
 * ```
 */
export class FunctionToolset<TDeps = undefined> implements Toolset<TDeps> {
  private _tools: ToolDefinition<TDeps>[];

  constructor(tools: ToolDefinition<TDeps>[] = []) {
    this._tools = [...tools];
  }

  addTool(t: ToolDefinition<TDeps>): void {
    this._tools.push(t);
  }

  tools(): ToolDefinition<TDeps>[] {
    return [...this._tools];
  }
}

// denoCacheMetadata={"headers":{"nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","etag":"\"a293ae9fc2cb7ec847ab076023f0216a\"","content-length":"729","cache-control":"public, max-age=31536000, immutable","vary":"Origin","access-control-expose-headers":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cross-origin-resource-policy":"cross-origin","alt-svc":"h3=\":443\"; ma=86400","access-control-allow-origin":"*","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=ZAf2YMKUlmqCnVcTI%2B6c%2BPxVVNHuPNiIT7QqB%2FKzEIHGi82%2FAeXOsUPD4fo6DiyFtK9RVFhS80gYO9Av49q3lfRyKJBylWx5mFSvmJVctjeXQo7LOWTw45w%3D\"}]}","x-content-type-options":"nosniff","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-jsr-backend":"modules","content-encoding":"identity","server":"cloudflare","x-robots-tag":"noindex","cf-ray":"a0a0fcb86f8031aa-LHR","content-type":"text/typescript"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/function_toolset.ts","time":1781184802}