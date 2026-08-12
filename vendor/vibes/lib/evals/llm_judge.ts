/**
 * LLM-as-judge evaluators for the Vibes evaluation framework.
 *
 * Uses an Agent with a structured Zod output schema to have an LLM evaluate
 * task outputs against a rubric.
 *
 * Note: Unlike the Python version, `setEvalAttribute`/`incrementEvalMetric`
 * are not standalone functions - use `ctx.setEvalAttribute()` instead.
 */

import type { LanguageModel } from "npm:ai@^6";
import { z } from "npm:zod@^4";
import { Agent } from "../agent.ts";
import type { EvalScore, Evaluator } from "./types.ts";
import type { EvaluatorContext } from "./context.ts";

// ---------------------------------------------------------------------------
// Default model
// ---------------------------------------------------------------------------

let _defaultJudgeModel: LanguageModel | undefined;

/**
 * Set the default LanguageModel used by `judgeOutput`, `judgeInputOutput`,
 * and other judge helpers when no explicit model is provided.
 */
export function setDefaultJudgeModel(model: LanguageModel): void {
  _defaultJudgeModel = model;
}

// ---------------------------------------------------------------------------
// Judge output schema
// ---------------------------------------------------------------------------

const JudgeOutputSchema = z.object({
  score: z.number().min(0).max(1).describe(
    "A score between 0 and 1 indicating how well the output satisfies the rubric. 1 = fully satisfies, 0 = does not satisfy at all.",
  ),
  reason: z.string().describe(
    "A brief explanation of the score and any issues found.",
  ),
});

type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ---------------------------------------------------------------------------
// LLMJudgeOptions
// ---------------------------------------------------------------------------

export interface LLMJudgeOptions {
  /**
   * The evaluation rubric. Describe what makes a good output.
   * The judge will score the output against this rubric.
   */
  rubric: string;
  /**
   * The LanguageModel to use for judging. Falls back to the default judge model
   * set via `setDefaultJudgeModel()`.
   */
  model?: LanguageModel;
  /**
   * Whether to include the task input in the judge's context.
   * Default: false.
   */
  includeInput?: boolean;
  /**
   * Whether to include the expected output in the judge's context.
   * Default: false.
   */
  includeExpectedOutput?: boolean;
  /**
   * If true, the evaluator returns the raw numeric score (0-1) instead of
   * converting to boolean. Default: false (boolean).
   */
  score?: boolean;
}

// ---------------------------------------------------------------------------
// llmJudge factory
// ---------------------------------------------------------------------------

/**
 * Creates an Evaluator that uses an LLM to judge the task output against a rubric.
 *
 * By default returns a boolean score (pass/fail based on whether score >= 0.5).
 * Set `score: true` to return the raw 0-1 numeric score.
 *
 * @example
 * ```ts
 * const ev = llmJudge({
 *   rubric: "Is the response helpful and accurate?",
 *   model: openai("gpt-4o"),
 * });
 * ```
 */
