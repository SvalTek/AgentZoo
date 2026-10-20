import stringWidth from "npm:string-width@7.2.0";
import sliceAnsi from "npm:slice-ansi@7.1.0";
import wrapAnsi from "npm:wrap-ansi@9.0.0";

// Strip ANSI codes for width calculation
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Line-based output buffer that preserves ANSI codes intact.
 * Instead of storing individual cells, we store complete styled strings per line.
 */
export class Output {
  private width: number;
  private height: number;
  private lines: string[];

  constructor(options: { width: number; height: number }) {
    this.width = options.width;
    this.height = options.height;
    this.lines = Array(options.height).fill("");
  }

  /**
   * Write styled text at position (x, y).
   * ANSI codes are preserved intact within the text.
   */
  write(x: number, y: number, text: string): void {
    if (y < 0 || y >= this.height) return;

    const textLines = text.split("\n");

    for (let i = 0; i < textLines.length && y + i < this.height; i++) {
      const lineY = y + i;
      const lineText = textLines[i];

      if (!lineText) continue;

      this.lines[lineY] = this.insertTextAtPosition(
        this.lines[lineY] || "",
        x,
        lineText
      );
    }
  }

  /**
   * Insert styled text at a specific visual column position.
   * Preserves ANSI codes from both existing line and new text.
   */
  private insertTextAtPosition(line: string, x: number, text: string): string {
    const lineVisibleWidth = stringWidth(stripAnsi(line));
    const textVisibleWidth = stringWidth(stripAnsi(text));

    if (x >= lineVisibleWidth) {
      // Append with padding
      const padding = " ".repeat(x - lineVisibleWidth);
      return line + padding + text;
    }

    // Split at visual position x, preserving ANSI codes
    const before = sliceAnsi(line, 0, x);

    // Check if we need content after the inserted text
    const afterStart = x + textVisibleWidth;
    const after = afterStart < lineVisibleWidth
      ? sliceAnsi(line, afterStart)
      : "";

    return before + text + after;
  }

  /**
   * Get final output as string with lines joined.
   * @param maxHeight Optional maximum height - if specified, output will include this many lines
   *                  (preserving height for layout purposes), but won't exceed content
   */
  get(maxHeight?: number): string {
    // Find last non-empty line
    let lastNonEmpty = -1;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (this.lines[i] && stripAnsi(this.lines[i]).trim()) {
        lastNonEmpty = i;
        break;
      }
    }

    if (lastNonEmpty < 0) return "";

    // Determine the effective end line
    // If maxHeight is specified, use it (handles both preserving height and clipping):
    // - If content < maxHeight: we preserve height by including empty lines
    // - If content > maxHeight: we clip to maxHeight
    // Without maxHeight, include all content up to the last non-empty line
    let endLine = lastNonEmpty + 1;
    if (maxHeight !== undefined && maxHeight > 0) {
      // Use maxHeight directly, just cap at buffer size
      endLine = Math.min(maxHeight, this.lines.length);
    }

    return this.lines
      .slice(0, endLine)
      .map((line) => line.trimEnd())
      .join("\n");
  }

  getHeight(): number {
    let lastNonEmpty = 0;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i] && stripAnsi(this.lines[i]).trim()) {
        lastNonEmpty = i + 1;
      }
    }
    return lastNonEmpty;
  }
}

// Wrap text to fit within a given width using word-aware wrapping
export function wrapText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return text;

  // Use wrap-ansi for word-aware wrapping that preserves ANSI codes
  return wrapAnsi(text, maxWidth, { hard: true, trim: false });
}

// Truncate text to fit within a given width
export function truncateText(
  text: string,
  maxWidth: number,
  position: "end" | "middle" | "start" = "end"
): string {
  const visibleWidth = stringWidth(stripAnsi(text));

  if (visibleWidth <= maxWidth) return text;

  const ellipsis = "…";
  const availableWidth = maxWidth - 1;

  if (availableWidth <= 0) return ellipsis;

  if (position === "end") {
    return sliceAnsi(text, 0, availableWidth) + ellipsis;
  } else if (position === "start") {
    return ellipsis + sliceAnsi(text, visibleWidth - availableWidth);
  } else {
    // middle
    const halfWidth = Math.floor(availableWidth / 2);
    const start = sliceAnsi(text, 0, halfWidth);
    const end = sliceAnsi(text, visibleWidth - (availableWidth - halfWidth));
    return start + ellipsis + end;
  }
}
