import type { ModelMessage } from "npm:ai@^6";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** Token usage accumulated across all turns in a run. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
}

/** Creates a zeroed-out {@link Usage} object to accumulate token counts across turns. */
export function createUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
}

// ---------------------------------------------------------------------------
// RunContext
// ---------------------------------------------------------------------------

export interface RunContext<TDeps = undefined> {
  /** User-supplied dependencies, injected at run time. */
  deps: TDeps;
  /** Cumulative token usage for this run so far. */
  usage: Usage;
  /** How many times the current result has been retried. */
  retryCount: number;
  /** Name of the tool currently executing, or null outside a tool call. */
  toolName: string | null;
  /** Unique identifier for this run. */
  runId: string;
  /** Per-run metadata supplied by the caller. */
  metadata: Record<string, unknown>;
  /**
   * Metadata attached by tools after execution, keyed by tool call ID.
   * Tools call `attachMetadata(toolCallId, meta)` to populate this map.
   */
  toolResultMetadata: Map<string, Record<string, unknown>>;
  /**
   * Attach arbitrary metadata for a specific tool call. Tools invoke this
   * inside their `execute` function to expose extra data to callers.
   */
  attachMetadata(toolCallId: string, meta: Record<string, unknown>): void;
}

// Re-export ModelMessage for convenience (used by results.ts)
export type { ModelMessage };

// denoCacheMetadata={"headers":{"nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","x-robots-tag":"noindex","x-jsr-backend":"modules","x-content-type-options":"nosniff","cross-origin-resource-policy":"cross-origin","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-length":"1840","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Axnp5R81eEBpQKBx1%2BtUwJaei9zaFrYlOpqK5i6TM5MbHWFbY%2BP78naGjbBEbw3GZPFuiPdthsjv5CDfndqIpymiRaOIcRoZ2BWM6jhcan0fsuO1Vw5d1jU%3D\"}]}","content-encoding":"identity","content-type":"text/typescript","server":"cloudflare","cf-ray":"a0a0fcb86fd031aa-LHR","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-allow-origin":"*","vary":"Origin","alt-svc":"h3=\":443\"; ma=86400","etag":"\"e27f0dcf6ee9bcb18e8e3b20c2a057dd\""},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/context.ts","time":1781184802}