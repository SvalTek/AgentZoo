/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ZooActivityEvent } from "@agent-zoo/core";

export interface MessageActivityDisplay {
  readonly type: "message";
  readonly key: string;
  readonly at: number;
  readonly headline: string;
  readonly details: readonly string[];
}

export interface ToolActivityDisplay {
  readonly type: "tool";
  readonly key: string;
  readonly at: number;
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly headline: string;
  readonly status: "running" | "success" | "error";
  readonly compact: readonly string[];
  readonly details: readonly string[];
}

export type ActivityDisplay = MessageActivityDisplay | ToolActivityDisplay;

/** Project raw runner telemetry into readable messages and correlated tools. */
export function projectActivity(
  events: readonly ZooActivityEvent[],
  width = 100,
): ActivityDisplay[] {
  const available = Math.max(20, width - 6);
  const displays: ActivityDisplay[] = [];
  // A provider tool-call ID is only scoped to the agent/model turn which
  // produced it. Multiple agents can quite legitimately emit `tool-1`; keep
  // their lifecycle cards separate instead of allowing one to replace the
  // other in the dashboard.
  const tools = new Map<string, ToolActivityDisplay>();
  const completedToolCalls = new Set(
    events.flatMap((event) =>
      event.kind === "agent:tool:end"
        ? [toolCorrelationKey(event)].filter((key): key is string =>
          key !== undefined
        )
        : []
    ),
  );
  for (const event of events) {
    if (event.kind === "agent:tool:start") {
      const display = toolStartDisplay(event, available);
      displays.push(display);
      const correlationKey = toolCorrelationKey(event);
      if (correlationKey) tools.set(correlationKey, display);
      continue;
    }
    if (
      event.kind === "agent:tool:error" &&
      completedToolCalls.has(toolCorrelationKey(event) ?? "")
    ) {
      continue;
    }
    if (event.kind === "agent:tool:end" || event.kind === "agent:tool:error") {
      const correlationKey = toolCorrelationKey(event);
      const current = correlationKey ? tools.get(correlationKey) : undefined;
      const display = toolEndDisplay(event, current, available);
      if (current) {
        const index = displays.indexOf(current);
        if (index >= 0) displays[index] = display;
        if (correlationKey) tools.set(correlationKey, display);
      } else {
        displays.push(display);
        if (correlationKey) tools.set(correlationKey, display);
      }
      continue;
    }
    displays.push(...messageDisplays(event, available));
  }
  return displays;
}

/** Compatibility helper for callers that format one event at a time. */
export function formatActivity(
  event: ZooActivityEvent,
  width = 100,
): Pick<ActivityDisplay, "headline" | "details"> {
  return projectActivity([event], width)[0] ?? {
    headline: event.message || event.kind,
    details: [],
  };
}

function messageDisplays(
  event: ZooActivityEvent,
  width: number,
): MessageActivityDisplay[] {
  if (event.kind === "agent:model:request") {
    const displays = providerMessageDisplays(
      event,
      requestMessages(event.detail),
      width,
    );
    if (displays.length || hasProviderPrompt(event.detail)) return displays;
    return [messageDisplay(event, "model input", ["(unavailable)"], width)];
  }
  if (event.kind === "agent:model:response") {
    return providerMessageDisplays(
      event,
      responseMessages(event.detail),
      width,
    );
  }
  if (event.kind === "agent:wake") {
    const detail = asRecord(event.detail);
    const lines = [
      ...labelledLines("system", detail?.initialSystemContext),
      ...labelledLines(
        detail?.role === "system" ? "system" : "input",
        detail?.prompt,
      ),
    ];
    return lines.length
      ? [messageDisplay(event, "environment", lines, width)]
      : [];
  }
  if (event.kind === "agent:response") {
    return [messageDisplay(
      event,
      "response",
      labelledLines("output", asRecord(event.detail)?.output),
      width,
    )];
  }
  if (event.kind === "agent:model:error" || event.kind === "agent:error") {
    const detail = asRecord(event.detail);
    return [messageDisplay(
      event,
      "error",
      labelledLines("error", formatError(detail?.error ?? event.detail)),
      width,
    )];
  }
  if (event.kind === "agent:mcp:unavailable") {
    const detail = asRecord(event.detail);
    return [messageDisplay(
      event,
      "MCP unavailable",
      [
        `Server: ${String(detail?.serverName ?? "unknown")}`,
        String(detail?.message ?? event.message),
        "Continuing with the remaining capabilities.",
      ],
      width,
    )];
  }
  if (event.kind === "agent:yield" || event.kind === "agent:complete") {
    return [messageDisplay(event, event.kind.slice(6), [], width)];
  }
  if (event.kind.startsWith("zoo:")) {
    return [messageDisplay(event, "system", [], width)];
  }
  return [];
}

