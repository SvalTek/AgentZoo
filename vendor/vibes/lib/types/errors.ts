/** Thrown when an agent run exceeds the configured `maxTurns` limit. */
export class MaxTurnsError extends Error {
  constructor(turns: number) {
    super(`Agent exceeded maxTurns (${turns})`);
    this.name = "MaxTurnsError";
  }
}

/** Thrown when result validation fails after exhausting all configured retries. */
export class MaxRetriesError extends Error {
  constructor(retries: number, cause?: Error) {
    super(
      `Result validation failed after ${retries} retries: ${cause?.message}`,
    );
    this.name = "MaxRetriesError";
    this.cause = cause;
  }
}

/** Thrown when a token or request usage limit is exceeded during a run. */
export class UsageLimitError extends Error {
  constructor(
    public readonly limitKind:
      | "requests"
      | "inputTokens"
      | "outputTokens"
      | "totalTokens",
    public readonly current: number,
    public readonly limit: number,
  ) {
    super(
      `Usage limit exceeded: ${limitKind} reached ${current} (limit: ${limit})`,
    );
    this.name = "UsageLimitError";
  }
}

/** Thrown when a real model request is attempted while `setAllowModelRequests(false)` is active. */
export class ModelRequestsDisabledError extends Error {
  constructor() {
    super(
      "Model requests are disabled. Use setAllowModelRequests(true) or agent.override({ model }) in tests.",
    );
    this.name = "ModelRequestsDisabledError";
  }
}

/**
 * Thrown when one or more tool calls require human approval before execution.
 *
 * Callers should catch this error, inspect `deferred.requests`, supply
 * approval results, then call `agent.resume(deferred, results)` to continue.
 */
export class ApprovalRequiredError extends Error {
  readonly deferred: import("../execution/deferred.ts").DeferredToolRequests;

  constructor(
    deferred: import("../execution/deferred.ts").DeferredToolRequests,
  ) {
    super(
      `Approval required for ${deferred.requests.length} tool call(s): ${
        deferred.requests.map((r) => r.toolName).join(", ")
      }`,
    );
    this.name = "ApprovalRequiredError";
    this.deferred = deferred;
  }
}

// denoCacheMetadata={"headers":{"content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","content-encoding":"identity","x-jsr-backend":"modules","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","content-type":"text/typescript","x-robots-tag":"noindex","cf-ray":"a0a0fcb86f7231aa-LHR","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=B0f9FoyjHWDviLXmM%2F%2B7%2Fhi33bKnzkJL2vbpefMnAV8m3jzt5wzsXAZ8c%2BgyJ%2BRjez3%2FtkY3e99aY%2FEGDEfwyJ%2F7LXkdnIx2xRuMyDeiJfz2%2F4xWMjCklL0%3D\"}]}","etag":"\"f8dbc44b7a4f3899675aa23534c05020\"","alt-svc":"h3=\":443\"; ma=86400","content-length":"2104","cross-origin-resource-policy":"cross-origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","vary":"Origin","access-control-allow-origin":"*","date":"Thu, 11 Jun 2026 13:33:22 GMT","server":"cloudflare","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/types/errors.ts","time":1781184802}