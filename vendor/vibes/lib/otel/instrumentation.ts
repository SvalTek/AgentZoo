/**
 * Agent instrumentation helpers.
 *
 * The cleanest integration point for OpenTelemetry in the vibes framework is
 * the Vercel AI SDK's built-in `experimental_telemetry` option accepted by
 * `generateText` and `streamText`. When enabled the SDK creates spans for
 * every model call and tool invocation automatically, without requiring manual
 * span management in the framework itself.
 *
 * `instrumentAgent()` returns a thin wrapper around an agent that injects the
 * appropriate `TelemetrySettings` on every invocation via `agent.override()`.
 */
import type { TelemetrySettings } from "npm:ai@^6";
import type { Agent, RunOptions } from "../agent.ts";
import type { RunResult, StreamResult } from "../types/results.ts";
import type { AgentStreamEvent } from "../types/events.ts";
import type { InstrumentationOptions } from "./otel_types.ts";

// ---------------------------------------------------------------------------
// createTelemetrySettings
// ---------------------------------------------------------------------------

/**
 * Build a `TelemetrySettings` object from an agent name and instrumentation
 * options. The returned value is suitable for passing as `experimental_telemetry`
 * to `generateText` / `streamText`.
 */
export function createTelemetrySettings(
  agentName: string | undefined,
  options: InstrumentationOptions,
): TelemetrySettings {
  const settings: TelemetrySettings = {
    isEnabled: options.isEnabled ?? true,
  };

  // functionId: explicit option > agent name > fallback
  settings.functionId = options.functionId ?? agentName ?? "vibes-agent";

  if (options.metadata !== undefined) {
    settings.metadata = { ...options.metadata };
  }

  if (options.tracer !== undefined) {
    settings.tracer = options.tracer;
  }

  // excludeContent maps to AI SDK's recordInputs/recordOutputs flags
  if (options.excludeContent === true) {
    settings.recordInputs = false;
    settings.recordOutputs = false;
  }

  return settings;
}

// ---------------------------------------------------------------------------
// instrumentAgent
// ---------------------------------------------------------------------------

/**
 * Wrap an agent so that every `run()`, `stream()`, and `runStreamEvents()`
 * call automatically enables AI-SDK-level OpenTelemetry tracing.
 *
 * The wrapper uses `agent.override()` internally to inject `telemetry` settings
 * without mutating the original agent, so the original agent remains unchanged.
 *
 * @param agent - The agent to instrument.
 * @param options - Instrumentation options (tracer, metadata, excludeContent, etc.)
 * @returns An object with the same `run` / `stream` / `runStreamEvents` API as
 *   `agent.override()`, pre-configured with telemetry settings.
 *
 * @example
 * ```ts
 * const instrumented = instrumentAgent(myAgent, { functionId: "my-agent" });
 * const result = await instrumented.run("Hello");
 * ```
 */
export function instrumentAgent<TDeps, TOutput>(
  agent: Agent<TDeps, TOutput>,
  options: InstrumentationOptions = {},
): {
  run: (
    prompt: string,
    opts?: RunOptions<TDeps>,
  ) => Promise<RunResult<TOutput>>;
  stream: (prompt: string, opts?: RunOptions<TDeps>) => StreamResult<TOutput>;
  runStreamEvents: (
    prompt: string,
    opts?: RunOptions<TDeps>,
  ) => AsyncIterable<AgentStreamEvent<TOutput>>;
} {
  const telemetry = createTelemetrySettings(agent.name, options);

  return agent.override({ telemetry });
}

// denoCacheMetadata={"headers":{"nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","x-content-type-options":"nosniff","access-control-expose-headers":"*","alt-svc":"h3=\":443\"; ma=86400","cache-control":"public, max-age=31536000, immutable","etag":"\"9ffc4e74a5d0601599e2e9c5e5c7165b\"","content-encoding":"identity","date":"Thu, 11 Jun 2026 13:33:22 GMT","access-control-allow-origin":"*","cf-ray":"a0a0fcb86fa431aa-LHR","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","vary":"Origin","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=8rkGpMXt85tP5o3U8quRUcnFm%2FgEgxB%2FaC1wUKQ1liLOIUsAO08BpqWae8ndZb8LiBSqdn3VIkFLwEbxJXXTf3yBgkCA2bDU578R5DYjgPlb1qUEqauRul4%3D\"}]}","cross-origin-resource-policy":"cross-origin","content-type":"text/typescript","x-robots-tag":"noindex","server":"cloudflare","content-length":"3446"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/otel/instrumentation.ts","time":1781184802}