export function llmJudge(options: LLMJudgeOptions): Evaluator {
  return {
    name: "llmJudge",
    async evaluate(ctx: EvaluatorContext): Promise<EvalScore> {
      const result = await _runJudge({
        output: ctx.output,
        input: options.includeInput ? ctx.inputs : undefined,
        expected: options.includeExpectedOutput
          ? ctx.expectedOutput
          : undefined,
        rubric: options.rubric,
        model: options.model,
      });

      const numericScore = result.score;
      const finalScore = options.score ? numericScore : numericScore >= 0.5;

      return {
        score: finalScore,
        reason: result.reason,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Judge a single output against a rubric.
 *
 * Returns a boolean score (pass if LLM score >= 0.5).
 */
export async function judgeOutput(
  output: unknown,
  rubric: string,
  model?: LanguageModel,
): Promise<EvalScore> {
  const result = await _runJudge({ output, rubric, model });
  return {
    score: result.score >= 0.5,
    reason: result.reason,
  };
}

/**
 * Judge an output in context of the input against a rubric.
 */
export async function judgeInputOutput(
  input: unknown,
  output: unknown,
  rubric: string,
  model?: LanguageModel,
): Promise<EvalScore> {
  const result = await _runJudge({ output, input, rubric, model });
  return {
    score: result.score >= 0.5,
    reason: result.reason,
  };
}

/**
 * Judge an output compared to an expected output against a rubric.
 */
export async function judgeOutputExpected(
  output: unknown,
  expected: unknown,
  rubric: string,
  model?: LanguageModel,
): Promise<EvalScore> {
  const result = await _runJudge({ output, expected, rubric, model });
  return {
    score: result.score >= 0.5,
    reason: result.reason,
  };
}

/**
 * Judge an output in context of the input, compared to an expected output.
 */
export async function judgeInputOutputExpected(
  input: unknown,
  output: unknown,
  expected: unknown,
  rubric: string,
  model?: LanguageModel,
): Promise<EvalScore> {
  const result = await _runJudge({ output, input, expected, rubric, model });
  return {
    score: result.score >= 0.5,
    reason: result.reason,
  };
}

// ---------------------------------------------------------------------------
// Internal: _runJudge
// ---------------------------------------------------------------------------

interface JudgeRunOptions {
  output: unknown;
  input?: unknown;
  expected?: unknown;
  rubric: string;
  model?: LanguageModel;
}

async function _runJudge(options: JudgeRunOptions): Promise<JudgeOutput> {
  const model = options.model ?? _defaultJudgeModel;
  if (model === undefined) {
    throw new Error(
      "No LLM model provided for llmJudge. " +
        "Pass a model in LLMJudgeOptions or call setDefaultJudgeModel().",
    );
  }

  // Build the prompt
  const parts: string[] = [];

  parts.push("You are an impartial evaluator. Score the following output.");
  parts.push("");
  parts.push(`## Rubric\n${options.rubric}`);

  if (options.input !== undefined) {
    parts.push(`\n## Input\n${JSON.stringify(options.input, null, 2)}`);
  }

  parts.push(`\n## Output to Evaluate\n${JSON.stringify(options.output, null, 2)}`);

  if (options.expected !== undefined) {
    parts.push(
      `\n## Expected Output\n${JSON.stringify(options.expected, null, 2)}`,
    );
  }

  parts.push(
    "\nProvide a score from 0 to 1 (where 1 = fully satisfies the rubric) and a brief reason.",
  );

  const prompt = parts.join("\n");

  const agent = new Agent<undefined, JudgeOutput>({
    model,
    systemPrompt:
      "You are an expert evaluator. Score outputs against the provided rubric objectively.",
    outputSchema: JudgeOutputSchema,
  });

  const result = await agent.run(prompt);
  return result.output;
}

// denoCacheMetadata={"headers":{"content-type":"text/typescript","etag":"\"5f7abbe7e146d12d687d08854acf84a9\"","x-content-type-options":"nosniff","content-length":"7085","date":"Thu, 11 Jun 2026 13:33:22 GMT","access-control-allow-origin":"*","x-jsr-backend":"modules","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","vary":"Origin","cross-origin-resource-policy":"cross-origin","access-control-expose-headers":"*","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","cf-ray":"a0a0fcb86fbb31aa-LHR","alt-svc":"h3=\":443\"; ma=86400","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=%2FDr5O4N0wNmLha3vsW3nZNqvti8IZG2C%2B%2BELsM5KQalrEQTXj1cQgPvdKtoputJsAX5J6e9e2Nbz2ntOJOq4nhywA3Xfs1XDufvxndQ2MIWGmd9EGDiiryk%3D\"}]}","content-encoding":"identity","x-robots-tag":"noindex","cache-control":"public, max-age=31536000, immutable"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/evals/llm_judge.ts","time":1781184802}