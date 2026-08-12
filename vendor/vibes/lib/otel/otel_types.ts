/**
 * Shared OpenTelemetry types for the vibes agent framework.
 *
 * The framework delegates span creation to the Vercel AI SDK's built-in
 * `experimental_telemetry` support on `generateText` / `streamText`. We
 * re-export the AI SDK's own `TelemetrySettings` type to ensure perfect
 * type compatibility when the settings are threaded through to the SDK calls.
 */
import type { Tracer } from "npm:@opentelemetry/api@^1";

// ---------------------------------------------------------------------------
// TelemetrySettings - re-exported from AI SDK for public API surface
// ---------------------------------------------------------------------------

/**
 * Telemetry configuration passed to each `generateText` / `streamText` call
 * as `experimental_telemetry`. When enabled, the AI SDK creates spans for the
 * model call and every tool invocation automatically.
 *
 * This is a re-export of the AI SDK's `TelemetrySettings` type to ensure
 * type compatibility with the underlying `generateText` / `streamText` options.
 */
export type { TelemetrySettings } from "npm:ai@^6";

// ---------------------------------------------------------------------------
// InstrumentationOptions - passed to instrumentAgent()
// ---------------------------------------------------------------------------

/**
 * Options for the `instrumentAgent()` helper.
 *
 * The helper wraps an existing agent so that every `run()` / `stream()` call
 * automatically enables AI-SDK-level telemetry without requiring callers to
 * pass `telemetry` on every invocation.
 */
export interface InstrumentationOptions {
  /**
   * A stable identifier for the agent being traced. Defaults to the agent's
   * `name` property when available, or `"vibes-agent"`.
   */
  functionId?: string;
  /**
   * Arbitrary metadata added to every span as key-value attributes.
   * Must be primitive values compatible with OpenTelemetry's `AttributeValue`.
   */
  metadata?: Record<string, string | number | boolean>;
  /**
   * When `true`, prompt content and model responses are NOT recorded in span
   * attributes. Useful for compliance / privacy requirements.
   *
   * Maps to the AI SDK's `recordInputs: false` / `recordOutputs: false`
   * telemetry settings.
   */
  excludeContent?: boolean;
  /**
   * Whether telemetry is enabled. Defaults to `true` when passed to
   * `instrumentAgent()`.
   */
  isEnabled?: boolean;
  /**
   * An explicit `Tracer` instance. When omitted the AI SDK resolves one from
   * the global OpenTelemetry `TracerProvider`.
   */
  tracer?: Tracer;
}

// denoCacheMetadata={"headers":{"x-content-type-options":"nosniff","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=ESJ6SnrsPGStwEgAflykhj1Qai2sjOBX0MFYfMSDU%2F9ZM%2Bpd06eJM7sTTeAD%2FLG%2BJl8xpyPp1ulfM%2Ffhn475I%2FxH7JZTEAbCGWo4QOT6KWCn2byXDP1ddEc%3D\"}]}","content-length":"2557","vary":"Origin","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-encoding":"identity","etag":"\"cb9615b9360a5fd9cea4d78f8457ccb1\"","content-type":"text/typescript","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-robots-tag":"noindex","cache-control":"public, max-age=31536000, immutable","cross-origin-resource-policy":"cross-origin","access-control-allow-origin":"*","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","access-control-expose-headers":"*","cf-ray":"a0a0fcb86fa231aa-LHR","alt-svc":"h3=\":443\"; ma=86400"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/otel/otel_types.ts","time":1781184802}