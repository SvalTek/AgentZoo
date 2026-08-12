/**
 * Experiment runner - thin wrapper around Dataset.evaluate().
 *
 * Prefer using `dataset.evaluate()` directly. This function exists for
 * compatibility with the Pydantic AI API surface.
 */

import type {
  CaseResult,
  Evaluator,
  ExperimentResult,
  ReportEvaluator,
} from "./types.ts";
import { Dataset } from "./dataset.ts";

// ---------------------------------------------------------------------------
// RunExperimentOptions
// ---------------------------------------------------------------------------

export interface RunExperimentOptions<TInput, TExpected, TOutput> {
  /** The dataset of cases to evaluate. */
  dataset: Dataset<TInput, TExpected>;
  /** The task function to evaluate. */
  task: (input: TInput) => TOutput | Promise<TOutput>;
  /**
   * Additional evaluators to run alongside the dataset's own evaluators.
   * These are merged with the dataset's evaluators.
   */
  evaluators?: Evaluator<TOutput, TExpected>[];
  /** Report-level evaluators run after all cases. */
  reportEvaluators?: ReportEvaluator<TInput, TExpected, TOutput>[];
  /** Maximum number of concurrent case evaluations. Default: 5. */
  maxConcurrency?: number;
  /** Maximum retry attempts per case. Default: 1. */
  maxRetries?: number;
  /** Callback invoked when each case completes. */
  onCaseComplete?: (result: CaseResult) => void;
}

// ---------------------------------------------------------------------------
// runExperiment
// ---------------------------------------------------------------------------

/**
 * Run an experiment over a dataset.
 *
 * This is a thin convenience wrapper around `Dataset.evaluate()`.
 * Additional evaluators and report evaluators passed here are merged
 * with those already on the dataset.
 *
 * @example
 * ```ts
 * const result = await runExperiment({
 *   dataset: myDataset,
 *   task: async (input) => model.generate(input),
 *   evaluators: [equalsExpected()],
 *   maxConcurrency: 3,
 * });
 * console.log(formatReport(result));
 * ```
 */
export function runExperiment<TInput, TExpected, TOutput>(
  options: RunExperimentOptions<TInput, TExpected, TOutput>,
): Promise<ExperimentResult<TInput, TExpected, TOutput>> {
  // Merge evaluators from options into the dataset
  const merged = options.evaluators?.length || options.reportEvaluators?.length
    ? Dataset.fromArray<TInput, TExpected>(
        [...options.dataset.cases] as import("./types.ts").Case<TInput, TExpected>[],
        {
          name: options.dataset.name,
          evaluators: [
            ...(options.dataset.evaluators as Evaluator<unknown, TExpected>[]),
            ...(options.evaluators ?? []) as Evaluator<unknown, TExpected>[],
          ],
          reportEvaluators: [
            ...options.dataset.reportEvaluators,
            ...(options.reportEvaluators ?? []),
          ],
        },
      )
    : options.dataset;

  return merged.evaluate<TOutput>(options.task, {
    maxConcurrency: options.maxConcurrency,
    maxRetries: options.maxRetries,
    onCaseComplete: options.onCaseComplete,
  });
}

// denoCacheMetadata={"headers":{"cf-ray":"a0a0fcb86fbf31aa-LHR","etag":"\"a39231337af00b2a4874297a8a7146a2\"","date":"Thu, 11 Jun 2026 13:33:23 GMT","cross-origin-resource-policy":"cross-origin","x-content-type-options":"nosniff","x-robots-tag":"noindex","cache-control":"public, max-age=31536000, immutable","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=oeTAVrn3BEw0ZTzL9NeAzEHa52y8%2FPtJZvd26AK3f2Q4rN7MQioJZ1hbAyTPnGCVjF8%2FZF87YaQ13BUL2%2FEu3CmVJjhgsOostcBDrwPJQvBgIO9aJBulXIo%3D\"}]}","content-length":"3055","x-jsr-backend":"modules","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","alt-svc":"h3=\":443\"; ma=86400","content-type":"text/typescript","access-control-allow-origin":"*","vary":"Origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-expose-headers":"*","server":"cloudflare","content-encoding":"identity"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/evals/experiment.ts","time":1781184802}