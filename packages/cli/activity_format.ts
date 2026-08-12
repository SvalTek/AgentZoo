/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ZooActivityEvent } from "@agent-zoo/core";

export interface ActivityDisplay {
  readonly headline: string;
  readonly details: readonly string[];
}

/** Turn structured runner telemetry into short, useful terminal log entries. */
export function formatActivity(
  event: ZooActivityEvent,
  width = 100,
): ActivityDisplay {
  const available = Math.max(20, width - 4);
  let details: string[];
  try {
    details = eventDetails(event)
      .flatMap((line) => wrapLine(line, available))
      .slice(0, 6);
  } catch (error) {
    details = labelledLines("activity detail", formatError(error));
  }
  const headline = typeof event.message === "string" && event.message
    ? event.message
    : typeof event.kind === "string"
    ? event.kind
    : "Activity";
  return { headline, details };
}

function eventDetails(event: ZooActivityEvent): string[] {
  if (event.kind === "agent:wake") {
    const prompt = objectString(event.detail, "prompt");
    const systemContext = objectString(event.detail, "initialSystemContext");
    const role = objectString(event.detail, "role");
    return [
      ...(systemContext ? compactLabelledLines("system", systemContext) : []),
      ...(prompt
        ? labelledLines(role === "system" ? "system" : "input", prompt)
        : []),
    ];
  }
  if (event.kind === "agent:tool:start") {
    const args = asRecord(event.detail);
    if (event.toolName === "apply_patch" && typeof args?.patch === "string") {
      const cwd = typeof args.cwd === "string" ? ` (${args.cwd})` : "";
      return labelledLines(`patch${cwd}`, args.patch);
    }
    const shellCommand = typeof args?.command === "string"
      ? args.command
      : typeof args?.script === "string"
      ? args.script
      : undefined;
    if (event.toolName === "shell" && shellCommand !== undefined) {
      const cwd = typeof args?.cwd === "string" ? ` (${args.cwd})` : "";
      return labelledLines(`command${cwd}`, `$ ${shellCommand}`);
    }
    if (
      typeof args?.path === "string" &&
      ["read_file", "write_file", "edit_file", "list_directory", "search_files"]
        .includes(event.toolName ?? "")
    ) {
      return labelledLines("path", args.path);
    }
    if (event.toolName === "http_request" && typeof args?.url === "string") {
      return labelledLines(
        "request",
        `${String(args.method ?? "GET").toUpperCase()} ${args.url}`,
      );
    }
    return labelledLines("input", serialize(event.detail));
  }
  if (event.kind === "agent:tool:end") {
    const envelope = asRecord(event.detail);
    if (envelope?.status === "error") {
      return labelledLines("error", serialize(envelope.error));
    }
    const result = parseResult(envelope?.result ?? event.detail);
    if (event.toolName === "shell" && result) {
      const exit = result.exitCode === undefined
        ? ""
        : ` exit=${result.exitCode}`;
      const flags = `${result.timedOut ? " timed-out" : ""}${
        result.aborted ? " aborted" : ""
      }`;
      const stdout = typeof result.stdout === "string" ? result.stdout : "";
      const stderr = typeof result.stderr === "string" ? result.stderr : "";
      const output = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean)
        .join("\n") || "(no output)";
      const message = typeof result.message === "string" ? result.message : "";
      return [
        ...labelledLines(`output${exit}${flags}`, output),
        ...(message ? labelledLines("message", message) : []),
      ];
    }
    if (result && event.toolName === "read_file") {
      return labelledLines(
        "result",
        `${String(result.bytesRead ?? 0)} bytes${
          result.truncated ? ", truncated" : ""
        }`,
      );
    }
    if (result && event.toolName === "write_file") {
      return labelledLines(
        "result",
        `${String(result.bytesWritten ?? 0)} bytes written`,
      );
    }
    if (result && event.toolName === "edit_file") {
      return labelledLines(
        "result",
        `replaced ${String(result.replacements ?? 0)} occurrence(s)`,
      );
    }
    if (result && event.toolName === "apply_patch") {
      return labelledLines(
        "result",
        `${String(result.filesChanged ?? 0)} files changed`,
      );
    }
    if (result && event.toolName === "list_directory") {
      const entries = Array.isArray(result.entries) ? result.entries.length : 0;
      return labelledLines("result", `${entries} entries`);
    }
    if (result && event.toolName === "search_files") {
      const matches = Array.isArray(result.results) ? result.results.length : 0;
      return labelledLines(
        "result",
        `${matches} matches${result.truncated ? ", truncated" : ""}`,
      );
    }
    if (result && event.toolName === "http_request") {
      return labelledLines(
        "result",
        `HTTP ${String(result.status ?? "")}, ${
          String(result.bodyBytes ?? 0)
        } bytes${result.truncated ? ", truncated" : ""}`,
      );
    }
    return labelledLines("output", serialize(event.detail));
  }
  if (event.kind === "agent:tool:error") {
    return labelledLines("error", serialize(event.detail));
  }
  if (event.kind === "agent:model:request") {
    const request = asRecord(asRecord(event.detail)?.request);
    const prompt = Array.isArray(request?.prompt)
      ? request.prompt.at(-1)
      : request;
    return labelledLines("model input", serialize(prompt));
  }
  if (event.kind === "agent:model:response") {
    const response = asRecord(asRecord(event.detail)?.response);
    const content = Array.isArray(response?.content) ? response.content : [];
    const lines = content.flatMap((part) => modelContentLines(part));
    return lines.length
      ? lines
      : labelledLines("model output", serialize(response));
  }
  if (event.kind === "agent:model:error") {
    const detail = asRecord(event.detail);
    const error = detail && ("error" in detail || detail.kind === "error")
      ? detail.error
      : event.detail;
    return labelledLines("model error", formatError(error));
  }
  if (event.kind === "agent:response") {
    const output = objectString(event.detail, "output") ??
      serialize(event.detail);
    return labelledLines("output", output);
  }
  if (event.kind === "agent:error") {
    return labelledLines("error", serialize(event.detail));
  }
  return [];
}

