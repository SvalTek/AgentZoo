import type { ModelMessage } from "npm:ai@^6";

/**
 * Serialize a list of model messages to a JSON string.
 *
 * `ModelMessage` (aka `CoreMessage`) from the AI SDK is already fully
 * JSON-serializable - this function provides a typed, named wrapper so
 * callers don't have to cast manually.
 *
 * @example
 * ```ts
 * const json = serializeMessages(result.messages);
 * localStorage.setItem("history", json);
 * ```
 */
export function serializeMessages(messages: ModelMessage[]): string {
  return JSON.stringify(messages);
}

/**
 * Deserialize a JSON string produced by `serializeMessages` back into a typed
 * `ModelMessage[]` array. Throws a `SyntaxError` if the input is not valid JSON,
 * or a `TypeError` if the parsed value is not an array.
 *
 * @example
 * ```ts
 * const history = deserializeMessages(localStorage.getItem("history") ?? "[]");
 * await agent.run("continue", { messageHistory: history });
 * ```
 */
export function deserializeMessages(json: string): ModelMessage[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new TypeError(
      `deserializeMessages: expected a JSON array, got ${typeof parsed}`,
    );
  }
  return parsed as ModelMessage[];
}

// denoCacheMetadata={"headers":{"date":"Thu, 11 Jun 2026 13:33:23 GMT","cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff","content-length":"1221","etag":"\"860aee412fe847ecddcbe4c413edf9dd\"","cf-ray":"a0a0fcb86f7831aa-LHR","alt-svc":"h3=\":443\"; ma=86400","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-allow-origin":"*","content-encoding":"identity","vary":"Origin","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=kxtk%2Fpw1aCxskuqnz%2FaXlBANJLWxpreWKnYCFyGpqMJG5IarpOcZZZ8Ai1KWwR4CnUJwMF1TSmqhwHKbCFfz8ymL%2F7bUnRx%2BqfHIl5JmB6T78TOPihDGg8E%3D\"}]}","x-jsr-backend":"modules","content-type":"text/typescript","server":"cloudflare","cross-origin-resource-policy":"cross-origin","access-control-expose-headers":"*","x-robots-tag":"noindex"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/history/serialization.ts","time":1781184802}