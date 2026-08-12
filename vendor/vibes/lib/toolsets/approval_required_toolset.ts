import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * Wraps any toolset and marks all its tools as requiring human approval
 * before execution. When the model calls any of these tools, the run pauses
 * and throws an `ApprovalRequiredError` with a `DeferredToolRequests` object.
 *
 * The caller can inspect pending requests, then call `agent.resume()` with
 * approved results to continue.
 *
 * @example
 * ```ts
 * const safeSearch = new ApprovalRequiredToolset(searchToolset);
 * const agent = new Agent({ model, toolsets: [safeSearch] });
 *
 * try {
 *   await agent.run("Search for something sensitive");
 * } catch (err) {
 *   if (err instanceof ApprovalRequiredError) {
 *     // Review err.deferred.requests, then resume
 *     const result = await agent.resume(err.deferred, { results: [...] });
 *   }
 * }
 * ```
 */
export class ApprovalRequiredToolset<TDeps = undefined>
  implements Toolset<TDeps> {
  constructor(private readonly inner: Toolset<TDeps>) {}

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const innerTools = await this.inner.tools(ctx);
    return innerTools.map((t) => ({
      ...t,
      requiresApproval: true as const,
    }));
  }
}

// denoCacheMetadata={"headers":{"x-content-type-options":"nosniff","alt-svc":"h3=\":443\"; ma=86400","access-control-allow-origin":"*","x-robots-tag":"noindex","content-length":"1308","vary":"Origin","content-type":"text/typescript","etag":"\"887d3f738d4bf12bb02849dbc640a817\"","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-encoding":"identity","access-control-expose-headers":"*","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=vu4YHEcwYd5WlKleZq%2Fb5h1IeEvn3Fwe7OMyVu6s7f04ZwEBrEl5%2FLrCxzQQ1Kfcz6aLrINaNS2bF6vUR3hgmusPKBYjziTzez1XAeirfbz19VBzhK%2FPzxI%3D\"}]}","cf-ray":"a0a0fcb86f8b31aa-LHR","cache-control":"public, max-age=31536000, immutable","date":"Thu, 11 Jun 2026 13:33:23 GMT","server":"cloudflare","x-jsr-backend":"modules","cross-origin-resource-policy":"cross-origin"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/approval_required_toolset.ts","time":1781184802}