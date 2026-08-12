/**
 * Controls how structured output is delivered to the model.
 *
 * - `'tool'` (default): Inject a `final_result` tool the model must call.
 *   Supports union schemas (registers `final_result_0`, `final_result_1`, etc.).
 * - `'native'`: Use the AI SDK's native structured-output / JSON mode.
 *   The model's `object` response field is parsed against the schema.
 * - `'prompted'`: Inject the JSON schema into the system prompt as instructions.
 *   The model's text response is parsed as JSON against the schema.
 */
export type OutputMode = "tool" | "native" | "prompted";

// denoCacheMetadata={"headers":{"date":"Thu, 11 Jun 2026 13:33:22 GMT","cache-control":"public, max-age=31536000, immutable","content-encoding":"identity","content-type":"text/typescript","access-control-expose-headers":"*","vary":"Origin","server":"cloudflare","cf-ray":"a0a0fcb86f6b31aa-LHR","content-length":"580","x-jsr-backend":"modules","x-content-type-options":"nosniff","cross-origin-resource-policy":"cross-origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=wiEjuP333zDk8Wa%2B%2FOazMYROC2GQB0ejdMKahsJ5d65uJ4yI9xqSwhcXw5YVGGD9xUrs4PCh8GlpidZt1rjmMpQ0mYFzylFWgBqhlDgrYD5vdCBWF8QmcAQ%3D\"}]}","access-control-allow-origin":"*","x-robots-tag":"noindex","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","alt-svc":"h3=\":443\"; ma=86400","etag":"\"c211620c4c1f672980353acba6af54d2\""},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/output_mode.ts","time":1781184802}