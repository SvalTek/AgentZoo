/**
 * Report tool failures from AgentZoo activity logs.
 *
 * One log:
 *   deno task tools:failures
 *   deno task tools:failures --log path/to/log.jsonl
 *
 * Several logs (aggregate by tool and failure reason):
 *   deno task tools:failures --dir logs
 *   deno task tools:failures --log a.jsonl --log b.jsonl
 *
 * `--json` emits the structured summaries instead of the text report. With no
 * arguments, the newest `agent-zoo-*.jsonl` in the current directory is used.
 */

interface ActivityEvent {
  readonly timestamp?: string;
  readonly sequence?: number;
  readonly kind?: string;
  readonly agentId?: string;
  readonly agentName?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly detail?: unknown;
}

interface ToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly args: unknown;
  readonly intent?: string;
}

interface Failure {
  readonly log: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly at: number;
  readonly kind: "tool error" | "result error" | "command exit";
  readonly tried: string;
  readonly failed: string;
  readonly intent?: string;
  nextTool?: string;
  reaction?: string;
}

interface LogSummary {
  readonly log: string;
  readonly events: number;
  readonly agents: Record<string, string>;
  readonly calls: Record<string, number>;
  readonly failures: Failure[];
}

interface Options {
  readonly logs: string[];
  readonly dir?: string;
  readonly asJson: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function usage(): void {
  console.error(
    "Usage: deno task tools:failures [--log <path>]... [--dir <path>] [--json]",
  );
}

function parseArgs(argv: readonly string[]): Options {
  const logs: string[] = [];
  let dir: string | undefined;
  let asJson = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--log") {
      logs.push(argv[++index]);
    } else if (arg.startsWith("--log=")) {
      logs.push(arg.slice("--log=".length));
    } else if (arg === "--dir") {
      dir = argv[++index];
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      Deno.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      Deno.exit(2);
    }
  }
  return { logs: logs.filter((path) => Boolean(path)), dir, asJson };
}

async function logsIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && /^agent-zoo-.*\.jsonl$/.test(entry.name)) {
      names.push(`${dir}/${entry.name}`);
    }
  }
  return names.sort();
}

/** Newest activity log in a directory, by the timestamp in its name. */
async function latestLog(dir = "."): Promise<string> {
  const names = await logsIn(dir);
  const newest = names.at(-1);
  if (!newest) {
    throw new Error(
      `No agent-zoo-*.jsonl log found in ${await Deno.realPath(dir)}`,
    );
  }
  return newest;
}

async function* readEvents(path: string): AsyncGenerator<ActivityEvent> {
  using file = await Deno.open(path, { read: true });
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of file.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parseEvent(line);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parseEvent(buffer.trim());
}

function parseEvent(line: string): ActivityEvent {
  try {
    return JSON.parse(line) as ActivityEvent;
  } catch {
    return { kind: "(unparsed)" };
  }
}

/** Model text (or reasoning, when no text) from a response event. */
function modelText(event: ActivityEvent): string | undefined {
  const response = asRecord(asRecord(event.detail)?.response);
  const content = response?.content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.map(asRecord).filter(Boolean) as Record<
    string,
    unknown
  >[];
  const texts = parts.filter((part) => part.type === "text").map((part) =>
    textValue(part.text)
  ).filter((text): text is string => Boolean(text));
  if (texts.length > 0) return texts.join("\n");
  const reasoning = parts.filter((part) => part.type === "reasoning").map(
    (part) => textValue(part.text),
  ).filter((text): text is string => Boolean(text));
  return reasoning.length > 0 ? reasoning.join("\n") : undefined;
}

function oneLine(value: string, limit = 240): string {
  const flattened = value.replaceAll(/\s+/g, " ").trim();
  return flattened.length > limit
    ? `${flattened.slice(0, limit)}…`
    : flattened;
}

