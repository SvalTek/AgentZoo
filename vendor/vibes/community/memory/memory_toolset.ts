import { z } from "npm:zod@^4";
import { tool } from "../../lib/tool.ts";
import type { ToolDefinition } from "../../lib/tool.ts";
import type { Toolset } from "../../lib/toolsets/toolset.ts";
import type { RunContext } from "../../lib/types/context.ts";
import type { MemoryStore } from "./types.ts";
import { InMemoryStore } from "./in_memory_store.ts";

const SaveParams = z.object({
  key: z.string().describe("Unique name / identifier for this memory"),
  content: z.string().describe("The fact or value to store"),
  tags: z.array(z.string()).optional().describe("Optional labels for grouping (e.g. [\"user\", \"preference\"])"),
});

const RecallParams = z.object({
  key: z.string().describe("Exact key of the memory to retrieve"),
});

const SearchParams = z.object({
  query: z.string().describe("Keyword to search across memory keys, content, and tags"),
});

const DeleteParams = z.object({
  key: z.string().describe("Key of the memory to remove"),
});

const ListParams = z.object({});

/**
 * A toolset that gives an agent a persistent key-value memory scratchpad.
 *
 * Exposes five tools: `memory_save`, `memory_recall`, `memory_search`, `memory_delete`, `memory_list`.
 *
 * @example
 * ```ts
 * import { Agent } from "@vibesjs/sdk";
 * import { MemoryToolset } from "@vibesjs/sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * const agent = new Agent({
 *   model: anthropic("claude-sonnet-4-6"),
 *   toolsets: [new MemoryToolset()],
 * });
 * ```
 *
 * Pass a custom `MemoryStore` for persistent storage:
 * ```ts
 * const agent = new Agent({
 *   model: anthropic("claude-sonnet-4-6"),
 *   toolsets: [new MemoryToolset(myPersistentStore)],
 * });
 * ```
 */
export class MemoryToolset<TDeps = undefined> implements Toolset<TDeps> {
  private readonly store: MemoryStore;

  constructor(store?: MemoryStore) {
    this.store = store ?? new InMemoryStore();
  }

  tools(_ctx: RunContext<TDeps>): ToolDefinition<TDeps>[] {
    const store = this.store;

    return [
      tool<TDeps, typeof SaveParams>({
        name: "memory_save",
        description: "Store a named memory. Upserts by key — calling again with the same key overwrites the previous value.",
        parameters: SaveParams,
        execute: async (_ctx, args) => {
          const memory = await store.save(args.key, args.content, args.tags ?? []);
          return JSON.stringify(memory);
        },
      }),

      tool<TDeps, typeof RecallParams>({
        name: "memory_recall",
        description: "Retrieve a single memory by exact key. Returns null if not found.",
        parameters: RecallParams,
        execute: async (_ctx, args) => {
          const memory = await store.recall(args.key);
          return JSON.stringify(memory);
        },
      }),

      tool<TDeps, typeof SearchParams>({
        name: "memory_search",
        description: "Search across all memories by keyword. Matches against key, content, and tags (case-insensitive substring).",
        parameters: SearchParams,
        execute: async (_ctx, args) => {
          const results = await store.search(args.query);
          return JSON.stringify(results);
        },
      }),

      tool<TDeps, typeof DeleteParams>({
        name: "memory_delete",
        description: "Remove a memory by key. Returns true if it existed and was removed, false if not found.",
        parameters: DeleteParams,
        execute: async (_ctx, args) => {
          const removed = await store.delete(args.key);
          return JSON.stringify({ removed });
        },
      }),

      tool<TDeps, typeof ListParams>({
        name: "memory_list",
        description: "List all memory keys and their tags. Does not return full content to keep token use low.",
        parameters: ListParams,
        execute: async () => {
          const entries = await store.list();
          return JSON.stringify(entries);
        },
      }),
    ];
  }
}

// denoCacheMetadata={"headers":{"x-robots-tag":"noindex","content-encoding":"identity","access-control-allow-origin":"*","access-control-expose-headers":"*","x-jsr-backend":"modules","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-type":"text/typescript","content-length":"3920","cross-origin-resource-policy":"cross-origin","server":"cloudflare","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","alt-svc":"h3=\":443\"; ma=86400","vary":"Origin","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=yepiiITqvDhH2V9Zj0e6ZzDSEab4IA6JaEGIcbVSfvFTL2cGAG2PV3uwmZNBAy%2FuEZrUVz9%2FgXgN%2F6L50gYu0q4QuABMK9zpeSZ120CBq3j1vwT3byjwSi0%3D\"}]}","etag":"\"656b4895b17be5d061928747d47a2d79\"","x-content-type-options":"nosniff","cache-control":"public, max-age=31536000, immutable","cf-ray":"a0a0fcb8681731aa-LHR"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/memory/memory_toolset.ts","time":1781184802}