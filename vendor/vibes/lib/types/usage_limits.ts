import type { Usage } from "./context.ts";
import { UsageLimitError } from "./errors.ts";

/** Caps on cumulative usage for a single run. */
export interface UsageLimits {
  /** Maximum number of model requests (turns). */
  maxRequests?: number;
  /** Maximum input tokens consumed. */
  maxInputTokens?: number;
  /** Maximum output tokens generated. */
  maxOutputTokens?: number;
  /** Maximum total tokens (input + output). */
  maxTotalTokens?: number;
}

/**
 * Throws `UsageLimitError` if any limit is exceeded by the current usage.
 * Called before each model request in the turn loop.
 */
export function checkUsageLimits(limits: UsageLimits, usage: Usage): void {
  if (
    limits.maxRequests !== undefined &&
    usage.requests >= limits.maxRequests
  ) {
    throw new UsageLimitError("requests", usage.requests, limits.maxRequests);
  }
  if (
    limits.maxInputTokens !== undefined &&
    usage.inputTokens >= limits.maxInputTokens
  ) {
    throw new UsageLimitError(
      "inputTokens",
      usage.inputTokens,
      limits.maxInputTokens,
    );
  }
  if (
    limits.maxOutputTokens !== undefined &&
    usage.outputTokens >= limits.maxOutputTokens
  ) {
    throw new UsageLimitError(
      "outputTokens",
      usage.outputTokens,
      limits.maxOutputTokens,
    );
  }
  if (
    limits.maxTotalTokens !== undefined &&
    usage.totalTokens >= limits.maxTotalTokens
  ) {
    throw new UsageLimitError(
      "totalTokens",
      usage.totalTokens,
      limits.maxTotalTokens,
    );
  }
}

// denoCacheMetadata={"headers":{"access-control-expose-headers":"*","server":"cloudflare","etag":"\"b8b705450cd4564a40f6e9a24883b787\"","content-length":"1520","access-control-allow-origin":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=CnSNndb8wuakX2oT59HXJxKcfcXxfeshPJ5hrPbRuCUzbmVH6pPCm7TBeAn%2B4oBH9eFYF8FIReiX8cdnv9LgEUXlrrKYOiFbZ6KPtQri%2FE254Z4KUl2%2Bao0%3D\"}]}","cf-ray":"a0a0fcb86f7731aa-LHR","x-content-type-options":"nosniff","alt-svc":"h3=\":443\"; ma=86400","x-jsr-backend":"modules","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cross-origin-resource-policy":"cross-origin","cache-control":"public, max-age=31536000, immutable","content-encoding":"identity","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex","content-type":"text/typescript","vary":"Origin"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/usage_limits.ts","time":1781184802}