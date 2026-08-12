// ---------------------------------------------------------------------------
// Graph FSM - errors
// ---------------------------------------------------------------------------

import type { NodeId } from "./types.ts";

/** Thrown when the graph visits the same node too many times (likely a cycle). */
export class MaxGraphIterationsError extends Error {
  constructor(nodeId: NodeId, iterations: number) {
    super(
      `Graph exceeded max iterations (${iterations}) at node "${nodeId}". Possible infinite cycle.`,
    );
    this.name = "MaxGraphIterationsError";
  }
}

/** Thrown when a node ID referenced in a transition is not registered in the graph. */
export class UnknownNodeError extends Error {
  constructor(nodeId: NodeId) {
    super(`Graph has no node registered with id "${nodeId}".`);
    this.name = "UnknownNodeError";
  }
}

// denoCacheMetadata={"headers":{"content-encoding":"identity","cache-control":"public, max-age=31536000, immutable","etag":"\"835f1e90bb75ad0ec662b55fbefcf17f\"","x-jsr-backend":"modules","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-length":"853","server":"cloudflare","x-content-type-options":"nosniff","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=162o25iFRxDLXmilWfFRFAqc257R%2FIuBwzW9DUCHbD3UwMaeb37snmoCoxu%2FD4JTFJ7Pujyac%2FWhVdpRHUQeFZ65Z6NogNzHQk550rEZLtx7ry4G8vurtTw%3D\"}]}","cf-ray":"a0a0fcb86ff531aa-LHR","alt-svc":"h3=\":443\"; ma=86400","content-type":"text/typescript","x-robots-tag":"noindex","cross-origin-resource-policy":"cross-origin","vary":"Origin","access-control-expose-headers":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-allow-origin":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/graph/errors.ts","time":1781184802}