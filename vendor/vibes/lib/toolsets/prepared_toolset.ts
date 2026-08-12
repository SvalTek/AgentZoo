import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * A function that receives the current context and the inner toolset's resolved
 * tools, and returns a (possibly modified) list of tools to expose this turn.
 * May add, remove, or reorder tools.
 */
export type PrepareFunction<TDeps = undefined> = (
  ctx: RunContext<TDeps>,
  tools: ToolDefinition<TDeps>[],
) => ToolDefinition<TDeps>[] | Promise<ToolDefinition<TDeps>[]>;

/**
 * Wraps a toolset and calls a `prepare` function on every turn so the exposed
 * tool list can be modified based on the current run context. Useful for
 * dynamically enabling/disabling individual tools, reordering, or injecting
 * context-aware tool variants.
 *
 * Unlike `FilteredToolset` (all-or-nothing), `PreparedToolset` gives
 * fine-grained per-tool control.
 *
 * Equivalent to Pydantic AI's prepared tool pattern.
 *
 * @example
 * ```ts
 * // Only expose "delete" tool after the user has confirmed.
 * const safe = new PreparedToolset(adminTools, (ctx, tools) =>
 *   ctx.deps.confirmed ? tools : tools.filter((t) => t.name !== "delete"),
 * );
 * ```
 */
export class PreparedToolset<TDeps = undefined> implements Toolset<TDeps> {
  private readonly _inner: Toolset<TDeps>;
  private readonly _prepare: PrepareFunction<TDeps>;

  constructor(inner: Toolset<TDeps>, prepare: PrepareFunction<TDeps>) {
    this._inner = inner;
    this._prepare = prepare;
  }

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const innerTools = await this._inner.tools(ctx);
    return this._prepare(ctx, innerTools);
  }
}

// denoCacheMetadata={"headers":{"etag":"\"e1bebb93be427a536fc7605a2c58f81b\"","cross-origin-resource-policy":"cross-origin","x-content-type-options":"nosniff","content-type":"text/typescript","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","content-length":"1687","access-control-expose-headers":"*","cache-control":"public, max-age=31536000, immutable","server":"cloudflare","cf-ray":"a0a0fcb86f8631aa-LHR","date":"Thu, 11 Jun 2026 13:33:23 GMT","access-control-allow-origin":"*","content-encoding":"identity","vary":"Origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=eMp7RWwvBdvv3ie65%2Bl4wv3UAoJtwtws5xN8nU7Lykgnr6AOOqO9v14%2BREyazs%2B61Y0QjuMb%2BI%2BnAhDaW3cXu1FYqk%2FOMwGGULWRtV7ldDaqEvlAwXaiKDE%3D\"}]}","x-robots-tag":"noindex","alt-svc":"h3=\":443\"; ma=86400"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/prepared_toolset.ts","time":1781184802}