/** A compact, tool-aware summary of call arguments. */
function describeArgs(toolName: string, args: unknown): string {
  const record = asRecord(args) ?? {};
  const path = textValue(record.path);
  switch (toolName) {
    case "apply_patch": {
      const patch = textValue(record.patch) ?? "";
      const headers = patch.split("\n").filter((line) =>
        line.startsWith("--- ") || line.startsWith("+++ ") ||
        line.startsWith("@@")
      );
      return oneLine(headers.slice(0, 3).join(" "), 200) || "(no header)";
    }
    case "shell": {
      const command = textValue(record.command) ?? textValue(record.script) ?? "";
      const [first, ...rest] = command.split("\n");
      return rest.length > 0
        ? `${oneLine(first ?? "", 160)} (+${rest.length} lines)`
        : oneLine(command, 160);
    }
    case "read_resource":
      return `${textValue(record.mcp_name) ?? "?"} ${
        textValue(record.uri) ?? ""
      }`;
    case "list_resources":
    case "list_tools":
      return textValue(record.mcp_name) ?? "?";
    case "read_file":
    case "write_file":
    case "edit_file":
    case "view_image":
    case "list_directory":
    case "search_files":
      return path ?? oneLine(JSON.stringify(record), 160);
    case "skills_load":
      return textValue(record.name) ?? "?";
    case "start_background":
    case "get_background":
    case "stop_background":
    case "send_background":
      return [
        textValue(record.name) ?? "?",
        textValue(record.command) ?? "",
      ].filter(Boolean).join(" · ");
    default:
      return oneLine(JSON.stringify(record), 160);
  }
}

function failureMessage(detail: unknown): string | undefined {
  const record = asRecord(detail);
  const error = asRecord(record?.error);
  return textValue(error?.message) ?? textValue(record?.error) ??
    textValue(record?.message);
}

function resultFor(detail: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(detail)?.result);
}

async function summarizeLog(path: string): Promise<LogSummary> {
  const calls = new Map<string, ToolCall>();
  const failures: Failure[] = [];
  const failedCalls = new Set<string>();
  const agents = new Map<string, string>();
  const lastModelText = new Map<string, string>();
  const callTotals = new Map<string, number>();
  const failureTotals = new Map<string, number>();
  let eventCount = 0;

  for await (const event of readEvents(path)) {
    eventCount++;
    if (event.kind === "agent:tool:start") {
      const toolCallId = event.toolCallId ?? `${event.sequence}`;
      const toolName = event.toolName ?? "tool";
      const agentId = event.agentId ?? "?";
      const agentName = event.agentName ?? agentId;
      agents.set(agentId, agentName);
      calls.set(toolCallId, {
        toolCallId,
        toolName,
        agentId,
        agentName,
        args: event.detail,
        intent: lastModelText.get(agentId),
      });
      callTotals.set(toolName, (callTotals.get(toolName) ?? 0) + 1);
      for (const failure of failures) {
        if (failure.agentId === agentId && !failure.nextTool) {
          failure.nextTool = toolName;
        }
      }
      continue;
    }

    if (event.kind === "agent:model:response") {
      const text = modelText(event);
      if (!text) continue;
      lastModelText.set(event.agentId ?? "?", text);
      for (const failure of failures) {
        if (failure.agentId === (event.agentId ?? "?") && !failure.reaction) {
          failure.reaction = text;
        }
      }
      continue;
    }

    if (event.kind === "agent:tool:error") {
      const toolCallId = event.toolCallId ?? `${event.sequence}`;
      if (failedCalls.has(toolCallId)) continue;
      const call = calls.get(toolCallId);
      const toolName = event.toolName ?? call?.toolName ?? "tool";
      failedCalls.add(toolCallId);
      failures.push({
        log: path,
        toolCallId,
        toolName,
        agentId: event.agentId ?? call?.agentId ?? "?",
        agentName: event.agentName ?? call?.agentName ?? "?",
        at: event.sequence ?? 0,
        kind: "tool error",
        tried: describeArgs(toolName, call?.args),
        failed: failureMessage(event.detail) ?? "unknown error",
        intent: call?.intent,
      });
      failureTotals.set(toolName, (failureTotals.get(toolName) ?? 0) + 1);
      continue;
    }

    if (event.kind === "agent:tool:end") {
      const toolCallId = event.toolCallId ?? `${event.sequence}`;
      if (failedCalls.has(toolCallId)) continue;
      const call = calls.get(toolCallId);
      const toolName = event.toolName ?? call?.toolName ?? "tool";
      const detail = asRecord(event.detail);
      const status = textValue(detail?.status);
      const result = resultFor(event.detail);
      const exitCode = typeof result?.exitCode === "number"
        ? result.exitCode
        : undefined;

      if (status && status !== "success") {
        failedCalls.add(toolCallId);
        failures.push({
          log: path,
          toolCallId,
          toolName,
          agentId: event.agentId ?? call?.agentId ?? "?",
          agentName: event.agentName ?? call?.agentName ?? "?",
          at: event.sequence ?? 0,
          kind: "result error",
          tried: describeArgs(toolName, call?.args),
          failed: failureMessage(event.detail) ?? status,
          intent: call?.intent,
        });
        failureTotals.set(toolName, (failureTotals.get(toolName) ?? 0) + 1);
        continue;
      }

      if (toolName === "shell" && exitCode !== undefined && exitCode !== 0) {
        failedCalls.add(toolCallId);
        const stderr = textValue(result?.stderr) ?? "";
        const firstLines = stderr.split("\n").filter(Boolean).slice(0, 4)
          .join("\n");
        failures.push({
          log: path,
          toolCallId,
          toolName,
          agentId: event.agentId ?? call?.agentId ?? "?",
          agentName: event.agentName ?? call?.agentName ?? "?",
          at: event.sequence ?? 0,
          kind: "command exit",
          tried: describeArgs(toolName, call?.args),
          failed: `exit ${exitCode}${firstLines ? `\n${firstLines}` : ""}`,
          intent: call?.intent,
        });
        failureTotals.set(toolName, (failureTotals.get(toolName) ?? 0) + 1);
      }
    }
  }

  return {
    log: path,
    events: eventCount,
    agents: Object.fromEntries(agents),
    calls: Object.fromEntries(callTotals),
    failures,
  };
}

