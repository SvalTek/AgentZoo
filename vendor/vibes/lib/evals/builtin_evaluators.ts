/**
 * Built-in case-level evaluators for the Vibes evaluation framework.
 *
 * Each evaluator implements the `Evaluator` interface and can be passed to
 * Dataset.fromArray(), Dataset.evaluate(), or individual Case.evaluators arrays.
 */

import type { ZodType } from "npm:zod@^4";
import type { EvalScore, Evaluator } from "./types.ts";
import type { EvaluatorContext } from "./context.ts";
import type { SpanNode } from "./span_tree.ts";

// ---------------------------------------------------------------------------
// equalsExpected
// ---------------------------------------------------------------------------

/**
 * Passes when `output === expectedOutput` (strict equality).
 *
 * Fails gracefully when `expectedOutput` is undefined.
 */
export function equalsExpected(): Evaluator {
  return {
    name: "equalsExpected",
    evaluate(ctx: EvaluatorContext): EvalScore {
      const pass =
        ctx.expectedOutput !== undefined && ctx.output === ctx.expectedOutput;
      return {
        score: pass,
        reason: pass
          ? "output matches expectedOutput"
          : `output ${JSON.stringify(ctx.output)} !== expectedOutput ${
              JSON.stringify(ctx.expectedOutput)
            }`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// equals
// ---------------------------------------------------------------------------

/**
 * Passes when `output === value` (strict equality).
 *
 * @param value The value to compare against.
 * @param evaluationName Optional override for the evaluator name.
 */
export function equals(value: unknown, evaluationName?: string): Evaluator {
  return {
    name: evaluationName ?? "equals",
    evaluate(ctx: EvaluatorContext): EvalScore {
      const pass = ctx.output === value;
      return {
        score: pass,
        reason: pass
          ? `output equals ${JSON.stringify(value)}`
          : `output ${JSON.stringify(ctx.output)} !== ${JSON.stringify(value)}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// contains
// ---------------------------------------------------------------------------

/**
 * Passes when the string output contains the given substring.
 *
 * @param value Substring to look for.
 * @param options.caseSensitive Whether to use case-sensitive comparison (default: true).
 * @param options.asStrings Convert output to string before checking (default: false).
 * @param options.evaluationName Override the evaluator name.
 */
export function contains(
  value: string,
  options?: {
    caseSensitive?: boolean;
    asStrings?: boolean;
    evaluationName?: string;
  },
): Evaluator {
  const caseSensitive = options?.caseSensitive ?? true;
  const asStrings = options?.asStrings ?? false;
  const name = options?.evaluationName ?? "contains";

  return {
    name,
    evaluate(ctx: EvaluatorContext): EvalScore {
      let haystack: string;
      if (asStrings) {
        haystack = String(ctx.output);
      } else if (typeof ctx.output === "string") {
        haystack = ctx.output;
      } else {
        return {
          score: false,
          reason: `output is not a string (got ${typeof ctx.output})`,
        };
      }

      const needle = value;
      const pass = caseSensitive
        ? haystack.includes(needle)
        : haystack.toLowerCase().includes(needle.toLowerCase());

      return {
        score: pass,
        reason: pass
          ? `output contains "${value}"`
          : `output does not contain "${value}"`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// isInstance
// ---------------------------------------------------------------------------

/**
 * Passes when `typeof output === typeName`.
 *
 * Supports all JavaScript primitive type names: "string", "number", "boolean",
 * "object", "function", "undefined", "bigint", "symbol".
 *
 * @param typeName The expected typeof result.
 * @param evaluationName Override the evaluator name.
 */
export function isInstance(
  typeName: string,
  evaluationName?: string,
): Evaluator {
  return {
    name: evaluationName ?? "isInstance",
    evaluate(ctx: EvaluatorContext): EvalScore {
      const actual = typeof ctx.output;
      const pass = actual === typeName;
      return {
        score: pass,
        reason: pass
          ? `output is of type "${typeName}"`
          : `expected typeof output to be "${typeName}" but got "${actual}"`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// maxDuration
// ---------------------------------------------------------------------------

/**
 * Passes when the task execution duration is at or below the given limit.
 *
 * @param seconds Maximum allowed duration in seconds.
 */
export function maxDuration(seconds: number): Evaluator {
  const limitMs = seconds * 1000;
  return {
    name: "maxDuration",
    evaluate(ctx: EvaluatorContext): EvalScore {
      const pass = ctx.durationMs <= limitMs;
      return {
        score: pass,
        reason: pass
          ? `duration ${ctx.durationMs}ms is within ${limitMs}ms limit`
          : `duration ${ctx.durationMs}ms exceeds ${limitMs}ms limit`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// hasMatchingSpan
// ---------------------------------------------------------------------------

/**
 * Passes when the span tree contains at least one node matching the predicate.
 *
 * Fails gracefully when `ctx.spanTree` is undefined.
 *
 * @param predicate Function to test each SpanNode.
 * @param evaluationName Override the evaluator name.
 */
export function hasMatchingSpan(
  predicate: (node: SpanNode) => boolean,
  evaluationName?: string,
): Evaluator {
  return {
    name: evaluationName ?? "hasMatchingSpan",
    evaluate(ctx: EvaluatorContext): EvalScore {
      if (ctx.spanTree === undefined) {
        return {
          score: false,
          reason: "no span tree available",
        };
      }
      const pass = ctx.spanTree.any(predicate);
      return {
        score: pass,
        reason: pass
          ? "found a matching span in the span tree"
          : "no matching span found in the span tree",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// isValidSchema
// ---------------------------------------------------------------------------

/**
 * Passes when the output successfully validates against the given Zod schema.
 *
 * @param schema A Zod schema to validate the output against.
 * @param evaluationName Override the evaluator name.
 */
export function isValidSchema(
  schema: ZodType,
  evaluationName?: string,
): Evaluator {
  return {
    name: evaluationName ?? "isValidSchema",
    evaluate(ctx: EvaluatorContext): EvalScore {
      const result = schema.safeParse(ctx.output);
      if (result.success) {
        return { score: true, reason: "output matches schema" };
      }
      return {
        score: false,
        reason: result.error.message,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// custom
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper that creates a named evaluator from a plain function.
 *
 * @param name Evaluator name (used as key in scores map).
 * @param fn The evaluation function.
 */
export function custom<TOutput = unknown, TExpected = unknown>(
  name: string,
  fn: (
    ctx: EvaluatorContext<unknown, TExpected, TOutput>,
  ) => EvalScore | Promise<EvalScore>,
): Evaluator<TOutput, TExpected> {
  return { name, evaluate: fn };
}

// denoCacheMetadata={"headers":{"etag":"\"2eb1f91f57dd283e24e69211318af148\"","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=qL0ErfeFM7blYroLfx3LOvq8z6kA90lgFuYRGSL6rszV2c%2FRjmINQD4YQo9pK0XzJUoVKSpQQ6ngAnONEvtahxgbXVA9NcqJzlBeRic8QbM6OrUWnC8K%2Bpw%3D\"}]}","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","x-robots-tag":"noindex","alt-svc":"h3=\":443\"; ma=86400","content-type":"text/typescript","x-jsr-backend":"modules","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cross-origin-resource-policy":"cross-origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","cf-ray":"a0a0fcb86fb831aa-LHR","access-control-allow-origin":"*","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-length":"7770","x-content-type-options":"nosniff","vary":"Origin"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/evals/builtin_evaluators.ts","time":1781184802}