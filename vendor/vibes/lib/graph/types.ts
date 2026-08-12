// ---------------------------------------------------------------------------
// Graph FSM - core types
// ---------------------------------------------------------------------------

export type NodeId = string;

/**
 * The result of running a node:
 * - `{ kind: 'next', nodeId, state }` - transition to another node with new state
 * - `{ kind: 'output', output }` - graph is done, emit final output
 */
export type NodeResult<TState, TOutput> =
  | { readonly kind: "next"; readonly nodeId: NodeId; readonly state: TState }
  | { readonly kind: "output"; readonly output: TOutput };

/** Construct a "transition to next node" result. */
export function next<TState, TOutput>(
  nodeId: NodeId,
  state: TState,
): NodeResult<TState, TOutput> {
  return { kind: "next", nodeId, state };
}

/** Construct a "graph is done" result. */
export function output<TState, TOutput>(
  value: TOutput,
): NodeResult<TState, TOutput> {
  return { kind: "output", output: value };
}

// denoCacheMetadata={"headers":{"content-type":"text/typescript","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-expose-headers":"*","access-control-allow-origin":"*","cache-control":"public, max-age=31536000, immutable","content-length":"975","vary":"Origin","x-jsr-backend":"modules","server":"cloudflare","etag":"\"4dc35b8261240288bc1958c3b97ec66b\"","cf-ray":"a0a0fcb86fea31aa-LHR","alt-svc":"h3=\":443\"; ma=86400","cross-origin-resource-policy":"cross-origin","content-encoding":"identity","x-content-type-options":"nosniff","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=AfutGMD8RbFnN8%2FkMhAPdeHOImfxGSHNpZDHoj83zD5IGq78wHcW6SlvVy3IJxSb58tebAz1nqucnYEW%2F6LCKKqct0LlUg%2BCDfaCM%2F0WFN71D2ACRSUQ7nw%3D\"}]}","x-robots-tag":"noindex"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/graph/types.ts","time":1781184802}