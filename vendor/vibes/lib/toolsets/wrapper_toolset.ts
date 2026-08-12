import type { z, ZodType } from "npm:zod@^4";
import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * The `next` function passed to `callTool` - invokes the wrapped tool's
 * original `execute` implementation.
 */
export type ToolCallNext<TDeps> = (
  ctx: RunContext<TDeps>,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Abstract base class that intercepts every tool execution in the wrapped
 * toolset. Subclasses override `callTool` to add middleware behaviour such as
 * logging, metrics, rate-limiting, error wrapping, or argument/result
 * transformation.
 *
 * Equivalent to Pydantic AI's `WrapperToolset` / middleware pattern.
 *
 * @example
 * ```ts
 * class LoggingToolset extends WrapperToolset<MyDeps> {
 *   async callTool(ctx, toolName, args, next) {
 *     console.log(`calling ${toolName}`, args);
 *     const result = await next(ctx, args);
 *     console.log(`${toolName} returned`, result);
 *     return result;
 *   }
 * }
 *
 * const agent = new Agent({ model, toolsets: [new LoggingToolset(myTools)] });
 * ```
 */
export abstract class WrapperToolset<TDeps = undefined>
  implements Toolset<TDeps> {
  private readonly _inner: Toolset<TDeps>;

  constructor(inner: Toolset<TDeps>) {
    this._inner = inner;
  }

  /**
   * Override this method to intercept tool execution.
   *
   * @param ctx       - The current run context.
   * @param toolName  - Name of the tool being called.
   * @param args      - Parsed arguments the model passed to the tool.
   * @param next      - Call this to invoke the underlying tool implementation.
   *                    You may modify `ctx` or `args` before passing them, or
   *                    transform the return value afterwards.
   */
  abstract callTool(
    ctx: RunContext<TDeps>,
    toolName: string,
    args: Record<string, unknown>,
    next: ToolCallNext<TDeps>,
  ): Promise<unknown>;

  async tools(ctx: RunContext<TDeps>): Promise<ToolDefinition<TDeps>[]> {
    const innerTools = await this._inner.tools(ctx);
    return innerTools.map((t): ToolDefinition<TDeps> => {
      const originalExecute = t.execute;

      return {
        ...t,
        // The ToolDefinition.execute signature uses `z.infer<ZodType>`
        // which resolves to `unknown`. We accept `unknown` here and cast to
        // `Record<string, unknown>` when forwarding to callTool, since the AI
        // SDK will always supply a parsed object at runtime.
        execute: (execCtx: RunContext<TDeps>, args: z.infer<ZodType>) => {
          const argsRecord = args as Record<string, unknown>;
          const next: ToolCallNext<TDeps> = (nextCtx, nextArgs) =>
            originalExecute(nextCtx, nextArgs);

          return this.callTool(
            execCtx,
            t.name,
            argsRecord,
            next,
          ) as ReturnType<
            typeof originalExecute
          >;
        },
      };
    });
  }
}

// denoCacheMetadata={"headers":{"cf-ray":"a0a0fcb86f8731aa-LHR","cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-expose-headers":"*","access-control-allow-origin":"*","etag":"\"bab86d6155544619f95a166bd92e1d83\"","content-type":"text/typescript","alt-svc":"h3=\":443\"; ma=86400","content-length":"3012","x-jsr-backend":"modules","server":"cloudflare","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","content-encoding":"identity","cross-origin-resource-policy":"cross-origin","date":"Thu, 11 Jun 2026 13:33:23 GMT","vary":"Origin","x-robots-tag":"noindex","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Ijdz6BoYz212pwNk%2FE7LpiV0wTntxtQOn3%2FfdvqcdEI7CTtfdRocLpwGBMvn%2Fsjp9nWTHuZz5AZgXvCI5lECr3rUa%2BePuawHAo8U28BZL70sZQwqgKH9uu0%3D\"}]}"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/wrapper_toolset.ts","time":1781184802}