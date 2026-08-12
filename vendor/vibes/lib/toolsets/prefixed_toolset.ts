import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * Adds a prefix to every tool name in the wrapped toolset. Useful when
 * composing toolsets that may have naming conflicts.
 * Equivalent to Pydantic AI's `PrefixedToolset`.
 *
 * @example
 * ```ts
 * const prefixed = new PrefixedToolset(searchToolset, "web_");
 * // "search" becomes "web_search", etc.
 * ```
 */
export class PrefixedToolset<TDeps = undefined> implements Toolset<TDeps> {
  constructor(
    private readonly inner: Toolset<TDeps>,
    private readonly prefix: string,
  ) {}

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const list = await this.inner.tools(ctx);
    return list.map((t) => ({ ...t, name: `${this.prefix}${t.name}` }));
  }
}

/**
 * Renames specific tools in the wrapped toolset using a mapping of
 * `{ oldName: newName }`. Tools not in the map are unchanged.
 * Equivalent to Pydantic AI's `RenamedToolset`.
 *
 * @example
 * ```ts
 * const renamed = new RenamedToolset(myToolset, { search: "find" });
 * ```
 */
export class RenamedToolset<TDeps = undefined> implements Toolset<TDeps> {
  constructor(
    private readonly inner: Toolset<TDeps>,
    private readonly nameMap: Record<string, string>,
  ) {}

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const list = await this.inner.tools(ctx);
    return list.map((t) => {
      const newName = this.nameMap[t.name];
      return newName !== undefined ? { ...t, name: newName } : t;
    });
  }
}

// denoCacheMetadata={"headers":{"content-encoding":"identity","vary":"Origin","cross-origin-resource-policy":"cross-origin","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=tULN8A87nFy%2Fg6nL75W2So4GOjGwFQXq6RsBAEecgFMvj0mx9ijjM6KMEpaDQUk3Sj53rK4MXfsiSulBFdNmcCy3C4dP0%2B5EsbNZKTVNckaCLtZVIqAo0PI%3D\"}]}","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","content-type":"text/typescript","x-content-type-options":"nosniff","access-control-expose-headers":"*","content-length":"1610","x-jsr-backend":"modules","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cf-ray":"a0a0fcb86f8531aa-LHR","date":"Thu, 11 Jun 2026 13:33:23 GMT","alt-svc":"h3=\":443\"; ma=86400","server":"cloudflare","cache-control":"public, max-age=31536000, immutable","x-robots-tag":"noindex","etag":"\"f3839b7e852cd238f2addb8a5a954383\"","access-control-allow-origin":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/prefixed_toolset.ts","time":1781184802}