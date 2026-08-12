import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * Merges multiple toolsets into one. Tools from all member toolsets are
 * combined; if two tools share the same name the last one wins.
 * Equivalent to Pydantic AI's `CombinedToolset`.
 *
 * @example
 * ```ts
 * const combined = new CombinedToolset(searchToolset, fetchToolset);
 * const agent = new Agent({ model, toolsets: [combined] });
 * ```
 */
export class CombinedToolset<TDeps = undefined> implements Toolset<TDeps> {
  private _toolsets: Toolset<TDeps>[];

  constructor(...toolsets: Toolset<TDeps>[]) {
    this._toolsets = toolsets;
  }

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const byName = new Map<string, ToolDefinition<TDeps>>();
    for (const ts of this._toolsets) {
      const list = await ts.tools(ctx);
      for (const t of list) {
        byName.set(t.name, t);
      }
    }
    return [...byName.values()];
  }
}

// denoCacheMetadata={"headers":{"report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=MoJma8%2Bw%2BXB6e3xAceAFY1%2BgqhoGXwyw4egOW2otM8curQskfYL6HJJzNvY8cDBL6XdwWuUW%2BaqVjJQ%2FRT%2BtQ%2FKZgj4rjtRxR4qNBDVTuSc5Mgn4SLzRaaA%3D\"}]}","access-control-allow-origin":"*","access-control-expose-headers":"*","x-robots-tag":"noindex","vary":"Origin","content-encoding":"identity","alt-svc":"h3=\":443\"; ma=86400","etag":"\"d030d699b993bcd6f4148c056c7dbe1f\"","content-length":"1036","cf-ray":"a0a0fcb86f8231aa-LHR","content-type":"text/typescript","date":"Thu, 11 Jun 2026 13:33:23 GMT","cross-origin-resource-policy":"cross-origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","server":"cloudflare","x-jsr-backend":"modules","cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/combined_toolset.ts","time":1781184802}