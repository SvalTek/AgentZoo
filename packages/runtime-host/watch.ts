/**
 * Filesystem watch subscriptions.
 *
 * Events are coalesced per path and emitted in batches. The watch follows the
 * resolved directory on the host; it is advisory (notifications for the
 * dashboard and tools), while every actual read or write still goes through
 * the contained open.
 */

import type { OpenedTarget } from "./containment.ts";

export interface WatchSpec {
  readonly path: string;
  readonly depth: number;
  readonly debounceMs: number;
}

export interface WatchHandle {
  close(): void;
}

/** Cap on paths buffered between debounce flushes. */
const MAX_PENDING_PATHS = 4096;

function depthOf(path: string): number {
  return path.split("/").filter(Boolean).length;
}

export function startWatch(
  target: OpenedTarget,
  spec: WatchSpec,
  emit: (paths: readonly string[], dropped: number) => void,
): WatchHandle {
  const watcher = Deno.watchFs(target.path, { recursive: true });
  const hostRoot = target.path.replaceAll("\\", "/").replace(/\/+$/, "");
  const pending = new Set<string>();
  const base = spec.path === "/" ? "" : spec.path.replace(/\/+$/, "");
  const baseDepth = depthOf(base);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let dropped = 0;

  const flush = () => {
    timer = undefined;
    if (closed || pending.size === 0) return;
    const paths = [...pending].sort();
    pending.clear();
    const lost = dropped;
    dropped = 0;
    emit(paths, lost);
  };

  (async () => {
    try {
      for await (const event of watcher) {
        if (closed) break;
        if (event.kind === "access") continue;
        for (const hostPath of event.paths) {
          const normalized = hostPath.replaceAll("\\", "/");
          if (!normalized.startsWith(`${hostRoot}/`)) continue;
          const relative = normalized.slice(hostRoot.length)
            .replace(/^\/+/, "");
          if (relative === "") continue;
          const agentPath = `${base}/${relative}`;
          if (depthOf(agentPath) - baseDepth > spec.depth) continue;
          if (pending.size >= MAX_PENDING_PATHS) {
            dropped++;
            continue;
          }
          pending.add(agentPath);
        }
        if (pending.size > 0 && timer === undefined) {
          timer = setTimeout(flush, spec.debounceMs);
        }
      }
    } catch {
      // The watcher is closed when the subscription ends.
    }
  })();

  return {
    close: () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      pending.clear();
      dropped = 0;
      watcher.close();
    },
  };
}