function compactLabelledLines(label: string, value: unknown): string[] {
  return labelledLines(label, value).filter((line) => line.trim().length > 0);
}

function labelledLines(label: string, value: unknown): string[] {
  const normalized = text(value).replace(/\r/g, "").trimEnd();
  if (!normalized) return [`${label}: (empty)`];
  const [first, ...rest] = normalized.split("\n");
  return [`${label}: ${first}`, ...rest.map((line) => `  ${line}`)];
}

function parseResult(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return asRecord(value);
}

function objectString(value: unknown, key: string): string | undefined {
  const property = asRecord(value)?.[key];
  return typeof property === "string" ? property : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function modelContentLines(value: unknown): string[] {
  const part = asRecord(value);
  if (!part) return labelledLines("model output", serialize(value));
  if (part.type === "text" && typeof part.text === "string") {
    return labelledLines("model", part.text);
  }
  if (part.type === "reasoning" && typeof part.text === "string") {
    return labelledLines("reasoning", part.text);
  }
  if (part.type === "tool-call") {
    return labelledLines(
      `tool request ${String(part.toolName ?? "")}`.trim(),
      serialize(part.input),
    );
  }
  return labelledLines("model output", serialize(part));
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return formatError(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? text(value) : serialized;
  } catch {
    return text(value);
  }
}

function formatError(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  const error = asRecord(value);
  if (error) {
    if (typeof error.stack === "string" && error.stack) return error.stack;
    const name = typeof error.name === "string" ? error.name : undefined;
    const message = typeof error.message === "string"
      ? error.message
      : undefined;
    if (name && message) return `${name}: ${message}`;
    if (message) return message;
    if (name) return name;
  }
  return value === undefined ? "Details unavailable." : serialize(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "(unavailable)";
  if (value === null) return "null";
  try {
    return String(value);
  } catch {
    return "(unprintable)";
  }
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const lines: string[] = [];
  for (let offset = 0; offset < line.length; offset += width) {
    lines.push(line.slice(offset, offset + width));
  }
  return lines;
}
