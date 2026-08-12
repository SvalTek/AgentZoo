// ---------------------------------------------------------------------------
// Graph FSM - state persistence
// ---------------------------------------------------------------------------

import type { NodeId } from "./types.ts";

/** Snapshot of graph execution state that can be saved and restored. */
export interface GraphSnapshot<TState> {
  readonly nodeId: NodeId;
  readonly state: TState;
}

/**
 * Pluggable persistence interface for graph execution state.
 * Implement this to enable resumable graph runs across process restarts.
 */
export interface StatePersistence<TState> {
  /** Persist the current node and state for a graph run. */
  save(graphId: string, nodeId: NodeId, state: TState): Promise<void>;
  /** Load the last saved snapshot, or null if none exists. */
  load(graphId: string): Promise<GraphSnapshot<TState> | null>;
  /** Remove saved state for a graph run (called on successful completion). */
  clear(graphId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// MemoryStatePersistence
// ---------------------------------------------------------------------------

/**
 * In-memory persistence - useful for testing and single-process workflows.
 * State is lost when the process exits.
 */
export class MemoryStatePersistence<TState>
  implements StatePersistence<TState> {
  private readonly store = new Map<string, GraphSnapshot<TState>>();

  save(graphId: string, nodeId: NodeId, state: TState): Promise<void> {
    this.store.set(graphId, { nodeId, state });
    return Promise.resolve();
  }

  load(graphId: string): Promise<GraphSnapshot<TState> | null> {
    return Promise.resolve(this.store.get(graphId) ?? null);
  }

  clear(graphId: string): Promise<void> {
    this.store.delete(graphId);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// FileStatePersistence
// ---------------------------------------------------------------------------

/**
 * File-backed persistence - survives process restarts.
 * State is JSON-serialized and stored in `{dir}/{graphId}.json`.
 *
 * Requires `--allow-read` and `--allow-write` Deno permissions for the directory.
 */
export class FileStatePersistence<TState> implements StatePersistence<TState> {
  constructor(private readonly dir: string) {}

  private filePath(graphId: string): string {
    // Replace characters that are invalid in filenames
    const safe = graphId.replace(/[/\\:*?"<>|]/g, "_");
    return `${this.dir}/${safe}.json`;
  }

  async save(graphId: string, nodeId: NodeId, state: TState): Promise<void> {
    const snapshot: GraphSnapshot<TState> = { nodeId, state };
    const json = JSON.stringify(snapshot, null, 2);
    await Deno.writeTextFile(this.filePath(graphId), json);
  }

  async load(graphId: string): Promise<GraphSnapshot<TState> | null> {
    try {
      const json = await Deno.readTextFile(this.filePath(graphId));
      const parsed: unknown = JSON.parse(json);
      // Validate structure before returning
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "nodeId" in parsed &&
        "state" in parsed &&
        typeof (parsed as Record<string, unknown>).nodeId === "string"
      ) {
        return parsed as GraphSnapshot<TState>;
      }
      return null;
    } catch {
      // File not found or parse error - treat as no saved state
      return null;
    }
  }

  async clear(graphId: string): Promise<void> {
    try {
      await Deno.remove(this.filePath(graphId));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

// denoCacheMetadata={"headers":{"etag":"\"0f12d9a425de0afc9328df1263c6f2bf\"","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-expose-headers":"*","access-control-allow-origin":"*","server":"cloudflare","cf-ray":"a0a0fcb86ff331aa-LHR","content-type":"text/typescript","cross-origin-resource-policy":"cross-origin","content-length":"3636","cache-control":"public, max-age=31536000, immutable","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","date":"Thu, 11 Jun 2026 13:33:23 GMT","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=nrGuJ%2BInyBfsA1IBcYVUJoPTFndyURb8YmC5SxhBPdl3xexLmfEkBRcz2rT52nZduVatOOIEQ7vCuY7dH1XEsmqehovDyDfPHizZu789QBT8%2Fja5PgtdKRY%3D\"}]}","vary":"Origin","x-content-type-options":"nosniff","content-encoding":"identity","x-jsr-backend":"modules","x-robots-tag":"noindex","alt-svc":"h3=\":443\"; ma=86400"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/graph/persistence.ts","time":1781184802}