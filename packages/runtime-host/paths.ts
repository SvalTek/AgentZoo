/**
 * Resolve a requested path inside one agent's merged root.
 *
 * On Linux the resolver mirrors chroot semantics: absolute symlink targets are
 * interpreted from the agent root, and `..` inside a link clamps at the root.
 * That is the same meaning the path has inside the agent, and it makes an
 * escape structurally impossible; the kernel repeats the resolution under
 * RESOLVE_IN_ROOT when the file is opened. Other platforms use host semantics
 * because the service is only deployed on Linux and tests run locally.
 */

import { HostError } from "./protocol.ts";

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SYMLINKS = 32;

export function agentRoot(
  agentsRoot: string,
  agent: string | undefined,
): string {
  if (!agent || !AGENT_ID.test(agent)) {
    throw new HostError("unknown_agent", `unknown agent "${agent ?? ""}"`);
  }
  return `${agentsRoot}/${agent}/merged`;
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export interface ResolvedPath {
  /** Absolute host path of the referent, always beneath the agent root. */
  readonly path: string;
  /** The requested path itself was a symlink somewhere along the way. */
  readonly symlink: boolean;
}

/** Chroot-style resolution: absolute link targets start at the agent root. */
async function resolveChroot(
  root: string,
  requested: string,
): Promise<ResolvedPath> {
  const requestedParts = requested.split("/").filter(Boolean);
  if (requestedParts.includes("..")) {
    throw new HostError(
      "path_escape",
      `"${requested}" contains "..", which is not allowed`,
    );
  }
  const queue = requestedParts.filter((part) => part !== ".");
  const stack: string[] = [];
  let symlink = false;
  let followed = 0;
  while (queue.length > 0) {
    const part = queue.shift()!;
    if (part === "..") {
      // Inside a link target, ".." clamps at the root instead of escaping.
      stack.pop();
      continue;
    }
    const candidate = `${root}/${[...stack, part].join("/")}`;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new HostError("not_found", `"${requested}" does not exist`);
      }
      throw error;
    }
    if (info.isSymlink) {
      if (++followed > MAX_SYMLINKS) {
        throw new HostError(
          "path_escape",
          `"${requested}" has too many symbolic links`,
        );
      }
      const target = await Deno.readLink(candidate);
      const targetParts = target.split("/").filter((value) =>
        value.length > 0 && value !== "."
      );
      if (target.startsWith("/")) stack.length = 0;
      queue.unshift(...targetParts);
      symlink = true;
      continue;
    }
    if (queue.length > 0 && !info.isDirectory) {
      throw new HostError(
        "not_a_directory",
        `"${requested}" passes through a file`,
      );
    }
    stack.push(part);
  }
  return {
    path: stack.length > 0 ? `${root}/${stack.join("/")}` : root,
    symlink,
  };
}

/** Host semantics for local tests on platforms other than Linux. */
async function resolveHost(
  root: string,
  requested: string,
): Promise<ResolvedPath> {
  const parts = requested.split("/").filter((part) =>
    part.length > 0 && part !== "."
  );
  let current = root;
  let symlink = false;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === "..") {
      throw new HostError(
        "path_escape",
        `"${requested}" contains "..", which is not allowed`,
      );
    }
    const candidate = `${current}/${part}`;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new HostError("not_found", `"${requested}" does not exist`);
      }
      throw error;
    }
    if (index < parts.length - 1 && !info.isDirectory && !info.isSymlink) {
      throw new HostError(
        "not_a_directory",
        `"${requested}" passes through a file`,
      );
    }
    if (info.isSymlink) {
      let target: string;
      try {
        target = await Deno.realPath(candidate);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new HostError(
            "not_found",
            `"${requested}" points to a missing path`,
          );
        }
        throw error;
      }
      if (!isInside(root, target)) {
        throw new HostError(
          "path_escape",
          `"${requested}" resolves outside the agent root`,
        );
      }
      current = target;
      symlink = true;
    } else {
      current = candidate;
    }
  }
  if (!isInside(root, current)) {
    throw new HostError("path_escape", `"${requested}" leaves the agent root`);
  }
  return { path: current, symlink };
}

export function resolveExisting(
  root: string,
  requested: string,
): Promise<ResolvedPath> {
  if (!requested.startsWith("/") || requested.includes("\0")) {
    return Promise.reject(
      new HostError("path_escape", `"${requested}" is not an absolute path`),
    );
  }
  return Deno.build.os === "linux"
    ? resolveChroot(root, requested)
    : resolveHost(root, requested);
}