function printSingle(summary: LogSummary): void {
  const sorted = [...summary.failures].sort((left, right) =>
    left.at - right.at
  );
  console.log(`Log: ${relativePath(summary.log)}`);
  console.log(
    `Events: ${summary.events} · agents: ${
      Object.keys(summary.agents).length
    } · tool calls: ${totalCalls(summary)} · failures: ${sorted.length}`,
  );
  if (sorted.length === 0) return;

  const failureTotals = countByTool(sorted);
  console.log("\nFailures by tool");
  for (const [toolName, count] of sortCounts(failureTotals)) {
    console.log(
      `  ${toolName}: ${count}/${summary.calls[toolName] ?? 0} calls`,
    );
  }

  sorted.forEach((failure, index) => {
    console.log(
      `\n${index + 1}. seq ${failure.at} · ${failure.agentName} (${failure.agentId}) · ${failure.toolName} — ${failure.kind}`,
    );
    console.log(`   tried:   ${failure.tried}`);
    const [firstFailure, ...failureRest] = failure.failed.split("\n");
    console.log(`   failed:  ${firstFailure ?? ""}`);
    for (const line of failureRest) console.log(`            ${line}`);
    if (failure.intent) console.log(`   intent:  ${oneLine(failure.intent)}`);
    if (failure.nextTool) console.log(`   next:    ${failure.nextTool}`);
    if (failure.reaction) {
      console.log(`   reaction: ${oneLine(failure.reaction)}`);
    }
  });
}

