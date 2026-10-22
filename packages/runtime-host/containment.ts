/**
 * Kernel-enforced containment for file opens.
 *
 * The lexical resolver in `paths.ts` produces the model-facing errors, but a
 * check followed by an open on an agent-controlled tree is racy. On Linux the
 * actual open goes through `openat2(RESOLVE_IN_ROOT | RESOLVE_NO_MAGICLINKS)`,
 * so the kernel refuses an escape even if a symlink changes between the check
 * and the open. Other platforms use the resolved path directly; the service is
 * only deployed on Linux.
 */

import { HostError } from "./protocol.ts";
import { resolveExisting } from "./paths.ts";

const SYS_OPENAT2 = 437n;
const O_RDONLY = 0;
const O_WRONLY = 0x1;
const O_APPEND = 0x400;
const O_CLOEXEC = 0x80000;
const O_NONBLOCK = 0x800;
const O_DIRECTORY = 0x10000;
const AT_FDCWD = -100;
const RESOLVE_NO_MAGICLINKS = 0x02;
// Chroot-style: absolute link targets and ".." are resolved from the root.
const RESOLVE_IN_ROOT = 0x10;
const OPEN_HOW_SIZE = 24;

interface LibcSymbols {
  // glibc ships no openat2 wrapper and Deno FFI has no variadic parameters,
  // so the raw syscall is declared with fixed arity.
  syscall(
    number: bigint,
    dirfd: bigint,
    path: Uint8Array,
    how: Uint8Array,
    size: bigint,
  ): bigint;
  close(fd: number): number;
}

let libcSymbols: LibcSymbols | undefined;

function libc(): LibcSymbols {
  if (Deno.build.os !== "linux") {
    throw new HostError(
      "internal",
      "openat2 containment is only available on Linux",
    );
  }
  libcSymbols ??= (Deno.dlopen("libc.so.6", {
    syscall: {
      parameters: ["isize", "isize", "buffer", "buffer", "usize"],
      result: "isize",
    },
    close: { parameters: ["i32"], result: "i32" },
  }).symbols) as unknown as LibcSymbols;
  return libcSymbols;
}

function openHow(flags: number, resolve: number): Uint8Array {
  const how = new Uint8Array(OPEN_HOW_SIZE);
  const view = new DataView(how.buffer);
  // The kernel reads a little-endian u64 triple; DataView defaults to BE.
  view.setBigUint64(0, BigInt(flags), true);
  view.setBigUint64(8, 0n, true);
  view.setBigUint64(16, BigInt(resolve), true);
  return how;
}

function encodePath(path: string): Uint8Array {
  const bytes = new TextEncoder().encode(path);
  const terminated = new Uint8Array(bytes.length + 1);
  terminated.set(bytes);
  return terminated;
}

/**
 * Open the requested path through the kernel's containment check.
 * Returns an OS file descriptor, or throws when the kernel refuses it.
 */
function openBeneath(
  root: string,
  requested: string,
  directory: boolean,
  append = false,
): number {
  const symbols = libc();
  const rootFd = Number(symbols.syscall(
    SYS_OPENAT2,
    BigInt(AT_FDCWD),
    encodePath(root),
    openHow(O_RDONLY | O_CLOEXEC, 0),
    BigInt(OPEN_HOW_SIZE),
  ));
  if (rootFd < 0) {
    throw new HostError("internal", `agent root "${root}" could not be opened`);
  }
  try {
    const relative = requested.replace(/^\/+/, "") || ".";
    return Number(symbols.syscall(
      SYS_OPENAT2,
      BigInt(rootFd),
      encodePath(relative),
      openHow(
        (append
          ? O_WRONLY | O_APPEND
          : O_RDONLY | (directory ? O_DIRECTORY : 0)) |
          O_CLOEXEC | O_NONBLOCK,
        RESOLVE_IN_ROOT | RESOLVE_NO_MAGICLINKS,
      ),
      BigInt(OPEN_HOW_SIZE),
    ));
  } finally {
    symbols.close(rootFd);
  }
}

export interface OpenedTarget {
  readonly info: Deno.FileInfo;
  /** Host path of the resolved referent, for advisory watches. */
  readonly path: string;
  /** The requested path traversed a symlink somewhere inside the root. */
  readonly symlink: boolean;
  /** Present for regular files. */
  readonly file?: Deno.FsFile;
  /** Directory path safe to list entries from, or the resolved path. */
  readonly listingPath: string;
  close(): void;
}

export interface OpenTargetOptions {
  readonly requireFile?: boolean;
  readonly requireDirectory?: boolean;
  /** Open an existing regular file for appending instead of reading. */
  readonly append?: boolean;
}

/**
 * Resolve, then open a target beneath one agent root.
 *
 * The lexical resolution supplies the error text and the symlink flag; the
 * open is repeated under kernel containment so a swapped symlink cannot turn
 * the result into an escape.
 */
export async function openTarget(
  root: string,
  requested: string,
  options: OpenTargetOptions = {},
): Promise<OpenedTarget> {
  const resolved = await resolveExisting(root, requested);
  if (Deno.build.os !== "linux") {
    const info = await Deno.stat(resolved.path);
    if (options.requireFile && !info.isFile) {
      throw new HostError("not_a_file", `"${requested}" is not a regular file`);
    }
    if (options.requireDirectory && !info.isDirectory) {
      throw new HostError(
        "not_a_directory",
        `"${requested}" is not a directory`,
      );
    }
    const file = options.append
      ? await Deno.open(resolved.path, { write: true, append: true })
      : options.requireFile
      ? await Deno.open(resolved.path, { read: true })
      : undefined;
    return {
      info,
      path: resolved.path,
      symlink: resolved.symlink,
      listingPath: resolved.path,
      ...(file ? { file } : {}),
      close: () => file?.close(),
    };
  }

  const fd = openBeneath(
    root,
    requested,
    options.requireDirectory === true,
    options.append === true,
  );
  if (fd < 0) {
    // The lexical pass succeeded, so classify the refusal from the resolved
    // referent; the kernel still made the security decision.
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(resolved.path);
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        throw new HostError(
          "permission_denied",
          `"${requested}" is not accessible`,
        );
      }
      throw new HostError("not_found", `"${requested}" does not exist`);
    }
    if (options.requireDirectory && !info.isDirectory) {
      throw new HostError(
        "not_a_directory",
        `"${requested}" is not a directory`,
      );
    }
    if (options.requireFile && !info.isFile) {
      throw new HostError("not_a_file", `"${requested}" is not a regular file`);
    }
    throw new HostError(
      "path_escape",
      `"${requested}" could not be opened inside the agent root`,
    );
  }
  const procPath = `/proc/self/fd/${fd}`;
  try {
    const info = await Deno.stat(procPath);
    if (options.requireFile && !info.isFile) {
      throw new HostError("not_a_file", `"${requested}" is not a regular file`);
    }
    if (options.requireDirectory && !info.isDirectory) {
      throw new HostError(
        "not_a_directory",
        `"${requested}" is not a directory`,
      );
    }
    const file = options.append
      ? await Deno.open(procPath, { write: true, append: true })
      : options.requireFile
      ? await Deno.open(procPath, { read: true })
      : undefined;
    return {
      info,
      path: resolved.path,
      symlink: resolved.symlink,
      listingPath: procPath,
      ...(file ? { file } : {}),
      close: () => {
        file?.close();
        libc().close(fd);
      },
    };
  } catch (error) {
    libc().close(fd);
    throw error;
  }
}
