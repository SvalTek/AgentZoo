import type { ModelMessage } from "npm:ai@^6";
import { ModelRequestsDisabledError } from "../types/errors.ts";

export { createTestModel, TestModel } from "./test_model.ts";
export type {
  DoGenerateResult as TestDoGenerateResult,
  TestModelOptions,
} from "./test_model.ts";
export { FunctionModel } from "./function_model.ts";
export type {
  DoGenerateResult,
  ModelFunction,
  ModelFunctionParams,
} from "./function_model.ts";

// ---------------------------------------------------------------------------
// ALLOW_MODEL_REQUESTS guard
// ---------------------------------------------------------------------------

let _allowModelRequests = true;

/**
 * Allow or disallow real model API calls globally. Default: `true`.
 *
 * Set to `false` in test suites to ensure accidental non-mocked agent runs
 * throw `ModelRequestsDisabledError` immediately. Use `agent.override()` to
 * provide a mock model for the runs you do want to execute.
 *
 * @example
 * ```ts
 * import { setAllowModelRequests } from "./testing/mod.ts";
 *
 * // At the top of your test file:
 * setAllowModelRequests(false);
 * ```
 */
export function setAllowModelRequests(allow: boolean): void {
  _allowModelRequests = allow;
}

/** Returns the current model-requests flag. */
export function getAllowModelRequests(): boolean {
  return _allowModelRequests;
}

/**
 * Throws `ModelRequestsDisabledError` if model requests are disabled and the
 * call is not explicitly bypassed (e.g. via `agent.override()`).
 *
 * @internal Called at the start of every `executeRun` / `executeStream`.
 */
export function assertModelRequestsAllowed(bypass = false): void {
  if (!_allowModelRequests && !bypass) {
    throw new ModelRequestsDisabledError();
  }
}

// ---------------------------------------------------------------------------
// captureRunMessages
// ---------------------------------------------------------------------------

let _captureStore: ModelMessage[][] | null = null;

/**
 * Runs `fn` and captures every message array sent to the model during the call.
 * Returns both the function's result and the captured message snapshots
 * (one entry per model call / turn).
 *
 * @example
 * ```ts
 * const { result, messages } = await captureRunMessages(() =>
 *   agent.run("hello")
 * );
 * // messages[0] = messages sent on turn 1, messages[1] = turn 2, …
 * ```
 */
export async function captureRunMessages<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; messages: ModelMessage[][] }> {
  const store: ModelMessage[][] = [];
  _captureStore = store;
  try {
    const result = await fn();
    return { result, messages: store };
  } finally {
    _captureStore = null;
  }
}

/**
 * Called by execution internals before each model call to record the messages.
 * @internal
 */
export function _notifyModelRequest(messages: ModelMessage[]): void {
  if (_captureStore !== null) {
    _captureStore.push([...messages]);
  }
}

// denoCacheMetadata={"headers":{"content-length":"2923","server":"cloudflare","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex","cache-control":"public, max-age=31536000, immutable","x-jsr-backend":"modules","alt-svc":"h3=\":443\"; ma=86400","etag":"\"54823940942543ba9c71dc9fe9939e7e\"","vary":"Origin","access-control-expose-headers":"*","cross-origin-resource-policy":"cross-origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-allow-origin":"*","content-encoding":"identity","x-content-type-options":"nosniff","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Bv3LFZRH2RSzI8TXwj317gh35GCpFbrsOhVk7h9cJkP5boi2OPlwfvVvDii8oE8v%2B%2B7%2FPyS2MN13D0jMbf2eX9Mz51OcoPgBHOBeHOIH0ePvc9vw2OesyMM%3D\"}]}","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-type":"text/typescript","cf-ray":"a0a0fcb86f7931aa-LHR"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/testing/mod.ts","time":1781184802}