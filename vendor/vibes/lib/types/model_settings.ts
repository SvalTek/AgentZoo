/**
 * Model-specific settings passed through to the AI SDK's generateText/streamText.
 * These map directly to top-level options of those functions.
 */
export interface ModelSettings {
  /** Allow deliberate system-role entries in message history. */
  allowSystemInMessages?: boolean;
  /** Sampling temperature (0–2). Lower = more deterministic. */
  temperature?: number;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
  /** Nucleus sampling: only sample from the top-P probability mass. */
  topP?: number;
  /** Only sample from the top-K tokens. */
  topK?: number;
  /** Penalises tokens that have already appeared (frequency). */
  frequencyPenalty?: number;
  /** Penalises tokens regardless of frequency (presence). */
  presencePenalty?: number;
  /** Stop generation when any of these sequences appear. */
  stopSequences?: string[];
  /** Seed for deterministic generation (model-dependent). */
  seed?: number;
}

// denoCacheMetadata={"headers":{"date":"Thu, 11 Jun 2026 13:33:23 GMT","cf-ray":"a0a0fcb86f6d31aa-LHR","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=ITwbDxMicJUPR%2Fb6dalYJ1r6xhU8nxacKirdA5iUMtX7l2zo%2FU9I56hTht4vkynF11f2FnTPq6rRu5%2BgXkCZzg0hmT9sXUtDH19BcIpyoUqVu47NovL%2BWJ8%3D\"}]}","vary":"Origin","cross-origin-resource-policy":"cross-origin","server":"cloudflare","content-encoding":"identity","content-length":"852","x-robots-tag":"noindex","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cache-control":"public, max-age=31536000, immutable","content-type":"text/typescript","access-control-allow-origin":"*","etag":"\"e5f8dd5b769b44534750442c3e435b0b\"","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-expose-headers":"*","x-content-type-options":"nosniff","alt-svc":"h3=\":443\"; ma=86400"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/model_settings.ts","time":1781184802}
