/**
 * Recursive search for `fs.search`.
 *
 * Directory traversal uses the contained open for every directory, so a
 * symlinked directory cannot redirect the walk outside the agent root.
 * Symlinked files are searched through the same containment check; directory
 * links are skipped to avoid cycles.
 */

import { type OpenedTarget, openTarget } from "./containment.ts";
import { HostError } from "./protocol.ts";

const MAX_DEPTH = 32;
const MAX_SCANNED = 20_000;
const MAX_TEXT_FILE_BYTES = 8_388_608;
const SNIPPET_CHARS = 500;

export interface SearchOptions {
  readonly root: string;
  readonly path: string;
  readonly kind: "name" | "text";
  readonly name?: string;
  readonly text?: string;
  readonly maxResults: number;
}

interface SearchState {
  scanned: number;
  truncated: boolean;
  results: Array<Record<string, unknown>>;
}

function globRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close < 0) {
        source += "\\[";
        continue;
      }
      let body = pattern.slice(index + 1, close);
      const negated = body.startsWith("!");
      if (negated) body = body.slice(1);
      body = body.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
      source += `[${negated ? "^" : ""}${body}]`;
      index = close;
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function truncate(value: string): string {
  return value.length > SNIPPET_CHARS
    ? `${value.slice(0, SNIPPET_CHARS)}…`
    : value;
}

async function searchTextFile(
  options: SearchOptions,
  agentPath: string,
  state: SearchState,
): Promise<void> {
  let target;
  try {
    target = await openTarget(options.root, agentPath, { requireFile: true });
  } catch (error) {
    if (error instanceof HostError) return;
    throw error;
  }
  try {
    if (target.info.size > MAX_TEXT_FILE_BYTES) return;
    const file = target.file;
    if (!file) return;
    const bytes = new Uint8Array(target.info.size);
    let read = 0;
    while (read < bytes.length) {
      const chunk = await file.read(bytes.subarray(read));
      if (chunk === null) break;
      read += chunk;
    }
    const content = bytes.subarray(0, read);
    if (content.includes(0)) return;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return;
    }
    const lines = splitLines(text);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].includes(options.text ?? "")) continue;
      state.results.push({
        path: agentPath,
        line: index + 1,
        snippet: truncate(lines[index].trimEnd()),
      });
      if (state.results.length >= options.maxResults) {
        state.truncated = true;
        return;
      }
    }
  } finally {
    target.close();
  }
}

async function walk(
  options: SearchOptions,
  directory: OpenedTarget,
  directoryPath: string,
  depth: number,
  pattern: RegExp | undefined,
  state: SearchState,
): Promise<void> {
  for await (const entry of Deno.readDir(directory.listingPath)) {
    if (state.truncated) return;
    state.scanned++;
    if (state.scanned > MAX_SCANNED) {
      state.truncated = true;
      return;
    }
    const agentPath = `${directoryPath}/${entry.name}`;
    if (entry.isSymlink && options.kind === "name") {
      if (pattern?.test(entry.name)) {
        state.results.push({ path: agentPath, type: "symlink" });
        if (state.results.length >= options.maxResults) {
          state.truncated = true;
          return;
        }
      }
      continue;
    }
    if (entry.isDirectory) {
      // A name search reports directories like find(1) does; a text search
      // only reports files that contain the text.
      if (options.kind === "name" && pattern?.test(entry.name)) {
        state.results.push({ path: agentPath, type: "directory" });
        if (state.results.length >= options.maxResults) {
          state.truncated = true;
          return;
        }
      }
      if (depth >= MAX_DEPTH) continue;
      let child;
      try {
        child = await openTarget(options.root, agentPath, {
          requireDirectory: true,
        });
      } catch {
        continue;
      }
      try {
        await walk(options, child, agentPath, depth + 1, pattern, state);
      } finally {
        child.close();
      }
      continue;
    }

    let isFile = entry.isFile;
    if (entry.isSymlink) {
      let referent;
      try {
        referent = await openTarget(options.root, agentPath);
      } catch {
        continue;
      }
      const wasFile = referent.info.isFile;
      referent.close();
      if (!wasFile) continue;
      isFile = true;
    }
    if (!isFile) continue;
    if (pattern && !pattern.test(entry.name)) continue;

    if (options.kind === "name") {
      state.results.push({
        path: agentPath,
        type: entry.isSymlink ? "symlink" : "file",
      });
      if (state.results.length >= options.maxResults) {
        state.truncated = true;
        return;
      }
      continue;
    }
    await searchTextFile(options, agentPath, state);
    if (state.truncated) return;
  }
}

export async function searchFiles(
  options: SearchOptions,
): Promise<{ result: Record<string, unknown> }> {
  const state: SearchState = { scanned: 0, truncated: false, results: [] };
  const pattern = options.name ? globRegExp(options.name) : undefined;
  const start = await openTarget(options.root, options.path, {
    requireDirectory: true,
  });
  try {
    const base = options.path === "/" ? "" : options.path.replace(/\/+$/, "");
    await walk(options, start, base, 0, pattern, state);
  } finally {
    start.close();
  }
  return {
    result: {
      path: options.path,
      kind: options.kind,
      results: state.results,
      truncated: state.truncated,
    },
  };
}
