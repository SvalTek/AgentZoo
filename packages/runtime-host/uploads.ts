/**
 * Multipart uploads for `fs.write`.
 *
 * A session holds the contained parent directory and either an append handle
 * or a temp file. Chunks stream straight to disk, so the service never buffers
 * a whole payload; commit applies the same atomic rules as the one-shot write.
 */

import { z } from "zod";
import {
  HostError,
  MAX_UPLOAD_BYTES,
  MAX_UPLOADS_PER_CONNECTION,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_IDLE_MS,
} from "./protocol.ts";
import { type OpenedTarget, openTarget } from "./containment.ts";
import { agentRoot } from "./paths.ts";
import { type LogSink, silentLogger } from "./log.ts";
import {
  acquirePathLock,
  changedSince,
  descriptorPathFor,
  lockKey,
  splitAgentPath,
  writeAll,
  type WriteExpectation,
  type WriteMode,
} from "./write.ts";

const StartParams = z.object({
  path: z.string().min(1),
  mode: z.enum(["create", "overwrite", "append"]),
  sizeBytes: z.number().int().nonnegative().optional(),
  permission: z.number().int().nonnegative().max(0o7777).optional(),
  expectedSizeBytes: z.number().int().nonnegative().optional(),
  expectedMtimeMs: z.number().int().nonnegative().optional(),
});

const UploadParams = z.object({ upload: z.string().min(1) });

interface Session {
  readonly id: string;
  readonly agent: string;
  readonly path: string;
  readonly name: string;
  readonly mode: WriteMode;
  readonly directory: OpenedTarget;
  readonly existing?: Deno.FileInfo;
  readonly permission?: number;
  readonly expected?: WriteExpectation;
  readonly sizeBytes?: number;
  readonly append?: OpenedTarget;
  readonly temp?: Deno.FsFile;
  readonly tempPath?: string;
  readonly release: () => void;
  received: number;
  timer: ReturnType<typeof setTimeout>;
}

