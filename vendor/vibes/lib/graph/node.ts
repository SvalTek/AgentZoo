// ---------------------------------------------------------------------------
// Graph FSM - BaseNode
// ---------------------------------------------------------------------------

import type { NodeId, NodeResult } from "./types.ts";

/**
 * Abstract base class for graph nodes.
 *
 * Extend this class and implement `id` and `run()`.
 * Optionally declare `nextNodes` for static Mermaid diagram generation.
 *
 * @template TState  The shared state type threaded through the graph.
 * @template TOutput The final output type emitted when the graph ends.
 */
export abstract class BaseNode<TState, TOutput = never> {
  /** Unique identifier for this node within the graph. */
  abstract readonly id: NodeId;

  /**
   * Optional static list of node IDs this node may transition to.
   * Used for Mermaid diagram generation only - not enforced at runtime.
   *
   * Declare this in a subclass to include edges in Mermaid output:
   * ```ts
   * readonly nextNodes = ["node-b", "node-c"];
   * ```
   */
  // Note: not declared here - subclasses freely add this property without override

  /**
   * Execute this node's logic given the current state.
   * Return `next(nodeId, newState)` to transition, or `output(value)` to end.
   */
  abstract run(state: TState): Promise<NodeResult<TState, TOutput>>;
}

// denoCacheMetadata={"headers":{"x-jsr-backend":"modules","cache-control":"public, max-age=31536000, immutable","content-encoding":"identity","etag":"\"e77aa5360a90cf3591b1428c2c662fb6\"","vary":"Origin","x-content-type-options":"nosniff","cross-origin-resource-policy":"cross-origin","server":"cloudflare","content-type":"text/typescript","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=qZZ2WAhFAWihZUMtwiap2kAUYPY%2FI2r5tnKtHNW6hhmv%2FeWnvJo3CCD9zm%2FSdmcHry2Ey28I8sjY2qrJLHG0koksUGrY3BY5p7ziQEz6SA7wNJPrsGnKtKs%3D\"}]}","x-robots-tag":"noindex","access-control-expose-headers":"*","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-length":"1307","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-allow-origin":"*","date":"Thu, 11 Jun 2026 13:33:23 GMT","cf-ray":"a0a0fcb86fed31aa-LHR","alt-svc":"h3=\":443\"; ma=86400"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/graph/node.ts","time":1781184802}