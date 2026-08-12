import { jsonSchema as aiJsonSchema } from "npm:ai@^6";
import type { ZodType } from "npm:zod@^4";
import type { RunContext } from "../types/context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { Toolset } from "./toolset.ts";

/**
 * A raw tool definition using a JSON Schema instead of a Zod schema.
 * Used with `ExternalToolset` to expose tools whose execution happens
 * outside the agent (e.g. in the client, browser, or another service).
 */
export type ExternalToolDefinition = {
  /** The tool name exposed to the model. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /**
   * JSON Schema object describing the tool's input parameters.
   * Must be a valid JSON Schema (type: "object" at the top level is recommended).
   */
  jsonSchema: Record<string, unknown>;
};

/**
 * A toolset of externally-executed tools. The model can call these tools,
 * but their execution happens outside the agent - the run pauses and throws
 * an `ApprovalRequiredError` with the pending `DeferredToolRequests`.
 *
 * The caller executes the tools externally, then calls `agent.resume()` with
 * the results wrapped in a `DeferredToolResults` object.
 *
 * This is the primary pattern for tools that must run in a specific environment
 * (e.g. the browser, a sandboxed process, or a remote service) rather than
 * in the agent's server-side process.
 *
 * @example
 * ```ts
 * const externalTools = new ExternalToolset([
 *   {
 *     name: "read_file",
 *     description: "Read a file from the user's local filesystem",
 *     jsonSchema: {
 *       type: "object",
 *       properties: { path: { type: "string" } },
 *       required: ["path"],
 *     },
 *   },
 * ]);
 *
 * const agent = new Agent({ model, toolsets: [externalTools] });
 *
 * try {
 *   await agent.run("Read /etc/hosts");
 * } catch (err) {
 *   if (err instanceof ApprovalRequiredError) {
 *     // Execute tools externally and collect results
 *     const results = await executeExternally(err.deferred.requests);
 *     const finalResult = await agent.resume(err.deferred, { results });
 *   }
 * }
 * ```
 */
export class ExternalToolset<TDeps = undefined> implements Toolset<TDeps> {
  private readonly _definitions: ExternalToolDefinition[];

  constructor(definitions: ExternalToolDefinition[]) {
    this._definitions = [...definitions];
  }

  tools(_ctx: RunContext<TDeps>): ToolDefinition<TDeps>[] {
    return this._definitions.map((def) => {
      // Wrap the raw JSON schema with the AI SDK helper
      const wrappedSchema = aiJsonSchema(
        def.jsonSchema,
      ) as unknown as ZodType;
      const toolDef: ToolDefinition<TDeps> = {
        name: def.name,
        description: def.description,
        parameters: wrappedSchema,
        requiresApproval: true as const,
        // execute should never be called - the tool is marked requiresApproval:true
        // and the run loop intercepts before execution. Provide a fallback that
        // returns an error string in case the deferred mechanism is bypassed.
        execute: (_ctx: RunContext<TDeps>, args: unknown) => {
          return Promise.resolve(
            `External tool "${def.name}" was called but no executor is registered. Args: ${
              JSON.stringify(args)
            }`,
          );
        },
      };
      return toolDef;
    });
  }
}

// denoCacheMetadata={"headers":{"cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff","content-encoding":"identity","x-robots-tag":"noindex","x-jsr-backend":"modules","access-control-expose-headers":"*","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=g5tGnYRabJjZgrKMm5fC1RmFVoYq3OK3hlaqjnP9G%2BrgyknHCPvHEbjZ6jLO8FoWYM%2Buw%2FSILmV4W2Bt7z7mG14oNcMm1Pv1LQyWkuGu8e3qEnHcKrLxuL4%3D\"}]}","alt-svc":"h3=\":443\"; ma=86400","content-length":"3391","etag":"\"04d2dc037be68ce8b1c3a210b54b64a2\"","cf-ray":"a0a0fcb86f8e31aa-LHR","cross-origin-resource-policy":"cross-origin","access-control-allow-origin":"*","content-type":"text/typescript","server":"cloudflare","date":"Thu, 11 Jun 2026 13:33:23 GMT","vary":"Origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/toolsets/external_toolset.ts","time":1781184802}