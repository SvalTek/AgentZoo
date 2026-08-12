import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";

/**
 * A composable group of tools. Toolsets are resolved per-turn so they can
 * dynamically include or exclude tools based on the run context.
 *
 * Optional lifecycle hooks mirror Pydantic AI's `AbstractToolset.for_run` /
 * `for_run_step` pattern and enable per-run or per-step state isolation:
 *
 * - `forRun` is called once before the first model turn. Override it to return
 *   a fresh instance scoped to a single run (e.g. open a connection).
 * - `forRunStep` is called at the start of every model turn. Override it to
 *   return a modified instance for that step (e.g. apply step-level filters).
 *
 * Both default to returning `this` (the same shared instance) when not
 * implemented, preserving the existing zero-overhead behaviour for toolsets
 * that do not need isolation.
 */
export interface Toolset<TDeps = undefined> {
  tools(
    ctx: RunContext<TDeps>,
  ): ToolDefinition<TDeps>[] | Promise<ToolDefinition<TDeps>[]>;

  /**
   * Return the toolset instance to use for an entire agent run.
   *
   * Called once per run, before the first model turn. The returned instance
   * (which may be `this` or a fresh copy) is then used for every turn of that
   * run. Override to achieve per-run state isolation — for example, to open
   * a database connection that lives for the lifetime of the run.
   *
   * Default: returns `this` unchanged.
   */
  forRun?(
    ctx: RunContext<TDeps>,
  ): Toolset<TDeps> | Promise<Toolset<TDeps>>;

  /**
   * Return the toolset instance to use for a single model turn (step).
   *
   * Called at the start of every turn with the run-scoped toolset returned by
   * `forRun`. Override to apply per-step mutations or to return a step-scoped
   * copy — for example, to snapshot mutable state before each tool execution.
   *
   * Default: returns `this` unchanged.
   */
  forRunStep?(
    ctx: RunContext<TDeps>,
  ): Toolset<TDeps> | Promise<Toolset<TDeps>>;
}

// denoCacheMetadata={"headers":{"content-length":"2032","x-content-type-options":"nosniff","access-control-allow-origin":"*","access-control-expose-headers":"*","cache-control":"public, max-age=31536000, immutable","cross-origin-resource-policy":"cross-origin","x-jsr-backend":"modules","vary":"Origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cf-ray":"a0a0fcb86f7e31aa-LHR","date":"Thu, 11 Jun 2026 13:33:23 GMT","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=cQEMiv%2BLFDucs6b6rPZhUU9JkZ1a07vQMRz9ZZ34N6Ch74JDUEcjrZHyFyfSA%2FRmBAdOHSH9UuiOr8DMH7A0QFf9WGgKNCazoji4y0Pjz8t7zyPT0W%2FldjU%3D\"}]}","alt-svc":"h3=\":443\"; ma=86400","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","etag":"\"7ab36080c51486a358d78dd31c3851d1\"","x-robots-tag":"noindex","content-encoding":"identity","content-type":"text/typescript","server":"cloudflare"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/toolset.ts","time":1781184802}