function printAggregate(summaries: readonly LogSummary[]): void {
  const calls = new Map<string, number>();
  const failureCounts = new Map<string, number>();
  const logsWithFailures = new Map<string, Set<string>>();
  const byTool = new Map<string, Failure[]>();

  for (const summary of summaries) {
    for (const [toolName, count] of Object.entries(summary.calls)) {
      calls.set(toolName, (calls.get(toolName) ?? 0) + count);
    }
    for (const failure of summary.failures) {
      failureCounts.set(
        failure.toolName,
        (failureCounts.get(failure.toolName) ?? 0) + 1,
      );
      const logs = logsWithFailures.get(failure.toolName) ?? new Set<string>();
      logs.add(summary.log);
      logsWithFailures.set(failure.toolName, logs);
      const list = byTool.get(failure.toolName) ?? [];
      list.push(failure);
      byTool.set(failure.toolName, list);
    }
  }

  const failureTotal = [...failureCounts.values()].reduce(
    (total, count) => total + count,
    0,
  );
  console.log(`Logs: ${summaries.length}`);
  console.log(
    `Events: ${
      summaries.reduce((total, summary) => total + summary.events, 0)
    } · tool calls: ${
      [...calls.values()].reduce((total, count) => total + count, 0)
    } · failures: ${failureTotal}`,
  );
  if (failureTotal === 0) return;

  console.log("\nFailures by tool (failures / calls, logs affected)");
  for (const [toolName, count] of sortCounts(failureCounts)) {
    const toolCalls = calls.get(toolName) ?? 0;
    const percent = toolCalls > 0 ? (count / toolCalls) * 100 : 0;
    console.log(
      `  ${toolName}: ${count}/${toolCalls} (${percent.toFixed(1)}%) in ${
        logsWithFailures.get(toolName)?.size ?? 0
      } ${(logsWithFailures.get(toolName)?.size ?? 0) === 1 ? "log" : "logs"}`,
    );
  }

  for (const [toolName] of sortCounts(failureCounts).slice(0, 12)) {
    const failures = byTool.get(toolName) ?? [];
    const reasons = new Map<string, { count: number; example?: string }>();
    for (const failure of failures) {
      const [first = "", second = ""] = failure.failed.split("\n");
      const key = first.trim() || "(empty)";
      const entry = reasons.get(key) ?? { count: 0 };
      entry.count++;
      entry.example ??= second.trim() || undefined;
      reasons.set(key, entry);
    }
    console.log(`\n${toolName} — ${failures.length} failures`);
    for (const [reason, detail] of sortCounts(
      new Map([...reasons].map(([key, value]) => [key, value.count])),
    ).slice(0, 6)) {
      const entry = reasons.get(reason);
      console.log(
        `  ${detail}× ${oneLine(reason, 120)}${
          entry?.example ? ` · e.g. ${oneLine(entry.example, 100)}` : ""
        }`,
      );
    }

    // Up to three samples, one per distinct reason, to show the attempted call.
    const shown = new Set<string>();
    for (const failure of failures) {
      const key = (failure.failed.split("\n")[0] ?? "").trim();
      if (shown.has(key)) continue;
      shown.add(key);
      console.log(
        `  sample: ${failure.toolName} seq ${failure.at} · ${failure.agentName} · ${relativePath(failure.log)}`,
      );
      console.log(`    tried:  ${failure.tried}`);
      console.log(`    failed: ${oneLine(failure.failed, 220)}`);
      if (shown.size >= 3) break;
    }
  }
}

function totalCalls(summary: LogSummary): number {
  return Object.values(summary.calls).reduce((total, count) => total + count, 0);
}

function countByTool(failures: readonly Failure[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.toolName, (counts.get(failure.toolName) ?? 0) + 1);
  }
  return counts;
}

function sortCounts<K>(counts: Map<K, number>): Array<[K, number]> {
  return [...counts].sort((left, right) => right[1] - left[1]);
}

function relativePath(path: string): string {
  if (!path) return path;
  const cwd = Deno.cwd();
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);
  const paths = options.dir
    ? await logsIn(options.dir)
    : options.logs.length > 0
    ? options.logs
    : [await latestLog()];
  if (paths.length === 0) throw new Error("No logs matched.");

  const summaries: LogSummary[] = [];
  for (const path of paths) summaries.push(await summarizeLog(path));

  if (options.asJson) {
    console.log(JSON.stringify(
      summaries.length === 1 ? summaries[0] : { logs: summaries },
      null,
      2,
    ));
    return;
  }
  if (summaries.length === 1) {
    printSingle(summaries[0]);
  } else {
    printAggregate(summaries);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
