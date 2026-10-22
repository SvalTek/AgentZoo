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
import { type OpenedTarget, openTarget } from "./containment.ts";

export type WriteMode = "create" | "overwrite" | "append";

export interface WriteResult {
  readonly result: Record<string, unknown>;
}

/** Guard against a concurrent edit whose source snapshot is now stale. */
export interface WriteExpectation {
  readonly sizeBytes?: number;
  readonly mtimeMs?: number;
}

/** One tail promise per target, so concurrent writes cannot interleave. */
const pathLocks = new Map<string, Promise<unknown>>();

async function withPathLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = pathLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tail = run.catch(() => undefined);
  pathLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (pathLocks.get(key) === tail) pathLocks.delete(key);
  }
}

/**
 * Stable lock identity for one directory entry. The parent's device/inode
 * covers hard links and symlinked parents; the resolved path is the fallback
 * on platforms without inode numbers.
 */
function lockKey(
  root: string,
  directory: OpenedTarget,
  name: string,
): string {
  const { dev, ino } = directory.info;
  const parent = dev !== null && dev !== undefined && ino !== null &&
      ino !== undefined
    ? `${dev}:${ino}`
    : directory.path;
  return `${root}\u0000${parent}\u0000${name}`;
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

/**
 * Locate the descriptor that still points at the temp file, so mode and owner
 * changes act on the inode rather than on a directory entry the agent could
 * have swapped for a symlink. readlink() reports the canonical dentry path,
 * not the /proc path we opened, so match by device/inode instead.
 */
async function descriptorPathFor(
  tempPath: string,
  info: Deno.FileInfo,
): Promise<string> {
  if (Deno.build.os !== "linux") return tempPath;
  if (
    info.dev === null || info.dev === undefined || info.ino === null ||
    info.ino === undefined
  ) {
    return tempPath;
  }
  try {
    for await (const entry of Deno.readDir("/proc/self/fd")) {
      if (!/^\d+$/.test(entry.name)) continue;
      const fdPath = `/proc/self/fd/${entry.name}`;
      try {
        const candidate = await Deno.stat(fdPath);
        if (
          candidate.dev === info.dev && candidate.ino === info.ino
        ) {
          return fdPath;
        }
      } catch {
        // The descriptor closed while we scanned.
      }
    }
  } catch {
    // /proc is unavailable; fall back to the path.
  }
  return tempPath;
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

function changedSince(
  current: Deno.FileInfo | undefined,
  expected: WriteExpectation,
): boolean {
  if (current === undefined) {
    return expected.sizeBytes !== undefined || expected.mtimeMs !== undefined;
  }
  if (
    expected.sizeBytes !== undefined && current.size !== expected.sizeBytes
  ) return true;
  if (
    expected.mtimeMs !== undefined &&
    (current.mtime?.getTime() ?? null) !== expected.mtimeMs
  ) return true;
  return false;
}

export async function writeAgentFile(
  root: string,
  path: string,
  mode: WriteMode,
  payload: Uint8Array,
  permission?: number,
  expected?: WriteExpectation,
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
    return await withPathLock(
      lockKey(root, directory, name),
      () =>
        writeIntoDirectory(
          directory,
          parent,
          path,
          name,
          mode,
          payload,
          permission,
          expected,
        ),
    );
  } finally {
    directory.close();
  }
}

async function writeIntoDirectory(
  directory: OpenedTarget,
  parent: string,
  path: string,
  name: string,
  mode: WriteMode,
  payload: Uint8Array,
  permission: number | undefined,
  expected: WriteExpectation | undefined,
): Promise<WriteResult> {
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
      // Persist before the atomic commit; a crash after rename must not
      // leave the new name pointing at unflushed content.
      await file.sync();

      const info = await file.stat();
      const permissionPath = await descriptorPathFor(tempPath, info);
      if (permission !== undefined) {
        await Deno.chmod(permissionPath, permission & 0o7777);
      } else if (existing?.mode !== null && existing !== undefined) {
        await Deno.chmod(permissionPath, existing.mode! & 0o7777);
      }
      if (
        Deno.build.os === "linux" && existing?.uid !== null &&
        existing?.uid !== undefined && existing.gid !== null
      ) {
        await Deno.chown(permissionPath, existing.uid, existing.gid).catch(
          () => undefined,
        );
      }
    } finally {
      file.close();
    }

    if (mode === "append") {
      // The lock serializes service requests; this check catches an agent
      // process (or another writer) appending after our snapshot.
      let current: Deno.FileInfo | undefined;
      try {
        current = await Deno.lstat(targetPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const unchanged = existing === undefined
        ? current === undefined
        : current !== undefined &&
          current.size === existing.size &&
          (existing.ino === null || current.ino === null ||
            current.ino === existing.ino) &&
          (current.mtime?.getTime() ?? null) ===
            (existing.mtime?.getTime() ?? null);
      if (!unchanged) {
        throw new HostError(
          "conflict",
          `"${path}" changed while it was being appended`,
        );
      }
    } else if (mode === "overwrite" && expected !== undefined) {
      // edit_file passes the snapshot it read; refuse to replace a file that
      // changed after that read.
      let current: Deno.FileInfo | undefined;
      try {
        current = await Deno.lstat(targetPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      if (changedSince(current, expected)) {
        throw new HostError(
          "conflict",
          `"${path}" changed after it was read`,
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
}

export async function removeAgentFile(
  root: string,
  path: string,
): Promise<{ result: Record<string, unknown> }> {
  const { parent, name } = splitAgentPath(path);
  const directory = await openTarget(root, parent, { requireDirectory: true });
  try {
    return await withPathLock(
      lockKey(root, directory, name),
      async () => {
        const targetPath = `${directory.listingPath}/${name}`;
        let info: Deno.FileInfo | undefined;
        try {
          info = await Deno.lstat(targetPath);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            return { result: { path, removed: false } };
          }
          if (error instanceof Deno.errors.PermissionDenied) {
            throw new HostError(
              "permission_denied",
              `"${path}" is not removable`,
            );
          }
          throw error;
        }
        if (info.isDirectory) {
          throw new HostError(
            "not_a_file",
            `"${path}" is a directory; recursive removal is not supported`,
          );
        }
        // Removing through the parent fd unlinks the entry itself, so a
        // symlink is removed rather than its referent.
        await Deno.remove(targetPath);
        return { result: { path, removed: true } };
      },
    );
  } finally {
    directory.close();
  }
}