function providerMessageDisplays(
  event: ZooActivityEvent,
  messages: readonly ProviderMessage[],
  width: number,
): MessageActivityDisplay[] {
  return messages.flatMap((message, messageIndex) =>
    message.parts.map((part, index) =>
      messageDisplay(
        event,
        part.label || message.role,
        labelledLines("", part.text),
        width,
        `${event.sequence}:${messageIndex}:${index}`,
      )
    )
  );
}

function messageDisplay(
  event: ZooActivityEvent,
  role: string,
  lines: readonly string[],
  width: number,
  key = String(event.sequence),
): MessageActivityDisplay {
  return {
    type: "message",
    key,
    at: event.at,
    headline: `${actorLabel(event)} — ${role}`,
    details: wrapLines(lines, width),
  };
}

function toolStartDisplay(
  event: ZooActivityEvent,
  width: number,
): ToolActivityDisplay {
  const toolName = event.toolName ?? "tool";
  const details = wrapLines(toolInputLines(toolName, event.detail), width);
  return {
    type: "tool",
    // Zoo sequences are globally monotonic. Unlike a provider call ID, this
    // is a safe React identity even when several agents use the same ID.
    key: String(event.sequence),
    at: event.at,
    toolCallId: event.toolCallId,
    toolName,
    headline: `${actorLabel(event)} — ${toolName}`,
    status: "running",
    compact: details.slice(0, 1),
    details,
  };
}

function toolEndDisplay(
  event: ZooActivityEvent,
  current: ToolActivityDisplay | undefined,
  width: number,
): ToolActivityDisplay {
  const envelope = asRecord(event.detail);
  const toolName = event.toolName ?? current?.toolName ?? "tool";
  const result = parseResult(envelope?.result ?? event.detail);
  const explicitFailure = event.kind === "agent:tool:error" ||
    envelope?.status === "error";
  const failed = explicitFailure ||
    (toolName === "shell" && typeof result?.exitCode === "number" &&
      result.exitCode !== 0) ||
    result?.status === "error";
  const resultLines = explicitFailure
    ? labelledLines("error", formatError(envelope?.error ?? event.detail))
    : toolResultLines(toolName, result ?? envelope?.result ?? event.detail);
  const details = wrapLines(
    [...(current?.details ?? []), ...resultLines],
    width,
  );
  return {
    type: "tool",
    key: current?.key ?? String(event.sequence),
    at: current?.at ?? event.at,
    toolCallId: event.toolCallId,
    toolName,
    headline: current?.headline ?? `${actorLabel(event)} — ${toolName}`,
    status: failed ? "error" : "success",
    compact: [
      ...(current?.compact ?? []),
      ...wrapLines(resultLines, width).slice(0, 6),
    ],
    details,
  };
}

function toolCorrelationKey(event: ZooActivityEvent): string | undefined {
  return event.toolCallId === undefined
    ? undefined
    : `${event.agentId ?? "(unidentified agent)"}\u0000${event.toolCallId}`;
}