function parse<T>(schema: z.ZodType<T>, params: unknown): T {
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

async function existingAgentRoot(
  agentsRoot: string,
  agent: string | undefined,
): Promise<string> {
  const root = agentRoot(agentsRoot, agent);
  const info = await Deno.stat(root).catch(() => undefined);
  if (!info?.isDirectory) {
    throw new HostError(
      "unknown_agent",
      `agent "${agent ?? ""}" has no environment`,
    );
  }
  return root;
}

export class UploadManager {
  readonly #sessions = new Map<string, Session>();

  constructor(
    private readonly agentsRoot: string,
    private readonly logger: LogSink = silentLogger,
    private readonly maxSessions = MAX_UPLOADS_PER_CONNECTION,
  ) {}

  async start(
    agent: string | undefined,
    params: unknown,
  ): Promise<{ result: Record<string, unknown> }> {
    if (this.#sessions.size >= this.maxSessions) {
      throw new HostError(
        "too_large",
        `at most ${this.maxSessions} uploads may be open at once`,
      );
    }
    const input = parse(StartParams, params);
    if (
      input.sizeBytes !== undefined && input.sizeBytes > MAX_UPLOAD_BYTES
    ) {
      throw new HostError("too_large", "upload exceeds the total size limit");
    }
    const root = await existingAgentRoot(this.agentsRoot, agent);
    const { parent, name } = splitAgentPath(input.path);
    const directory = await openTarget(root, parent, {
      requireDirectory: true,
    });
    // Hold the entry lock for the whole session, so one-shot writes and other
    // uploads cannot interleave with the chunks of this append/replace.
    const release = await acquirePathLock(lockKey(root, directory, name));
    let appendTarget: OpenedTarget | undefined;
    let temp: Deno.FsFile | undefined;
    let tempPath: string | undefined;
    try {
      const targetPath = `${directory.listingPath}/${name}`;
      let existing: Deno.FileInfo | undefined;
      try {
        existing = await Deno.lstat(targetPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      if (existing?.isSymlink) {
        throw new HostError(
          "symlink",
          `"${input.path}" is a symbolic link; replace the link itself instead`,
        );
      }
      if (existing && !existing.isFile) {
        throw new HostError(
          "not_a_file",
          `"${input.path}" is not a regular file`,
        );
      }
      if (input.mode === "create" && existing) {
        throw new HostError("conflict", `"${input.path}" already exists`);
      }

      const expected: WriteExpectation | undefined =
        input.expectedSizeBytes === undefined &&
          input.expectedMtimeMs === undefined
          ? undefined
          : {
            ...(input.expectedSizeBytes === undefined
              ? {}
              : { sizeBytes: input.expectedSizeBytes }),
            ...(input.expectedMtimeMs === undefined
              ? {}
              : { mtimeMs: input.expectedMtimeMs }),
          };

      if (input.mode === "append" && existing) {
        appendTarget = await openTarget(root, input.path, {
          requireFile: true,
          append: true,
        });
        const file = appendTarget.file!;
        const current = await file.stat();
        const unchanged = current.size === existing.size &&
          (existing.ino === null || current.ino === null ||
            current.ino === existing.ino) &&
          (current.mtime?.getTime() ?? null) ===
            (existing.mtime?.getTime() ?? null);
        if (!unchanged) {
          throw new HostError(
            "conflict",
            `"${input.path}" changed while it was being appended`,
          );
        }
      } else {
        tempPath =
          `${directory.listingPath}/.agentzoo-write-${crypto.randomUUID()}`;
        temp = await Deno.open(tempPath, {
          createNew: true,
          write: true,
          mode: 0o666,
        });
      }

      const id = crypto.randomUUID();
      const timer = this.#armTimer(id);
      const session: Session = {
        id,
        agent: agent ?? "",
        path: input.path,
        name,
        mode: input.mode,
        directory,
        existing,
        permission: input.permission,
        expected,
        sizeBytes: input.sizeBytes,
        append: appendTarget,
        temp,
        tempPath,
        release,
        received: 0,
        timer,
      };
      this.#sessions.set(id, session);
      this.logger.debug("uploads", "start", {
        upload: id,
        agent: agent ?? null,
        mode: input.mode,
        path: input.path,
        sizeBytes: input.sizeBytes ?? null,
      });
      return { result: { upload: id, chunkSize: UPLOAD_CHUNK_BYTES } };
    } catch (error) {
      release();
      appendTarget?.close();
      try {
        temp?.close();
      } catch {
        // already closed
      }
      if (tempPath !== undefined) {
        await Deno.remove(tempPath).catch(() => undefined);
      }
      directory.close();
      throw error;
    }
  }

  async chunk(
    agent: string | undefined,
    params: unknown,
    payload: Uint8Array | undefined,
  ): Promise<{ result: Record<string, unknown> }> {
    const input = parse(UploadParams, params);
    const session = this.#session(agent, input.upload);
    if (payload === undefined) {
      throw new HostError(
        "invalid_request",
        "fs.writeChunk requires a payload",
      );
    }
    if (payload.length > UPLOAD_CHUNK_BYTES) {
      await this.#abort(session);
      throw new HostError("too_large", "chunk exceeds the chunk size limit");
    }
    const limit = session.sizeBytes ?? MAX_UPLOAD_BYTES;
    if (session.received + payload.length > limit) {
      await this.#abort(session);
      throw new HostError("too_large", "upload exceeds the declared size");
    }
    const file = session.append?.file ?? session.temp!;
    try {
      await writeAll(file, payload);
    } catch (error) {
      await this.#abort(session);
      throw error;
    }
    session.received += payload.length;
    clearTimeout(session.timer);
    session.timer = this.#armTimer(session.id);
    return { result: { received: session.received } };
  }

  async commit(
    agent: string | undefined,
    params: unknown,
  ): Promise<{ result: Record<string, unknown> }> {
    const input = parse(UploadParams, params);
    const session = this.#session(agent, input.upload);
    this.#sessions.delete(session.id);
    clearTimeout(session.timer);
    try {
      if (session.append) {
        const file = session.append.file!;
        await file.sync();
        const final = await file.stat();
        session.append.close();
        this.logger.info("uploads", "commit", {
          upload: session.id,
          mode: "append",
          path: session.path,
          sizeBytes: final.size,
        });
        return {
          result: {
            path: session.path,
            mode: session.mode,
            created: false,
            sizeBytes: final.size,
          },
        };
      }

      const file = session.temp!;
      const tempPath = session.tempPath!;
      const targetPath = `${session.directory.listingPath}/${session.name}`;
      try {
        if (session.mode === "overwrite" && session.expected !== undefined) {
          let current: Deno.FileInfo | undefined;
          try {
            current = await Deno.lstat(targetPath);
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
          if (changedSince(current, session.expected)) {
            throw new HostError(
              "conflict",
              `"${session.path}" changed after it was read`,
            );
          }
        }
        await file.sync();
        const info = await file.stat();
        const permissionPath = await descriptorPathFor(tempPath, info);
        if (session.permission !== undefined) {
          await Deno.chmod(permissionPath, session.permission & 0o7777);
        } else if (session.existing?.mode !== null && session.existing) {
          await Deno.chmod(permissionPath, session.existing.mode! & 0o7777);
        }
        if (
          Deno.build.os === "linux" && session.existing?.uid !== null &&
          session.existing?.uid !== undefined && session.existing.gid !== null
        ) {
          await Deno.chown(
            permissionPath,
            session.existing.uid,
            session.existing.gid,
          ).catch(() => undefined);
        }
      } finally {
        file.close();
      }

      try {
        if (session.mode === "create" || session.existing === undefined) {
          try {
            await Deno.link(tempPath, targetPath);
          } catch (error) {
            if (error instanceof Deno.errors.AlreadyExists) {
              throw new HostError(
                "conflict",
                `"${session.path}" already exists`,
              );
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

      this.logger.info("uploads", "commit", {
        upload: session.id,
        mode: session.mode,
        path: session.path,
        sizeBytes: session.received,
      });
      return {
        result: {
          path: session.path,
          mode: session.mode,
          created: session.existing === undefined,
          sizeBytes: session.received,
        },
      };
    } catch (error) {
      await this.#cleanup(session);
      throw error;
    } finally {
      session.release();
      session.directory.close();
    }
  }

  abort(agent: string | undefined, params: unknown): {
    result: Record<string, unknown>;
  } {
    const input = parse(UploadParams, params);
    const session = this.#session(agent, input.upload);
    this.#sessions.delete(session.id);
    this.logger.info("uploads", "abort", {
      upload: session.id,
      path: session.path,
    });
    void this.#cleanup(session, true);
    return { result: { upload: session.id, aborted: true } };
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map((session) => this.#cleanup(session, true)));
  }

  #session(agent: string | undefined, id: string): Session {
    const session = this.#sessions.get(id);
    if (!session || session.agent !== (agent ?? "")) {
      throw new HostError("invalid_request", `unknown upload "${id}"`);
    }
    return session;
  }

  #armTimer(id: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const session = this.#sessions.get(id);
      if (!session) return;
      this.#sessions.delete(id);
      this.logger.warn("uploads", "expired", {
        upload: id,
        path: session.path,
      });
      void this.#cleanup(session, true);
    }, UPLOAD_IDLE_MS);
  }

  async #abort(session: Session): Promise<void> {
    this.#sessions.delete(session.id);
    await this.#cleanup(session, true);
  }

  async #cleanup(session: Session, closeDirectory = false): Promise<void> {
    clearTimeout(session.timer);
    session.release();
    try {
      session.append?.close();
    } catch {
      // already closed
    }
    try {
      session.temp?.close();
    } catch {
      // already closed
    }
    if (session.tempPath !== undefined) {
      await Deno.remove(session.tempPath).catch(() => undefined);
    }
    if (closeDirectory) session.directory.close();
  }
}
