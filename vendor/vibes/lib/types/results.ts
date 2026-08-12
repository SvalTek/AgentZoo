import type { ModelMessage } from "npm:ai@^6";
import type { RunContext, Usage } from "./context.ts";

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * A result validator receives the run context and the parsed output.
 * Return the (optionally modified) output to accept it, or throw to reject and retry.
 */
export type ResultValidator<TDeps, TOutput> = (
  ctx: RunContext<TDeps>,
  output: TOutput,
) => TOutput | Promise<TOutput>;

export interface RunResult<TOutput> {
  /** The typed output from the agent. */
  output: TOutput;
  /** Full message history for this run (can be passed back in as messageHistory). */
  messages: ModelMessage[];
  /** Messages added during this run only (excludes the passed-in messageHistory). */
  newMessages: ModelMessage[];
  /** Cumulative token usage across all turns. */
  usage: Usage;
  /** Number of result retries that occurred. */
  retryCount: number;
  /** Unique identifier for this run. */
  runId: string;
  /** Metadata attached by tools during the run, keyed by tool call ID. */
  toolMetadata: Map<string, Record<string, unknown>>;
}

export interface StreamResult<TOutput> {
  /** Async iterable of text deltas as they stream in. */
  textStream: AsyncIterable<string>;
  /** Resolves to the final typed output once the run completes. */
  output: Promise<TOutput>;
  /** Resolves to the full message history once the run completes. */
  messages: Promise<ModelMessage[]>;
  /** Resolves to messages added during this run only (excludes passed-in history). */
  newMessages: Promise<ModelMessage[]>;
  /** Resolves to cumulative token usage once the run completes. */
  usage: Promise<Usage>;
  /**
   * Async iterable of partial output objects emitted progressively as the
   * `final_result` tool args stream in. Emits only when Zod parse succeeds
   * (best-effort). Only populated when `outputMode` is `'tool'`.
   */
  partialOutput: AsyncIterable<TOutput>;
}

// denoCacheMetadata={"headers":{"x-content-type-options":"nosniff","content-encoding":"identity","access-control-allow-origin":"*","alt-svc":"h3=\":443\"; ma=86400","date":"Thu, 11 Jun 2026 13:33:23 GMT","access-control-expose-headers":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=ukqeWwlV%2BP0SkiXNkf1c1b%2F7uh2l9uPSvEbszHnqjPlMEm%2FxjxXN66pWi4IybP2Risgn9JeipnS7Toa%2B%2BAcfR%2FKBJXDre14Uo%2FOLuWaMYZH0A1oAL%2F%2B1Efg%3D\"}]}","x-robots-tag":"noindex","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cache-control":"public, max-age=31536000, immutable","cross-origin-resource-policy":"cross-origin","content-length":"2053","etag":"\"c2c74680ee0d41b51d88c993c4d8447f\"","content-type":"text/typescript","server":"cloudflare","vary":"Origin","cf-ray":"a0a0fcb86fd831aa-LHR"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/results.ts","time":1781184802}