function toolInputLines(toolName: string, value: unknown): string[] {
  const input = asRecord(value);
  if (!input) return labelledLines("input", value);
  if (toolName === "shell" && typeof input.command === "string") {
    return [
      `$ ${input.command}`,
      ...labelledLines("cwd", input.cwd),
      ...labelledLines(
        "timeout",
        input.timeoutMs === undefined ? undefined : `${input.timeoutMs}ms`,
      ),
    ];
  }
  if (toolName === "apply_patch" && typeof input.patch === "string") {
    return [
      ...labelledLines("cwd", input.cwd),
      ...labelledLines("patch", input.patch),
    ];
  }
  if (toolName === "http_request" && typeof input.url === "string") {
    return [
      ...labelledLines(
        "request",
        `${String(input.method ?? "GET").toUpperCase()} ${input.url}`,
      ),
      ...recordLines(input, ["method", "url"]),
    ];
  }
  if (toolName === "terminal_create") {
    const command = typeof input.command === "string"
      ? [input.command, ...(Array.isArray(input.args) ? input.args : [])]
        .join(" ")
      : "interactive Bash shell";
    return [
      ...labelledLines("terminal", input.name),
      ...labelledLines("start", command),
      ...labelledLines("cwd", input.cwd),
      ...labelledLines("history", input.historyLimit),
    ];
  }
  if (toolName === "terminal_read") {
    const range = input.start === undefined && input.end === undefined
      ? "all retained scrollback"
      : `${String(input.start ?? "-")}…${String(input.end ?? "screen")}`;
    return [...labelledLines("terminal", input.name), `range: ${range}`];
  }
  if (toolName === "terminal_send") {
    return [
      ...labelledLines("terminal", input.name),
      ...labelledLines("sent", input.text),
      `enter: ${input.enter === false ? "false" : "true"}`,
    ];
  }
  if (toolName === "terminal_keys") {
    return [
      ...labelledLines("terminal", input.name),
      `keys: ${Array.isArray(input.keys) ? input.keys.join(", ") : "(none)"}`,
    ];
  }
  if (toolName === "terminal_clear" || toolName === "terminal_kill") {
    return [...labelledLines("terminal", input.name)];
  }
  return recordLines(input);
}

