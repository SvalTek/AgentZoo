/**
 * Atomic writes served by `fs.write`.
 *
 * The target's parent directory is opened through the kernel containment check;
 * the final component is handled without following symlinks. Content goes to a
 * temporary file in the same directory and is committed with link(2) (create,
 * refusing an existing target) or rename(2) (replace), so a failure never
 * leaves a partially written file.
 */

import { HostError, MAX_REQUEST_BYTES } from "./protocol.ts";
import { openTarget } from "./containment.ts";

export type WriteMode = "create" | "overwrite" | "append";

export interface WriteResult {
  readonly result: Record<string, unknown>;
}

function splitAgentPath(
  path: string,
): { parent: string; name: string } {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  const parent = index <= 0 ? "/" : trimmed.slice(0, index);
  const name = trimmed.slice(index + 1);
  if (!name || name === "." || name === "..") {
    throw new HostError("invalid_request", `"${path}" is not a file path`);
  }
  return { parent, name };
}

async function readCurrentFile(
  targetPath: string,
  expected: Deno.FileInfo,
): Promise<Uint8Array> {
  const file = await Deno.open(targetPath, { read: true });
  try {
    const current = await file.stat();
    // The lstat and the open are separate calls; refuse when the path changed
    // underneath us instead of reading a swapped target.
    if (
      (expected.dev !== undefined && current.dev !== undefined &&
        expected.dev !== current.dev) ||
      (expected.ino !== undefined && current.ino !== undefined &&
        expected.ino !== current.ino)
    ) {
      throw new HostError("conflict", "the file changed while it was opened");
    }
    const bytes = new Uint8Array(current.size);
    let read = 0;
    while (read < bytes.length) {
      const chunk = await file.read(bytes.subarray(read));
      if (chunk === null) break;
      read += chunk;
    }
    return bytes.subarray(0, read);
  } finally {
    file.close();
  }
}

async function writeAll(
  file: Deno.FsFile,
  bytes: Uint8Array,
): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    written += await file.write(bytes.subarray(written));
  }
}

export async function writeAgentFile(
  root: string,
  path: string,
  mode: WriteMode,
  payload: Uint8Array,
): Promise<WriteResult> {
  if (payload.length > MAX_REQUEST_BYTES) {
    throw new HostError(
      "too_large",
      `content exceeds the ${MAX_REQUEST_BYTES}-byte write limit`,
    );
  }
  const { parent, name } = splitAgentPath(path);
  const directory = await openTarget(root, parent, { requireDirectory: true });
  try {
    const targetPath = `${directory.listingPath}/${name}`;
    let existing: Deno.FileInfo | undefined;
    try {
      existing = await Deno.lstat(targetPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        if (error instanceof Deno.errors.PermissionDenied) {
          throw new HostError("permission_denied", `"${path}" is not writable`);
        }
        throw error;
      }
    }

    if (existing?.isSymlink) {
      throw new HostError(
        "symlink",
        `"${path}" is a symbolic link; replace the link itself instead`,
      );
    }
    if (existing && !existing.isFile) {
      throw new HostError("not_a_file", `"${path}" is not a regular file`);
    }
    if (mode === "create" && existing) {
      throw new HostError("conflict", `"${path}" already exists`);
    }

    const prefix = mode === "append" && existing
      ? await readCurrentFile(targetPath, existing)
      : new Uint8Array();
    const tempPath =
      `${directory.listingPath}/.agentzoo-write-${crypto.randomUUID()}`;
    try {
      let file: Deno.FsFile;
      try {
        file = await Deno.open(tempPath, {
          createNew: true,
          write: true,
          mode: 0o666,
        });
      } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) {
          throw new HostError(
            "permission_denied",
            `"${parent}" is not writable`,
          );
        }
        throw error;
      }
      try {
        if (prefix.length > 0) await writeAll(file, prefix);
        await writeAll(file, payload);
      } finally {
        file.close();
      }

      if (existing) {
        if (existing.mode !== null) {
          await Deno.chmod(tempPath, existing.mode & 0o7777);
        }
        if (
          Deno.build.os === "linux" && existing.uid !== null &&
          existing.gid !== null
        ) {
          await Deno.chown(tempPath, existing.uid, existing.gid).catch(() =>
            undefined
          );
        }
      }

      if (mode === "create") {
        try {
          await Deno.link(tempPath, targetPath);
        } catch (error) {
          if (error instanceof Deno.errors.AlreadyExists) {
            throw new HostError("conflict", `"${path}" already exists`);
          }
          throw error;
        }
        await Deno.remove(tempPath);
      } else {
        await Deno.rename(tempPath, targetPath);
      }
    } finally {
      await Deno.remove(tempPath).catch(() => undefined);
    }

    return {
      result: {
        path,
        mode,
        created: existing === undefined,
        sizeBytes: prefix.length + payload.length,
      },
    };
  } finally {
    directory.close();
  }
}

export async function removeAgentFile(
  root: string,
  path: string,
): Promise<{ result: Record<string, unknown> }> {
  const { parent, name } = splitAgentPath(path);
  const directory = await openTarget(root, parent, { requireDirectory: true });
  try {
    const targetPath = `${directory.listingPath}/${name}`;
    let info: Deno.FileInfo | undefined;
    try {
      info = await Deno.lstat(targetPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { result: { path, removed: false } };
      }
      if (error instanceof Deno.errors.PermissionDenied) {
        throw new HostError("permission_denied", `"${path}" is not removable`);
      }
      throw error;
    }
    if (info.isDirectory) {
      throw new HostError(
        "not_a_file",
        `"${path}" is a directory; recursive removal is not supported`,
      );
    }
    // Removing through the parent fd unlinks the entry itself, so a symlink is
    // removed rather than its referent.
    await Deno.remove(targetPath);
    return { result: { path, removed: true } };
  } finally {
    directory.close();
  }
}
