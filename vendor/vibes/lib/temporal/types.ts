/**
 * Types for the Temporal durable execution integration.
 *
 * These types are framework-agnostic and can be used both from Deno (for type
 * checking and building activity/workflow registrations) and from Node.js (where
 * the actual Temporal worker and workflow runtime live).
 */

import type { ModelMessage } from "npm:ai@^6";
import type { RunResult } from "../types/results.ts";

// ---------------------------------------------------------------------------
// Activity options
// ---------------------------------------------------------------------------

/** Configuration for a single Temporal activity. */
export interface TemporalActivityOptions {
  /**
   * Maximum time the activity may run from start to close (including retries).
   * Format: "30s", "5m", "1h".
   */
  startToCloseTimeout?: string;
  /** Retry policy for this activity. */
  retryPolicy?: {
    /** Maximum number of attempts (including the first). */
    maximumAttempts?: number;
    /**
     * Initial backoff interval between retries.
     * Format: "1s", "500ms".
     */
    initialInterval?: string;
    /** Multiplier applied to the interval after each retry. */
    backoffCoefficient?: number;
  };
}

// ---------------------------------------------------------------------------
// Agent-level options
// ---------------------------------------------------------------------------

/** Configuration for a {@link TemporalAgent}. */
export interface TemporalAgentOptions<TDeps> {
  /**
   * Temporal task queue this agent's activities and workflow will be
   * registered on.
   */
  taskQueue: string;
  /** Activity options for model-call activities. */
  modelCallActivity?: TemporalActivityOptions;
  /** Activity options for tool-call activities. */
  toolCallActivity?: TemporalActivityOptions;
  /**
   * Factory that creates the `deps` object inside the Temporal worker
   * process. Dependencies typically cannot be serialized across the
   * workflow/activity boundary, so they must be re-created on the worker.
   */
  depsFactory?: () => TDeps | Promise<TDeps>;
}

// ---------------------------------------------------------------------------
// Serializable run options (workflow-safe subset of RunOptions)
// ---------------------------------------------------------------------------

/**
 * Subset of {@link RunOptions} that can be serialized and passed across the
 * Temporal workflow/activity boundary (no functions, no non-serializable types).
 */
export interface SerializableRunOptions {
  /** Serialized message history (JSON-safe). */
  messageHistory?: SerializableMessage[];
  /** Per-run metadata. Must be JSON-serializable. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Serializable message format
// ---------------------------------------------------------------------------

/**
 * A JSON-serializable representation of a {@link ModelMessage}.
 *
 * `ModelMessage` from the AI SDK is already JSON-serializable; this type
 * makes the contract explicit for Temporal payloads.
 */
export interface SerializableMessage {
  role: string;
  content: string | unknown[];
}

// ---------------------------------------------------------------------------
// Activity parameter / result shapes
// ---------------------------------------------------------------------------

/** Parameters passed to the `runModelTurn` activity. */
export interface ModelTurnParams {
  /** Serialized conversation history so far. */
  messages: SerializableMessage[];
  /** The user prompt for this turn (only set on the first turn). */
  prompt: string;
  /** Optional per-run metadata. */
  metadata?: Record<string, unknown>;
}

/** Result returned by the `runModelTurn` activity. */
export interface ModelTurnResult {
  /** New messages produced during this model turn. */
  newMessages: SerializableMessage[];
  /** Whether the run has produced a final result yet. */
  done: boolean;
  /** The final output (only set when `done` is true). */
  output?: unknown;
  /** Serialized usage stats for this turn. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
  };
}

/** Parameters passed to the `runToolCall` activity. */
export interface ToolCallParams {
  /** Name of the tool to invoke. */
  toolName: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Tool call ID from the model response. */
  toolCallId: string;
  /** Current conversation history (for context). */
  messages: SerializableMessage[];
  /** Optional per-run metadata. */
  metadata?: Record<string, unknown>;
}

/** Result returned by the `runToolCall` activity. */
export interface ToolCallResult {
  /** Tool call ID (echoed back for correlation). */
  toolCallId: string;
  /** The serializable result of the tool. */
  result: unknown;
}

// ---------------------------------------------------------------------------
// Activity history entry (used by MockTemporalAgent)
// ---------------------------------------------------------------------------

/** A single entry in the activity call history recorded by MockTemporalAgent. */
export interface ActivityHistoryEntry {
  /** Name of the activity that was called. */
  activity: string;
  /** Parameters passed to the activity. */
  params: unknown;
  /** Result returned by the activity. */
  result: unknown;
}

// ---------------------------------------------------------------------------
// Re-export RunOptions / RunResult for convenience (callers use this module)
// ---------------------------------------------------------------------------
export type { RunOptions } from "../agent.ts";
export type { ModelMessage, RunResult };

// denoCacheMetadata={"headers":{"date":"Thu, 11 Jun 2026 13:33:23 GMT","content-type":"text/typescript","cache-control":"public, max-age=31536000, immutable","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=7PHeP6E0H%2FKug5y6TPyJi1MmIRSiOavKVKZTAIzDC6pyD5EJLNF%2FTZMokc%2BRyTQfboJBSSq12d3dlqVBm8csdg9YPHgdM6XN9SRzOm8Akmc4%2BL%2BqedIZYrM%3D\"}]}","cf-ray":"a0a0fcb86fb031aa-LHR","access-control-allow-origin":"*","x-robots-tag":"noindex","alt-svc":"h3=\":443\"; ma=86400","content-encoding":"identity","access-control-expose-headers":"*","etag":"\"14a79471ad855f7e72bf9669a029bb32\"","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","x-jsr-backend":"modules","cross-origin-resource-policy":"cross-origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","content-length":"5753","vary":"Origin","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/temporal/types.ts","time":1781184802}