function toolResultLines(toolName: string, value: unknown): string[] {
  const result = parseResult(value);
  if (!result) return labelledLines("result", value);
  if (toolName === "shell") {
    const flags = [
      result.exitCode === undefined
        ? undefined
        : `exit=${String(result.exitCode)}`,
      result.timedOut ? "timed out" : undefined,
      result.aborted ? "aborted" : undefined,
    ].filter(Boolean).join(" · ");
    const output = [result.stdout, result.stderr, result.message].some((item) =>
      typeof item === "string" && item.length > 0
    );
    return [
      ...(flags ? labelledLines("result", flags) : []),
      ...labelledLines("stdout", result.stdout),
      ...labelledLines("stderr", result.stderr),
      ...labelledLines("message", result.message),
      ...(output ? [] : ["output: (no output)"]),
    ];
  }
  if (toolName === "read_file") {
    return [
      ...labelledLines("content", result.content),
      ...labelledLines(
        "size",
        result.bytesRead === undefined
          ? undefined
          : `${String(result.bytesRead)} bytes`,
      ),
    ];
  }
  if (toolName === "apply_patch") {
    const changes = Array.isArray(result.changes) ? result.changes : [];
    return [
      ...labelledLines(
        "result",
        `${String(result.filesChanged ?? changes.length)} files changed`,
      ),
      ...changes.flatMap((change) => {
        const item = asRecord(change);
        return labelledLines(
          "file",
          item?.path === undefined
            ? change
            : `${String(item.path)} +${String(item.additions ?? 0)} -${
              String(item.deletions ?? 0)
            }`,
        );
      }),
      ...labelledLines("message", result.message),
    ];
  }
  if (toolName === "list_directory") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    return [
      `result: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
      ...entries.flatMap((entry) => {
        const item = asRecord(entry);
        if (!item) return [];
        const name = typeof item.name === "string" ? item.name : "(unnamed)";
        const type = typeof item.type === "string" ? item.type : "entry";
        const size = typeof item.sizeBytes === "number"
          ? ` (${item.sizeBytes} bytes)`
          : "";
        return [`${type}: ${name}${size}`];
      }),
    ];
  }
  if (toolName === "terminal_create") {
    return [
      `result: ${String(result.status ?? "created")}`,
      ...labelledLines("cwd", result.cwd),
      ...labelledLines(
        "program",
        Array.isArray(result.command) ? result.command.join(" ") : undefined,
      ),
      ...labelledLines("history", result.historyLimit),
      ...labelledLines("error", result.error),
    ];
  }
  if (toolName === "terminal_list") {
    const terminals = Array.isArray(result.terminals) ? result.terminals : [];
    return terminals.length
      ? terminals.map((name) => `terminal: ${String(name)}`)
      : ["terminals: (none)"];
  }
  if (toolName === "terminal_read") {
    return [
      ...labelledLines("screen", result.output),
      ...(result.truncated ? ["screen: truncated"] : []),
      ...labelledLines("result", result.status),
      ...labelledLines("error", result.error),
    ];
  }
  if (
    toolName === "terminal_send" || toolName === "terminal_keys" ||
    toolName === "terminal_clear" || toolName === "terminal_kill"
  ) {
    return [
      ...labelledLines("result", result.status),
      ...labelledLines("error", result.error),
    ];
  }
  return recordLines(result, ["path"]);
}

function recordLines(
  record: Record<string, unknown>,
  omit: readonly string[] = [],
): string[] {
  return Object.entries(record).flatMap(([key, value]) => {
    if (omit.includes(key) || value === undefined || value === "") return [];
    if (typeof value === "string") return labelledLines(key, value);
    if (Array.isArray(value)) return [`${key}: ${value.length} item(s)`];
    if (value !== null && typeof value === "object") {
      return [`${key}: available in the activity log`];
    }
    return [`${key}: ${String(value)}`];
  });
}

interface ProviderMessage {
  readonly role: string;
  readonly parts: readonly { label: string; text: string }[];
}

function requestMessages(value: unknown): ProviderMessage[] {
  const request = asRecord(asRecord(value)?.request);
  const prompt = Array.isArray(request?.prompt) ? request.prompt : [];
  // The model receives earlier assistant messages again when it continues
  // after a tool call. They were already displayed from their corresponding
  // model-response event, so rendering them here makes one reasoning turn
  // appear twice at the tool boundary.
  return prompt.flatMap(providerMessage).filter((message) =>
    message.role !== "assistant" && message.role !== "tool"
  );
}

function hasProviderPrompt(value: unknown): boolean {
  const request = asRecord(asRecord(value)?.request);
  return Array.isArray(request?.prompt);
}

function responseMessages(value: unknown): ProviderMessage[] {
  const response = asRecord(asRecord(value)?.response);
  return response
    ? providerMessage({ role: "model", content: response.content })
    : [];
}

function providerMessage(value: unknown): ProviderMessage[] {
  const message = asRecord(value);
  if (!message) return [];
  const role = typeof message.role === "string" ? message.role : "message";
  const parts = contentParts(message.content);
  return parts.length ? [{ role, parts }] : [];
}

function contentParts(value: unknown): Array<{ label: string; text: string }> {
  if (typeof value === "string") return [{ label: "", text: value }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((value) => {
    const part = asRecord(value);
    if (!part) return [];
    if (part.type === "text" && typeof part.text === "string") {
      return [{ label: "", text: part.text }];
    }
    if (part.type === "reasoning" && typeof part.text === "string") {
      return [{ label: "reasoning", text: part.text }];
    }
    // Tool-call and tool-result parts are rendered by correlated tool cards.
    return [];
  });
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

function actorLabel(event: ZooActivityEvent): string {
  return event.agentName
    ? `${event.agentName}${event.agentId ? ` (${event.agentId})` : ""}`
    : event.agentId ?? "System";
}

function labelledLines(label: string, value: unknown): string[] {
  if (value === undefined || value === "") return [];
  const normalized = String(value).replace(/\r/g, "").trimEnd();
  if (!normalized) return [`${label || "message"}: (empty)`];
  const [first, ...rest] = normalized.split("\n");
  const prefix = label ? `${label}: ` : "";
  return [
    `${prefix}${first}`,
    ...rest.filter((line) => line.length > 0).map((line) => `  ${line}`),
  ];
}

function formatError(value: unknown): string {
  if (value instanceof Error) {
    return value.message ? `${value.name}: ${value.message}` : value.name;
  }
  const error = asRecord(value);
  if (error && typeof error.message === "string") {
    return typeof error.name === "string"
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  return value === undefined || (error && !error.name && !error.message)
    ? "Details unavailable."
    : String(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function wrapLines(lines: readonly string[], width: number): string[] {
  // Terminal components own visual wrapping: preserve semantic lines here.
  void width;
  return [...lines];
}
