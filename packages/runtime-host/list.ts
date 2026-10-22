/** Immediate directory listing for `fs.list`. */

import type { OpenedTarget } from "./containment.ts";
import { HostError } from "./protocol.ts";

export interface ListResult {
  readonly result: Record<string, unknown>;
}

function entryType(
  entry: Deno.DirEntry,
): "file" | "directory" | "symlink" | "other" {
  return entry.isDirectory
    ? "directory"
    : entry.isSymlink
    ? "symlink"
    : entry.isFile
    ? "file"
    : "other";
}

export async function listDirectory(
  target: OpenedTarget,
  path: string,
  limit: number,
): Promise<ListResult> {
  if (!target.info.isDirectory) {
    throw new HostError("not_a_directory", `"${path}" is not a directory`);
  }
  const entries: Array<{
    name: string;
    type: string;
    sizeBytes: number | null;
  }> = [];
  // Scan a bounded window so a large directory is sorted deterministically
  // before the caller's limit is applied. The extra entries make truncation
  // observable without depending on filesystem order.
  const scanLimit = Math.max(limit, 5000);
  let truncated = false;
  for await (const entry of Deno.readDir(target.listingPath)) {
    if (entries.length >= scanLimit) {
      truncated = true;
      break;
    }
    let sizeBytes: number | null = null;
    try {
      sizeBytes =
        (await Deno.lstat(`${target.listingPath}/${entry.name}`)).size;
    } catch {
      // The entry vanished between the directory read and the stat.
      sizeBytes = null;
    }
    entries.push({
      name: entry.name,
      type: entryType(entry),
      sizeBytes,
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > limit) {
    entries.length = limit;
    truncated = true;
  }
  return { result: { path, entries, truncated } };
}
