/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { isAbsolute, join, normalize } from "@std/path/posix";
import { actionableToolError } from "../ToolSupport.ts";

/**
 * Resolve a model-supplied directory against the runtime working directory.
 *
 * Tool descriptions accept relative directories, but every runtime requires an
 * absolute `cwd` and rejects the rest with an internal error. Resolving here
 * keeps the documented promise and the failure model-facing.
 */
export function resolveRuntimeDirectory(
  base: string,
  directory: string | undefined,
): string {
  if (directory === undefined) return base;
  const candidate = directory.replaceAll("\\", "/");
  if (candidate.split("/").includes("..")) {
    throw actionableToolError([
      "The directory leaves this computer's working area.",
      "Directories may not contain '..'.",
      "Use an absolute path such as /shared/project, or a path relative to the current working directory.",
    ]);
  }
  const resolved = isAbsolute(candidate)
    ? normalize(candidate)
    : normalize(join(base, candidate));
  if (!resolved.startsWith("/")) {
    throw actionableToolError([
      "The directory is not an absolute path inside this computer.",
      `The working directory is "${base}", but "${directory}" did not resolve beneath it.`,
      "Use an absolute path such as /shared/project, or a path relative to the current working directory.",
    ]);
  }
  return resolved;
}
