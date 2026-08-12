import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * Wraps a toolset with a per-turn predicate. On each turn the predicate
 * receives the run context and returns `true` to expose the full toolset or
 * `false` to hide it entirely.
 * Equivalent to Pydantic AI's `FilteredToolset`.
 *
 * @example
 * ```ts
 * // Only expose admin tools when the user is an admin.
 * const filtered = new FilteredToolset(
 *   adminToolset,
 *   (ctx) => ctx.deps.user.isAdmin,
 * );
 * ```
 */
export class FilteredToolset<TDeps = undefined> implements Toolset<TDeps> {
  constructor(
    private readonly inner: Toolset<TDeps>,
    private readonly predicate: (
      ctx: RunContext<TDeps>,
    ) => boolean | Promise<boolean>,
  ) {}

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const allowed = await this.predicate(ctx);
    if (!allowed) return [];
    return this.inner.tools(ctx);
  }
}

// denoCacheMetadata={"headers":{"alt-svc":"h3=\":443\"; ma=86400","access-control-allow-origin":"*","cache-control":"public, max-age=31536000, immutable","x-jsr-backend":"modules","etag":"\"704c57ea22379995c8ee331a7ef8d863\"","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=DDFYL%2BWs85mb6ghLxImWWNNgSFadCMyHUHTZTsXU0%2FTDtaH6yurBaZIViE3mq0KIpxecSe%2F%2B3vPcIlIl8b0wwHNIPQqvnXEu7Ks8A7tzfDPzXQTb1rOUKQg%3D\"}]}","date":"Thu, 11 Jun 2026 13:33:23 GMT","server":"cloudflare","vary":"Origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cross-origin-resource-policy":"cross-origin","x-content-type-options":"nosniff","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-type":"text/typescript","content-encoding":"identity","x-robots-tag":"noindex","cf-ray":"a0a0fcb86f8331aa-LHR","content-length":"1016","access-control-expose-headers":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/filtered_toolset.ts","time":1781184802}