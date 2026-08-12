/**
 * Span creation helpers for users who want to add custom spans around agent
 * runs or record extra attributes on an existing span.
 *
 * These utilities complement the automatic spans created by the AI SDK's
 * `experimental_telemetry` integration. Use them when you need to:
 * - Wrap multiple agent invocations in a parent span.
 * - Attach structured attributes (model name, usage counts, etc.) to a span.
 */
import type { Span, Tracer } from "npm:@opentelemetry/api@^1";
import type { Usage } from "../types/context.ts";

// ---------------------------------------------------------------------------
// withAgentSpan
// ---------------------------------------------------------------------------

/**
 * Execute `fn` inside a new child span named `name`. The span is started before
 * `fn` is called and ended after `fn` resolves or rejects. If `fn` throws, the
 * span is marked with an error status before it is ended.
 *
 * @param tracer - An OpenTelemetry `Tracer` instance.
 * @param name - The span name.
 * @param fn - Async function to execute inside the span.
 * @returns The value returned by `fn`.
 *
 * @example
 * ```ts
 * const result = await withAgentSpan(tracer, "run-pipeline", async () => {
 *   const r1 = await agentA.run("step 1");
 *   return agentB.run(r1.output);
 * });
 * ```
 */
export async function withAgentSpan<T>(
  tracer: Tracer,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { SpanStatusCode } = await import("npm:@opentelemetry/api@^1");

  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(
        err instanceof Error ? err : new Error(String(err)),
      );
      throw err;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// recordUsageAttributes
// ---------------------------------------------------------------------------

/**
 * Attach token-usage counters from a `RunResult` to an existing span as
 * standard `gen_ai.*` semantic-convention attributes.
 *
 * @param span - The span to annotate.
 * @param usage - The `Usage` object from `RunResult.usage`.
 */
export function recordUsageAttributes(span: Span, usage: Usage): void {
  span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
  span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
  span.setAttribute("gen_ai.usage.total_tokens", usage.totalTokens);
  span.setAttribute("gen_ai.usage.requests", usage.requests);
}

// ---------------------------------------------------------------------------
// recordRunAttributes
// ---------------------------------------------------------------------------

/**
 * Attach common agent-run attributes to a span.
 *
 * @param span - The span to annotate.
 * @param opts.model - The model identifier string (e.g. `"claude-3-5-sonnet-20241022"`).
 * @param opts.agentName - Human-readable agent name.
 * @param opts.prompt - The user prompt. Omitted when `excludeContent` is `true`.
 * @param opts.excludeContent - When `true`, the `prompt` attribute is suppressed.
 */
export function recordRunAttributes(
  span: Span,
  opts: {
    model?: string;
    agentName?: string;
    prompt?: string;
    excludeContent?: boolean;
  },
): void {
  if (opts.model !== undefined) {
    span.setAttribute("gen_ai.request.model", opts.model);
  }

  if (opts.agentName !== undefined) {
    span.setAttribute("vibes.agent.name", opts.agentName);
  }

  if (opts.prompt !== undefined && opts.excludeContent !== true) {
    span.setAttribute("gen_ai.request.prompt", opts.prompt);
  }
}

// denoCacheMetadata={"headers":{"server":"cloudflare","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=tl9p7UurCsWjGRyK6YL4lWY0yUCOSmt9nI8mYLpn3rI6kK2gIEr0jFSggCtcQno0OrKX8CiVeQGotPTDry9WqYigQ%2FgOlmpKMRfYIlRM73w9Zjs5L2Mxy0Q%3D\"}]}","x-robots-tag":"noindex","access-control-allow-origin":"*","cache-control":"public, max-age=31536000, immutable","content-encoding":"identity","cf-ray":"a0a0fcb86fa631aa-LHR","x-content-type-options":"nosniff","cross-origin-resource-policy":"cross-origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-type":"text/typescript","access-control-expose-headers":"*","alt-svc":"h3=\":443\"; ma=86400","vary":"Origin","content-length":"3866","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","etag":"\"4ac1fe43d5d06538ca0758c308c5a1d7\"","date":"Thu, 11 Jun 2026 13:33:23 GMT"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/otel/spans.ts","time":1781184802}