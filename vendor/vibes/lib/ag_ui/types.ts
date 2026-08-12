// ---------------------------------------------------------------------------
// AG-UI event types per the CopilotKit AG-UI specification
//
// These events are emitted as Server-Sent Events (SSE) when using the
// AGUIAdapter. Each event is serialized as JSON in the SSE data field.
// ---------------------------------------------------------------------------

export type AGUIEvent =
  /** Emitted once at the start of an agent run. */
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  /** Emitted once when an agent run completes successfully. */
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  /** Emitted when an unrecoverable error occurs during a run. */
  | { type: "RUN_ERROR"; message: string; code?: string }
  /** Marks the beginning of a text message from the assistant. */
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  /** A text token delta - one or more characters of streamed text. */
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  /** Marks the end of a text message. */
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  /** The model is starting a tool call. */
  | {
    type: "TOOL_CALL_START";
    toolCallId: string;
    toolCallName: string;
    parentMessageId?: string;
  }
  /** Streamed tool call argument delta. */
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  /** Tool call has completed (result is available). */
  | { type: "TOOL_CALL_END"; toolCallId: string }
  /** A full snapshot of the current agent state. */
  | { type: "STATE_SNAPSHOT"; snapshot: Record<string, unknown> }
  /** Incremental JSON patch operations to apply to the agent state. */
  | { type: "STATE_DELTA"; delta: unknown[] }
  /** Full snapshot of the current conversation messages. */
  | { type: "MESSAGES_SNAPSHOT"; messages: unknown[] }
  /** A raw passthrough event from the underlying agent runtime. */
  | { type: "RAW"; event: string; source?: string }
  /** A named step within a run has started. */
  | { type: "STEP_STARTED"; stepName: string }
  /** A named step within a run has finished. */
  | { type: "STEP_FINISHED"; stepName: string };

// denoCacheMetadata={"headers":{"x-content-type-options":"nosniff","server":"cloudflare","content-type":"text/typescript","alt-svc":"h3=\":443\"; ma=86400","cf-ray":"a0a0fcb86f9f31aa-LHR","cross-origin-resource-policy":"cross-origin","date":"Thu, 11 Jun 2026 13:33:22 GMT","x-jsr-backend":"modules","x-robots-tag":"noindex","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=AhqT63MGydcQcZaM0EqpFNQJqJK80PQA%2FwB6MtU8ZzZhEXkCnwXkbgmjYjBsHeLxlc3wjlGrzCz1NjGAmdC0HPn8A1j4nDeDLnco%2FQJJBCK2cGbB7UJmo%2Bw%3D\"}]}","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","content-length":"2173","etag":"\"0152c3292a868f2b5bf38a3289cda8b7\"","content-encoding":"identity","cache-control":"public, max-age=31536000, immutable","vary":"Origin","access-control-allow-origin":"*","access-control-expose-headers":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/ag_ui/types.ts","time":1781184802}