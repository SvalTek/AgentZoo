// Log-update implementation for efficient terminal updates
// Based on sindresorhus/log-update

import { writeAll } from "./write-all.ts";

const ESC = "\x1b[";

export const ansiEscapes = {
  cursorUp: (count: number) => (count > 0 ? `${ESC}${count}A` : ""),
  cursorDown: (count: number) => (count > 0 ? `${ESC}${count}B` : ""),
  cursorLeft: `${ESC}G`,
  cursorTo: (x: number, y?: number) =>
    y !== undefined ? `${ESC}${y + 1};${x + 1}H` : `${ESC}${x + 1}G`,
  eraseLine: `${ESC}2K`,
  eraseEndLine: `${ESC}K`,
  eraseDown: `${ESC}J`,
  eraseLines: (count: number) => {
    if (count === 0) return "";
    let sequence = "";
    for (let i = 0; i < count; i++) {
      sequence += `${ESC}2K`; // Erase line
      if (i < count - 1) {
        sequence += `${ESC}1A`; // Move up
      }
    }
    sequence += `${ESC}G`; // Move to start
    return sequence;
  },
  cursorHide: `${ESC}?25l`,
  cursorShow: `${ESC}?25h`,
  cursorSavePosition: `${ESC}s`,
  cursorRestorePosition: `${ESC}u`,
  scrollUp: `${ESC}S`,
  scrollDown: `${ESC}T`,
  clearScreen: `${ESC}2J${ESC}H`,
};

interface LogUpdateOptions {
  showCursor?: boolean;
}

/**
 * Creates a log-update instance for efficient terminal rendering
 */
export function createLogUpdate(options: LogUpdateOptions = {}) {
  const { showCursor = false } = options;

  let previousOutput = "";
  let previousLines: string[] = [];
  let previousWidth = 0;
  let previousHeight = 0;

  function getTerminalSize(): { width: number; height: number } {
    try {
      const size = Deno.consoleSize();
      return { width: size.columns, height: size.rows };
    } catch {
      return { width: 80, height: 24 };
    }
  }

  function writeSync(data: string): void {
    const encoder = new TextEncoder();
    writeAll(Deno.stdout, encoder.encode(data));
  }

  /**
   * Diff two frames to find changed region
   */
  function diffFrames(
    prev: string[],
    next: string[]
  ): { start: number; endPrev: number; endNext: number } {
    // Find common prefix
    let start = 0;
    while (
      start < prev.length &&
      start < next.length &&
      prev[start] === next[start]
    ) {
      start++;
    }

    // Find common suffix
    let endPrev = prev.length - 1;
    let endNext = next.length - 1;
    while (
      endPrev >= start &&
      endNext >= start &&
      prev[endPrev] === next[endNext]
    ) {
      endPrev--;
      endNext--;
    }

    return { start, endPrev, endNext };
  }

  /**
   * Render output to terminal
   */
  function render(output: string): void {
    const { width, height } = getTerminalSize();
    const lines = output.split("\n");

    // No-op if nothing changed
    if (output === previousOutput && width === previousWidth) {
      return;
    }

    // Hide cursor during render
    if (!showCursor) {
      writeSync(ansiEscapes.cursorHide);
    }

    // First render or width changed - full redraw
    if (previousLines.length === 0 || width !== previousWidth) {
      if (previousLines.length > 0) {
        // Clear previous output
        writeSync(ansiEscapes.cursorUp(previousLines.length));
        writeSync(ansiEscapes.cursorLeft);
        writeSync(ansiEscapes.eraseDown);
      }

      writeSync(output);
      if (output) writeSync("\n");
    } else {
      // Incremental update using diff
      const diff = diffFrames(previousLines, lines);

      if (diff.start < previousLines.length) {
        // Move to first changed line
        const moveUp = previousLines.length - diff.start;
        if (moveUp > 0) {
          writeSync(ansiEscapes.cursorUp(moveUp));
        }
        writeSync(ansiEscapes.cursorLeft);
      }

      // Erase from changed position down
      writeSync(ansiEscapes.eraseDown);

      // Write changed lines
      const changedLines = lines.slice(diff.start);
      if (changedLines.length > 0) {
        writeSync(changedLines.join("\n"));
        writeSync("\n");
      }
    }

    // Show cursor
    if (!showCursor) {
      writeSync(ansiEscapes.cursorShow);
    }

    previousOutput = output;
    previousLines = lines;
    previousWidth = width;
    previousHeight = height;
  }

  /**
   * Clear all output
   */
  function clear(): void {
    if (previousLines.length > 0) {
      writeSync(ansiEscapes.cursorUp(previousLines.length));
      writeSync(ansiEscapes.cursorLeft);
      writeSync(ansiEscapes.eraseDown);
    }
    previousOutput = "";
    previousLines = [];
  }

  /**
   * Persist output and reset state
   */
  function done(): void {
    previousOutput = "";
    previousLines = [];
    previousWidth = 0;
    previousHeight = 0;
  }

  return {
    render,
    clear,
    done,
    get height() {
      return previousLines.length;
    },
  };
}
