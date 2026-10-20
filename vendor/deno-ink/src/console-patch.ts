/**
 * Console patching utility.
 * Intercepts console.log, console.warn, console.error during rendering
 * to prevent output from mixing with Ink's rendering.
 */

export interface PatchedConsole {
  /** Original console.log */
  log: typeof console.log;
  /** Original console.warn */
  warn: typeof console.warn;
  /** Original console.error */
  error: typeof console.error;
  /** Restore original console methods and flush buffered output */
  restore: () => void;
  /** Flush buffered output without restoring */
  flush: () => void;
}

interface BufferedMessage {
  type: "log" | "warn" | "error";
  args: unknown[];
}

/**
 * Patch console methods to buffer output during rendering.
 *
 * @param write Function to write stdout output
 * @param writeErr Function to write stderr output
 * @returns PatchedConsole with restore/flush methods
 */
export function patchConsole(
  write: (data: string) => void,
  writeErr: (data: string) => void
): PatchedConsole {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  // Buffer for intercepted output
  const buffer: BufferedMessage[] = [];

  /**
   * Format arguments to string, similar to console output
   */
  function formatArgs(args: unknown[]): string {
    return args.map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }).join(" ");
  }

  /**
   * Flush buffered messages to their respective streams
   */
  function flush(): void {
    for (const { type, args } of buffer) {
      const message = formatArgs(args) + "\n";

      if (type === "error") {
        writeErr(message);
      } else if (type === "warn") {
        // Warnings also go to stderr
        writeErr(message);
      } else {
        write(message);
      }
    }
    buffer.length = 0;
  }

  /**
   * Restore original console methods
   */
  function restore(): void {
    // Flush any remaining buffered output
    flush();

    // Restore original functions
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  // Patch console methods
  console.log = (...args: unknown[]) => {
    buffer.push({ type: "log", args });
  };

  console.warn = (...args: unknown[]) => {
    buffer.push({ type: "warn", args });
  };

  console.error = (...args: unknown[]) => {
    buffer.push({ type: "error", args });
  };

  return {
    log: originalLog,
    warn: originalWarn,
    error: originalError,
    restore,
    flush,
  };
}
