/**
 * Operation dispatch for the runtime-host service.
 *
 * Phase 1 is read-only: `ping`, `fs.stat`, and `fs.read` (bytes or lines).
 * Writes, search, list, and subscriptions follow the same envelope.
 */

import { z } from "zod";
import {
  DEFAULT_BYTE_LIMIT,
  DEFAULT_LINE_LIMIT,
  HELPER_VERSION,
  HostError,
  MAX_LINE_LIMIT,
  PROTOCOL_VERSION,
} from "./protocol.ts";
import { agentRoot } from "./paths.ts";
import { openTarget } from "./containment.ts";
import { listDirectory } from "./list.ts";
import { readBytes, readLines } from "./read.ts";
import { searchFiles } from "./search.ts";
import { startWatch, type WatchHandle } from "./watch.ts";
import { writeAgentFile, type WriteMode } from "./write.ts";

export interface OperationContext {
  readonly agentsRoot: string;
}

export interface OperationResult {
  readonly result: Record<string, unknown>;
  readonly payload?: Uint8Array;
}

const WatchParams = z.object({
  path: z.string().min(1),
  depth: z.number().int().nonnegative().max(32).optional(),
  debounceMs: z.number().int().positive().max(5000).optional(),
});

const StatParams = z.object({
  path: z.string().min(1),
});

const ListParams = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive().max(5000).optional(),
});

const SearchParams = z.object({
  path: z.string().min(1),
  kind: z.enum(["name", "text"]),
  name: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(200).optional(),
});

const WriteParams = z.object({
  path: z.string().min(1),
  mode: z.enum(["create", "overwrite", "append"]),
});

const ReadParams = z.object({
  path: z.string().min(1),
  unit: z.enum(["bytes", "lines"]),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  startLine: z.number().int().positive().optional(),
  lineLimit: z.number().int().positive().optional(),
});

async function existingAgentRoot(
  context: OperationContext,
  agent: string | undefined,
): Promise<string> {
  const root = agentRoot(context.agentsRoot, agent);
  const info = await Deno.stat(root).catch(() => undefined);
  if (!info?.isDirectory) {
    throw new HostError(
      "unknown_agent",
      `agent "${agent ?? ""}" has no environment`,
    );
  }
  return root;
}

function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HostError(
      "invalid_request",
      issue
        ? `${issue.path.join(".") || "params"}: ${issue.message}`
        : "invalid params",
    );
  }
  return parsed.data;
}

function fileType(
  info: Deno.FileInfo,
): "file" | "directory" | "symlink" | "other" {
  return info.isFile
    ? "file"
    : info.isDirectory
    ? "directory"
    : info.isSymlink
    ? "symlink"
    : "other";
}

export async function startAgentWatch(
  context: OperationContext,
  agent: string | undefined,
  params: unknown,
  emit: (paths: readonly string[], dropped: number) => void,
): Promise<WatchHandle> {
  const input = parseParams(WatchParams, params);
  const root = await existingAgentRoot(context, agent);
  const target = await openTarget(root, input.path, {
    requireDirectory: true,
  });
  try {
    return startWatch(target, {
      path: input.path,
      depth: input.depth ?? 2,
      debounceMs: input.debounceMs ?? 100,
    }, emit);
  } catch (error) {
    throw new HostError(
      "watch_limit",
      `could not watch "${input.path}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    target.close();
  }
}

export async function executeOperation(
  context: OperationContext,
  op: string,
  agent: string | undefined,
  params: unknown,
  payload?: Uint8Array,
): Promise<OperationResult> {
  if (op === "ping") {
    return {
      result: {
        protocol: PROTOCOL_VERSION,
        helperVersion: HELPER_VERSION,
      },
    };
  }

  if (op === "fs.stat") {
    const input = parseParams(StatParams, params);
    const root = await existingAgentRoot(context, agent);
    const target = await openTarget(root, input.path, { requireFile: false });
    try {
      return {
        result: {
          path: input.path,
          type: fileType(target.info),
          sizeBytes: target.info.size,
          mode: target.info.mode,
          mtimeMs: target.info.mtime?.getTime() ?? null,
          symlink: target.symlink,
        },
      };
    } finally {
      target.close();
    }
  }

  if (op === "fs.write") {
    const input = parseParams(WriteParams, params);
    const root = await existingAgentRoot(context, agent);
    return await writeAgentFile(
      root,
      input.path,
      input.mode as WriteMode,
      payload ?? new Uint8Array(),
    );
  }

  if (op === "fs.read") {
    const input = parseParams(ReadParams, params);
    const root = await existingAgentRoot(context, agent);
    const target = await openTarget(root, input.path, { requireFile: true });
    const file = target.file;
    if (!file) {
      target.close();
      throw new HostError(
        "not_a_file",
        `"${input.path}" is not a regular file`,
      );
    }
    try {
      if (input.unit === "bytes") {
        if (input.startLine !== undefined || input.lineLimit !== undefined) {
          throw new HostError(
            "invalid_request",
            "byte reads take offset and limit, not startLine and lineLimit",
          );
        }
        return await readBytes(
          file,
          target.info,
          input.path,
          input.offset ?? 0,
          input.limit ?? DEFAULT_BYTE_LIMIT,
        );
      }
      if (input.offset !== undefined || input.limit !== undefined) {
        throw new HostError(
          "invalid_request",
          "line reads take startLine and lineLimit, not offset and limit",
        );
      }
      if ((input.lineLimit ?? DEFAULT_LINE_LIMIT) > MAX_LINE_LIMIT) {
        throw new HostError(
          "invalid_request",
          `lineLimit cannot exceed ${MAX_LINE_LIMIT}`,
        );
      }
      return await readLines(
        file,
        target.info,
        input.path,
        input.startLine ?? 1,
        input.lineLimit ?? DEFAULT_LINE_LIMIT,
      );
    } finally {
      target.close();
    }
  }

  if (op === "fs.list") {
    const input = parseParams(ListParams, params);
    const root = await existingAgentRoot(context, agent);
    const target = await openTarget(root, input.path, {
      requireDirectory: true,
    });
    try {
      return await listDirectory(target, input.path, input.limit ?? 500);
    } finally {
      target.close();
    }
  }

  if (op === "fs.search") {
    const input = parseParams(SearchParams, params);
    if (input.kind === "name" && !input.name) {
      throw new HostError(
        "invalid_request",
        "name is required for a name search",
      );
    }
    if (input.kind === "text" && !input.text) {
      throw new HostError(
        "invalid_request",
        "text is required for a text search",
      );
    }
    const root = await existingAgentRoot(context, agent);
    return await searchFiles({
      root,
      path: input.path,
      kind: input.kind,
      ...(input.name ? { name: input.name } : {}),
      ...(input.text ? { text: input.text } : {}),
      maxResults: input.maxResults ?? 50,
    });
  }

  throw new HostError("invalid_request", `unknown operation "${op}"`);
}
