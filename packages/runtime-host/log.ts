/**
 * Application logger for the resident service.
 *
 * This is the application-level record, written to a bind-mounted JSONL file
 * that AgentZoo exposes to its users. It is deliberately separate from the
 * container's stdout/stderr, which belongs to Docker and infrastructure
 * diagnostics.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  readonly path: string;
  readonly level?: LogLevel;
  /** Truncate first; supervisor restarts pass false so crash history remains. */
  readonly fresh?: boolean;
}

/** The surface server/uploads use; tests can pass a silent implementation. */
export interface LogSink {
  debug(source: string, message: string, details?: unknown): void;
  info(source: string, message: string, details?: unknown): void;
  warn(source: string, message: string, details?: unknown): void;
  error(source: string, message: string, details?: unknown): void;
}

export const silentLogger: LogSink = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export class Logger {
  readonly #path: string;
  readonly #threshold: number;
  readonly #encoder = new TextEncoder();
  #file: Deno.FsFile | undefined;
  #failed = false;

  constructor(options: LoggerOptions) {
    this.#path = options.path;
    this.#threshold = LEVELS[options.level ?? "info"] ?? LEVELS.info;
    try {
      // Fresh application log per service start.
      this.#file = options.fresh === false
        ? Deno.openSync(this.#path, {
          write: true,
          create: true,
          append: true,
        })
        : Deno.openSync(this.#path, {
          write: true,
          create: true,
          truncate: true,
        });
    } catch (error) {
      this.#failed = true;
      // Application logging is unavailable; say so on the infrastructure
      // channel rather than silently dropping records.
      console.error(
        `runtime-host: could not open application log ${this.#path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  log(
    source: string,
    level: LogLevel,
    message: string,
    details?: unknown,
  ): void {
    if (LEVELS[level] < this.#threshold || this.#failed) return;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      source,
      message,
    };
    if (details instanceof Error) {
      record.error = {
        name: details.name,
        message: details.message,
        stack: details.stack,
      };
    } else if (details !== undefined) {
      record.details = details;
    }
    try {
      this.#file!.writeSync(
        this.#encoder.encode(`${JSON.stringify(record)}\n`),
      );
    } catch (error) {
      this.#failed = true;
      console.error(
        `runtime-host: application log write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  debug(source: string, message: string, details?: unknown): void {
    this.log(source, "debug", message, details);
  }

  info(source: string, message: string, details?: unknown): void {
    this.log(source, "info", message, details);
  }

  warn(source: string, message: string, details?: unknown): void {
    this.log(source, "warn", message, details);
  }

  error(source: string, message: string, details?: unknown): void {
    this.log(source, "error", message, details);
  }

  close(): void {
    try {
      this.#file?.close();
    } catch {
      // already closed
    }
    this.#file = undefined;
  }
}
