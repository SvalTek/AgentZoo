import type { Usage } from "./context.ts";

// ---------------------------------------------------------------------------
// AgentStreamEvent - discriminated union of all events emitted by
// agent.runStreamEvents().
// ---------------------------------------------------------------------------

/**
 * Typed events emitted by `agent.runStreamEvents()`.
 *
 * Consumers iterate over an `AsyncIterable<AgentStreamEvent<TOutput>>` and
 * switch on `event.kind` to handle each event type.
 */
export type AgentStreamEvent<TOutput = string> =
  /** Fired at the start of every model turn (turn numbering starts at 0). */
  | { kind: "turn-start"; turn: number }
  /** A text token delta arrived from the model. */
  | { kind: "text-delta"; delta: string }
  /** The model requested a tool call (args may still be streaming). */
  | {
    kind: "tool-call-start";
    toolName: string;
    toolCallId: string;
    args: Record<string, unknown>;
  }
  /** A tool call finished and returned its result. */
  | {
    kind: "tool-call-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
  }
  /**
   * Best-effort partial structured output - emitted progressively as
   * `final_result` tool args stream in. Only emitted in `'tool'` output mode
   * and only when the accumulated args parse successfully.
   */
  | { kind: "partial-output"; partial: unknown }
  /** The run completed successfully. */
  | { kind: "final-result"; output: TOutput }
  /** Token usage snapshot (emitted once per model turn, after it completes). */
  | { kind: "usage-update"; usage: Usage }
  /** An error occurred; the stream will not yield further events. */
  | { kind: "error"; error: unknown };

// denoCacheMetadata={"headers":{"x-jsr-backend":"modules","cache-control":"public, max-age=31536000, immutable","access-control-allow-origin":"*","etag":"\"8b884b1749537245235402a3cb88d24f\"","date":"Thu, 11 Jun 2026 13:33:22 GMT","content-encoding":"identity","alt-svc":"h3=\":443\"; ma=86400","cf-ray":"a0a0fcb86f7331aa-LHR","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=daX0%2F01BNzQfxrXkRDw1pDlqf0FB2CR5bdKSfDJipRrFJOTjvVqyP9%2BEgrNKUapiaUMTxuZMoGXn%2Bo%2BuMshiN3MX9lf8WpqWoILsKY8JFLkVY0OCuqzH2p0%3D\"}]}","vary":"Origin","x-content-type-options":"nosniff","content-type":"text/typescript","content-length":"1697","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-expose-headers":"*","cross-origin-resource-policy":"cross-origin","server":"cloudflare","x-robots-tag":"noindex"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/events.ts","time":1781184802}