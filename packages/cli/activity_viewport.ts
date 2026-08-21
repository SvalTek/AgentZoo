/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import stringWidth from "npm:string-width@7.2.0";
import type {
  ActivityDisplay,
  ToolActivityDisplay,
} from "./activity_format.ts";
import { wrappedLineCount, wrappedLines } from "./deno_ink.ts";

/** A bounded section of an activity event that can safely be mounted in a viewport. */
export interface ActivityViewportFragment {
  readonly key: string;
  readonly sourceKey: string;
  readonly display: ActivityDisplay;
  readonly headline: string;
  readonly body: readonly string[];
  readonly continuation: "none" | "before" | "after" | "both";
  readonly rows: number;
}

export function activityDisplayKey(display: ActivityDisplay): string {
  return `${display.type}:${display.key}`;
}

/**
 * Creates fragments whose measured rows never exceed the viewport. Ink has no
 * descendant clipping, so an oversized event must be represented as explicit
 * continuation fragments rather than rendered whole inside a fixed Box.
 */
export function buildActivityFragments(
  displays: readonly ActivityDisplay[],
  detailWidth: number,
  viewportHeight: number,
  expanded: ReadonlySet<string>,
): readonly ActivityViewportFragment[] {
  const height = Math.max(4, viewportHeight);
  return displays.flatMap((display) =>
    display.type === "tool"
      ? toolFragments(display, detailWidth, height, expanded.has(display.key))
      : messageFragments(display, detailWidth, height)
  );
}

/** Select one contiguous, mountable window beginning at its scroll position. */
export function selectViewportWindow(
  fragments: readonly ActivityViewportFragment[],
  height: number,
  startIndex: number,
): readonly ActivityViewportFragment[] {
  if (!fragments.length || height < 1) return [];
  const selected: ActivityViewportFragment[] = [];
  let used = 0;
  for (
    let index = Math.max(0, startIndex);
    index < fragments.length;
    index++
  ) {
    const fragment = fragments[index];
    if (selected.length && used + fragment.rows > height) break;
    selected.push(fragment);
    used += fragment.rows;
  }
  return selected;
}

/** The first fragment in the live tail window for the supplied height. */
export function tailViewportStart(
  fragments: readonly ActivityViewportFragment[],
  height: number,
): number {
  let used = 0;
  let start = fragments.length;
  for (let index = fragments.length - 1; index >= 0; index--) {
    const fragment = fragments[index];
    if (start < fragments.length && used + fragment.rows > height) break;
    used += fragment.rows;
    start = index;
  }
  return start === fragments.length ? 0 : start;
}

export function toolCardWidth(
  lines: readonly string[],
  detailWidth: number,
): number {
  const widest = lines.reduce(
    (width, line) => Math.max(width, stringWidth(line)),
    0,
  );
  return Math.min(Math.max(30, detailWidth), Math.max(48, widest + 4));
}

export function toolStatus(display: ToolActivityDisplay): string {
  if (display.status === "running") return "◌ running…";
  const exit = display.details.find((line) => line.startsWith("result: exit="));
  if (exit) {
    return `${display.status === "success" ? "✓" : "✕"} ${
      exit.slice("result: ".length).replace("=", " ")
    }`;
  }
  return display.status === "success" ? "✓ complete" : "✕ failed";
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function messageFragments(
  display: Exclude<ActivityDisplay, ToolActivityDisplay>,
  detailWidth: number,
  viewportHeight: number,
): readonly ActivityViewportFragment[] {
  return fragmentBody(
    display,
    detailWidth,
    viewportHeight,
    display.details.flatMap((line) => wrappedLines(`  ${line}`, detailWidth)),
    0,
  );
}

function toolFragments(
  display: ToolActivityDisplay,
  detailWidth: number,
  viewportHeight: number,
  expanded: boolean,
): readonly ActivityViewportFragment[] {
  const source = expanded ? display.details : display.compact;
  const width = toolCardWidth(source, detailWidth);
  return fragmentBody(
    display,
    detailWidth,
    viewportHeight,
    [toolStatus(display), ...source].flatMap((line) =>
      wrappedLines(line, Math.max(1, width - 4))
    ),
    2,
  );
}

function fragmentBody(
  display: ActivityDisplay,
  detailWidth: number,
  viewportHeight: number,
  body: readonly string[],
  fixedRows: number,
): readonly ActivityViewportFragment[] {
  const sourceKey = activityDisplayKey(display);
  const initialHeaderRows = wrappedLineCount(
    `${formatTime(display.at)} ${display.headline}`,
    detailWidth,
  );
  const continuationHeaderRows = wrappedLineCount(
    `${formatTime(display.at)} ${display.headline} (continued)`,
    detailWidth,
  );
  // Later fragments gain the continuation suffix; reserve for the longer
  // heading up front so that they cannot overflow the same viewport.
  const headerRows = Math.max(2, initialHeaderRows, continuationHeaderRows);
  const capacity = Math.max(1, viewportHeight - headerRows - fixedRows);
  const chunks = chunk(body.length ? body : [""], capacity);
  return chunks.map((body, index) => {
    const before = index > 0;
    const after = index < chunks.length - 1;
    const continuation = before && after
      ? "both"
      : before
      ? "before"
      : after
      ? "after"
      : "none";
    const headline = before
      ? `${display.headline} (continued)`
      : display.headline;
    return {
      key: `${sourceKey}:${index}`,
      sourceKey,
      display,
      headline,
      body,
      continuation,
      rows: Math.max(
        2,
        wrappedLineCount(`${formatTime(display.at)} ${headline}`, detailWidth) +
          fixedRows + body.length,
      ),
    };
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push([...items.slice(index, index + size)]);
  }
  return chunks.length ? chunks : [[]];
}
