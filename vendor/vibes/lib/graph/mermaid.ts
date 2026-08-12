// ---------------------------------------------------------------------------
// Graph FSM - Mermaid diagram generation
// ---------------------------------------------------------------------------

import type { NodeId } from "./types.ts";
import type { BaseNode } from "./node.ts";

/** Duck-typed extension of BaseNode that optionally declares static edges. */
interface NodeWithEdges {
  readonly id: string;
  readonly nextNodes?: NodeId[];
}

/**
 * Generate a Mermaid flowchart string from a list of graph nodes.
 *
 * If nodes declare `nextNodes?: NodeId[]`, edges are included.
 * Start/end nodes (those with id "start" or "end") use stadium shape `([id])`.
 * All other nodes use rectangle shape `[id]`.
 *
 * Example output:
 * ```
 * flowchart TD
 *   start([start])
 *   process[process]
 *   end_node([end_node])
 *   start --> process
 *   process --> end_node
 * ```
 */
const MERMAID_INIT = `%%{init: {
  "theme": "base",
  "themeVariables": {
    "primaryColor": "#dce8ff",
    "primaryBorderColor": "#1e1e1e",
    "primaryTextColor": "#0d0d0d",
    "secondaryColor": "#cdfae0",
    "secondaryBorderColor": "#1e1e1e",
    "tertiaryColor": "#e8d5ff",
    "tertiaryBorderColor": "#1e1e1e",
    "background": "#ffffff",
    "mainBkg": "#dce8ff",
    "nodeBorder": "#1e1e1e",
    "clusterBkg": "#f2f3f5",
    "titleColor": "#0d0d0d",
    "edgeLabelBackground": "#f0f0f0",
    "lineColor": "#1e1e1e",
    "fontFamily": "Geist, sans-serif"
  }
}}%%`;

export function toMermaid<TState, TOutput>(
  nodes: BaseNode<TState, TOutput>[],
): string {
  const lines: string[] = [MERMAID_INIT, "flowchart TD"];

  // Cast to access optional nextNodes property without TypeScript errors
  const nodesWithEdges = nodes as unknown as NodeWithEdges[];

  // Node declarations
  for (const node of nodesWithEdges) {
    const isTerminal = node.id === "start" || node.id === "end" ||
      node.id.endsWith("_end");
    const label = isTerminal ? `([${node.id}])` : `[${node.id}]`;
    lines.push(`  ${node.id}${label}`);
  }

  // Edge declarations (only if node declares nextNodes)
  for (const node of nodesWithEdges) {
    if (node.nextNodes && node.nextNodes.length > 0) {
      for (const targetId of node.nextNodes) {
        lines.push(`  ${node.id} --> ${targetId}`);
      }
    }
  }

  return lines.join("\n");
}

// denoCacheMetadata={"headers":{"nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","content-length":"2326","content-type":"text/typescript","access-control-expose-headers":"*","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-allow-origin":"*","cache-control":"public, max-age=31536000, immutable","etag":"\"d44a9bf44c355eb44f9cc800abc376ea\"","x-content-type-options":"nosniff","x-jsr-backend":"modules","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=Kj1Dc%2Fs%2FR3pL0RwUHNlImt1fFAO27pdk%2BlNz21aoQCKl17TgwQIkrPij%2FmPsGhvNzEgSGS26Io6gKbL8ImAPYH%2ByhhS56YEe9mW91ZnhJ7JAlrtmGI4W8N0%3D\"}]}","server":"cloudflare","alt-svc":"h3=\":443\"; ma=86400","cross-origin-resource-policy":"cross-origin","x-robots-tag":"noindex","date":"Thu, 11 Jun 2026 13:33:23 GMT","vary":"Origin","cf-ray":"a0a0fcb86ff831aa-LHR"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/graph/mermaid.ts","time":1781184802}