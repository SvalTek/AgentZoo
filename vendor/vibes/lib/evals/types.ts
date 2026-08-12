/**
 * Core type definitions for the Vibes evaluation framework.
 *
 * This is a 1-1 TypeScript port of Pydantic AI's evals module types.
 */

import type { EvaluatorContext } from "./context.ts";

// ---------------------------------------------------------------------------
// EvalScore
// ---------------------------------------------------------------------------

/**
 * Result of a single evaluator. The score can be:
 * - `boolean` – a pass/fail assertion
 * - `number` – a 0-1 numeric score
 * - `string` – a categorical label
 */
export interface EvalScore {
  score: number | boolean | string;
  /** Optional human-readable label for this score. */
  label?: string;
  /** Optional explanation of why this score was assigned. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// EvaluationReason
// ---------------------------------------------------------------------------

/**
 * Like EvalScore but with a mandatory reason string.
 * Useful for LLM judge outputs.
 */
export interface EvaluationReason {
  score: number | boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

/**
 * A single test scenario in a dataset.
 */
export interface Case<TInput = unknown, TExpected = unknown> {
  /** Human-readable name for this test case. */
  name?: string;
  /** The input to feed into the task function. */
  inputs: TInput;
  /** The expected output (used by evaluators like `equalsExpected`). */
  expectedOutput?: TExpected;
  /** Arbitrary key-value metadata attached to this case. */
  metadata?: Record<string, unknown>;
  /** Evaluators that apply only to this case (in addition to dataset-level evaluators). */
  evaluators?: Evaluator<unknown, TExpected>[];
}

// ---------------------------------------------------------------------------
// CaseResult
// ---------------------------------------------------------------------------

/**
 * Result of running a single Case through a task and evaluators.
 */
export interface CaseResult<
  TInput = unknown,
  TExpected = unknown,
  TOutput = unknown,
> {
  /** The original Case that was evaluated. */
  case: Case<TInput, TExpected>;
  /** The output produced by the task function, or undefined if it threw. */
  output: TOutput | undefined;
  /** The error thrown by the task function, or undefined on success. */
  error: Error | undefined;
  /** Map of evaluator name → score for this case. */
  scores: Record<string, EvalScore>;
  /** Wall-clock duration of the task execution in milliseconds. */
  duration: number;
  /** Arbitrary attributes set by evaluators via `ctx.setEvalAttribute`. */
  attributes: Record<string, unknown>;
  /** Numeric metrics accumulated by evaluators via `ctx.incrementEvalMetric`. */
  metrics: Record<string, number>;
}

// ---------------------------------------------------------------------------
// ExperimentResult
// ---------------------------------------------------------------------------

/**
 * Full results for an experiment run over a Dataset.
 */
export interface ExperimentResult<
  TInput = unknown,
  TExpected = unknown,
  TOutput = unknown,
> {
  /** Results for each individual Case. */
  cases: CaseResult<TInput, TExpected, TOutput>[];
  /**
   * Per-evaluator summary statistics.
   * Numeric scores get mean/min/max. Boolean scores also get passRate.
   */
  summary: Record<
    string,
    { mean: number; min: number; max: number; passRate?: number }
  >;
  /** Total wall-clock duration of the experiment in milliseconds. */
  totalDuration: number;
  /** ISO 8601 timestamp when the experiment started. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Interface for case-level evaluators.
 * Receives an EvaluatorContext and returns a score.
 */
export interface Evaluator<TOutput = unknown, TExpected = unknown> {
  /** Unique name for this evaluator (used as key in scores map). */
  name: string;
  /**
   * Evaluate the task output for one Case.
   * May be synchronous or asynchronous.
   */
  evaluate(
    ctx: EvaluatorContext<unknown, TExpected, TOutput>,
  ): EvalScore | Promise<EvalScore>;
}

// ---------------------------------------------------------------------------
// ReportEvaluator
// ---------------------------------------------------------------------------

/**
 * Interface for experiment-wide (report-level) evaluators.
 * Receives all CaseResults after the experiment completes.
 */
export interface ReportEvaluator<
  TInput = unknown,
  TExpected = unknown,
  TOutput = unknown,
> {
  /** Unique name for this report-level evaluator. */
  name: string;
  /**
   * Evaluate the full set of case results.
   * May be synchronous or asynchronous.
   */
  evaluate(
    results: CaseResult<TInput, TExpected, TOutput>[],
  ): EvalScore | Promise<EvalScore>;
}

// ---------------------------------------------------------------------------
// EvalError
// ---------------------------------------------------------------------------

/**
 * Custom error class for evaluation framework errors.
 */
export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

// denoCacheMetadata={"headers":{"access-control-expose-headers":"*","content-encoding":"identity","cross-origin-resource-policy":"cross-origin","x-content-type-options":"nosniff","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=bc6Wq7UuwWSp6GELFE9QXLvwPu8zOI%2BsDJHu53nLP7Rb8vUohCmRg1xvg3D%2Bd5N%2F%2BP%2B3NzqN6NPEVx5lt0MqaGAo5%2FzBNrD3OpeX6czj0MuEKusIamAhMIU%3D\"}]}","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cf-ray":"a0a0fcb86fb131aa-LHR","content-type":"text/typescript","etag":"\"83a97a838f6a20394c3c19ac0194fe22\"","access-control-allow-origin":"*","alt-svc":"h3=\":443\"; ma=86400","server":"cloudflare","vary":"Origin","content-length":"5448","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cache-control":"public, max-age=31536000, immutable","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/evals/types.ts","time":1781184802}