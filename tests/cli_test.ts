import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { createCli, resolvePopulationMember } from "../cli_command.ts";
import {
  formatActivity,
  projectActivity,
} from "../packages/cli/activity_format.ts";
import { ActivityLog } from "../packages/cli/ActivityLog.ts";
import { formatRunElapsed } from "../packages/cli/components/DashboardHeader.tsx";
import {
  buildActivityFragments,
  selectViewportWindow,
  tailViewportStart,
} from "../packages/cli/activity_viewport.ts";
import type { AgentZoo, ModelRegistry } from "@agent-zoo/core";
import { expandPopulation, parseConfig } from "@agent-zoo/core";

Deno.test("activity ScrollView fragments long messages before mounting them", () => {
  const displays = [{
    type: "message" as const,
    key: "long-message",
    at: Date.parse("2026-08-14T18:00:00Z"),
    headline: "Alice (abc123) — reasoning",
    details: [
      "A deliberately long reasoning line that needs normal word wrapping before it can be placed in a small terminal viewport.",
      "This remains accessible as a continuation instead of escaping below the activity frame.",
    ],
  }];
  const fragments = buildActivityFragments(displays, 30, 6, new Set());
  assert(fragments.length > 1);
  assert(fragments.every((fragment) => fragment.rows <= 6));
  assertEquals(
    fragments.flatMap((fragment) => fragment.body).join(" ").includes(
      "accessible",
    ),
    true,
  );
});

Deno.test("activity ScrollView mounts bounded windows at either end of history", () => {
  const displays = Array.from({ length: 5 }, (_, index) => ({
    type: "message" as const,
    key: String(index),
    at: Date.parse("2026-08-14T18:00:00Z") + index,
    headline: `Alice — message ${index}`,
    details: [`Message ${index}`],
  }));
  const fragments = buildActivityFragments(displays, 50, 5, new Set());
  const oldest = selectViewportWindow(fragments, 5, 0);
  const latest = selectViewportWindow(
    fragments,
    5,
    tailViewportStart(fragments, 5),
  );
  assertEquals(oldest[0].display.key, "0");
  assertEquals(latest.at(-1)?.display.key, "4");
  assert(latest.reduce((rows, fragment) => rows + fragment.rows, 0) <= 5);
});

Deno.test("activity ScrollView fragments an expanded tool card without losing output", () => {
  const displays = [{
    type: "tool" as const,
    key: "shell-1",
    at: Date.parse("2026-08-14T18:00:00Z"),
    toolName: "shell",
    headline: "Alice (abc123) — shell",
    status: "success" as const,
    compact: ["$ long-running-command"],
    details: [
      "$ long-running-command",
      "result: exit=0",
      "stdout: one deliberately long line of shell output that needs to remain readable in a small activity viewport.",
      "  second deliberately long line of shell output that should appear in a later fragment rather than overflow the card.",
    ],
  }];
  const fragments = buildActivityFragments(
    displays,
    32,
    7,
    new Set(["shell-1"]),
  );
  assert(fragments.length > 1);
  assert(fragments.every((fragment) => fragment.rows <= 7));
  const visibleOutput = fragments.flatMap((fragment) => fragment.body).join(
    " ",
  );
  assert(visibleOutput.includes("later"));
  assert(visibleOutput.includes("fragment"));
});

Deno.test("Cliffy standalone command forwards explicit config and no-ui mode", async () => {
  let captured: { path: string; useUi: boolean; task?: string } | undefined;
  await createCli((path, useUi, task) => {
    captured = { path, useUi, task };
    return Promise.resolve();
  }).parse([
    "--config",
    "fixture.yaml",
    "--no-ui",
    "--task",
    "Complete the run",
  ]);
  assertStringIncludes(captured?.path ?? "", "fixture.yaml");
  assertEquals(captured?.useUi, false);
  assertEquals(captured?.task, "Complete the run");
});

Deno.test("Cliffy Docker purge requires and forwards explicit scope", async () => {
  const calls: Array<{ runId?: string; pruneImages: boolean }> = [];
  const actions = {
    listRuns: () => Promise.resolve([]),
    listImages: () => Promise.resolve([]),
    cleanup: (runId: string | undefined, pruneImages: boolean) => {
      calls.push({ runId, pruneImages });
      return Promise.resolve({
        containers: ["runtime"],
        volumes: ["data"],
        imagesPruned: pruneImages,
      });
    },
    cleanupProject: (_project: string, pruneImages: boolean) =>
      Promise.resolve({
        containers: [],
        volumes: [],
        imagesPruned: pruneImages,
      }),
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    await createCli(() => Promise.resolve(), actions).parse([
      "docker",
      "purge",
      "--runtime",
      "run-1",
      "--prune-images",
    ]);
  } finally {
    console.log = originalLog;
  }
  assertEquals(calls, [{ runId: "run-1", pruneImages: true }]);
});

const attachFixtureConfig = `
agents:
  - type: coding
    names: [Alice, Bob]
    model: local-qwen
  - type: research
    name: Rowan
    model: local-qwen
`;

Deno.test("attach resolves agents by opaque id, semantic id, and name", async () => {
  const population = await expandPopulation(parseConfig(attachFixtureConfig));
  assertEquals(
    population.map((member) => member.semanticId),
    ["coding-1", "coding-2", "research-1"],
  );
  assertEquals(
    resolvePopulationMember(population, population[1].id).id,
    population[1].id,
  );
  assertEquals(
    resolvePopulationMember(population, "coding-2").name,
    "Bob",
  );
  assertEquals(
    resolvePopulationMember(population, "Research-1").name,
    "Rowan",
  );
  assertEquals(resolvePopulationMember(population, "alice").name, "Alice");
  assertEquals(
    resolvePopulationMember(population, population[0].id).name,
    "Alice",
  );
});

Deno.test("attach reports ambiguous names with authoritative stable ids", async () => {
  const population = await expandPopulation(
    parseConfig(`
agents:
  - type: coding
    name: Alice
    model: local-qwen
  - type: research
    name: Alice
    model: local-qwen
`),
  );
  const error = assertThrows(
    () => resolvePopulationMember(population, "alice"),
    Error,
  );
  assertStringIncludes(error.message, "ambiguous");
  assertStringIncludes(error.message, population[0].id);
  assertStringIncludes(error.message, population[1].id);
  assertStringIncludes(error.message, "coding-1");
  assertEquals(resolvePopulationMember(population, "research-1").name, "Alice");

  const missing = assertThrows(
    () => resolvePopulationMember(population, "nobody"),
    Error,
  );
  assertStringIncludes(missing.message, "No configured agent");
  assertStringIncludes(missing.message, population[0].id);
});

Deno.test("Cliffy attach command resolves before touching Docker", async () => {
  const directory = await Deno.makeTempDir({ prefix: "agent-zoo-attach-" });
  const configPath = `${directory}/agent-zoo.yaml`;
  await Deno.writeTextFile(configPath, attachFixtureConfig);
  let entered = false;
  try {
    const error = await assertRejects(
      () =>
        createCli(() => Promise.resolve(), undefined, {
          enter: () => {
            entered = true;
            return Promise.resolve(0);
          },
        }).parse(["attach", "nobody", "--config", configPath]),
      Error,
      "No configured agent",
    );
    assertStringIncludes((error as Error).message, "No configured agent");
    assertEquals(entered, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("dashboard run timer formats the complete elapsed duration", () => {
  assertEquals(formatRunElapsed(0), "00:00:00");
  assertEquals(formatRunElapsed(3_723_999), "01:02:03");
});

Deno.test("activity projection groups tool lifecycle and omits provider tool transport", () => {
  const activity = projectActivity([
    {
      sequence: 1,
      at: 0,
      kind: "agent:model:response",
      agentId: "alpha",
      agentName: "Alice",
      message: "model response",
      detail: {
        response: {
          content: [
            { type: "reasoning", text: "I will inspect the file." },
            {
              type: "tool-call",
              toolName: "read_file",
              input: { path: "/root/a.txt" },
            },
          ],
        },
      },
    },
    {
      sequence: 2,
      at: 1,
      kind: "agent:tool:start",
      agentId: "alpha",
      agentName: "Alice",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "called read_file",
      detail: { path: "/root/a.txt" },
    },
    {
      sequence: 3,
      at: 2,
      kind: "agent:tool:end",
      agentId: "alpha",
      agentName: "Alice",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "finished read_file",
      detail: {
        status: "success",
        result: { path: "/root/a.txt", content: "hello", bytesRead: 5 },
      },
    },
    {
      sequence: 4,
      at: 3,
      kind: "agent:model:request",
      agentId: "alpha",
      agentName: "Alice",
      message: "requested model turn",
      detail: {
        request: {
          prompt: [{
            role: "tool",
            content: [{ type: "tool-result", output: { value: "hello" } }],
          }],
        },
      },
    },
  ]);
  assertEquals(activity.length, 2);
  assertEquals(activity[0].type, "message");
  assertEquals(activity[0].details, ["I will inspect the file."]);
  assertEquals(activity[1].type, "tool");
  const tool = activity[1];
  if (tool.type !== "tool") throw new Error("Expected a tool display");
  assertEquals(tool.toolName, "read_file");
  assertEquals(tool.status, "success");
  assertEquals(tool.details, [
    "path: /root/a.txt",
    "content: hello",
    "size: 5 bytes",
  ]);
});

Deno.test("activity projection keeps same provider tool-call IDs distinct between agents", () => {
  const activity = projectActivity([
    {
      sequence: 10,
      at: 0,
      kind: "agent:tool:start",
      agentId: "alice",
      agentName: "Alice",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "Alice called read_file",
      detail: { path: "/shared/alice.txt" },
    },
    {
      sequence: 11,
      at: 1,
      kind: "agent:tool:start",
      agentId: "bob",
      agentName: "Bob",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "Bob called read_file",
      detail: { path: "/shared/bob.txt" },
    },
    {
      sequence: 12,
      at: 2,
      kind: "agent:tool:end",
      agentId: "alice",
      agentName: "Alice",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "Alice finished read_file",
      detail: { status: "success", result: { content: "alice" } },
    },
    {
      sequence: 13,
      at: 3,
      kind: "agent:tool:end",
      agentId: "bob",
      agentName: "Bob",
      toolName: "read_file",
      toolCallId: "tool-1",
      message: "Bob finished read_file",
      detail: { status: "success", result: { content: "bob" } },
    },
  ]);
  assertEquals(activity.map((display) => display.key), ["10", "11"]);
  assert(activity.every((display) => display.type === "tool"));
  assertEquals(activity.map((display) => display.details.at(-1)), [
    "content: alice",
    "content: bob",
  ]);
  const fragments = buildActivityFragments(activity, 50, 6, new Set());
  assertEquals(
    new Set(fragments.map((fragment) => fragment.key)).size,
    fragments.length,
  );
});

Deno.test("activity projection gives each part of a multi-message prompt a unique key", () => {
  const activity = projectActivity([
    {
      sequence: 20,
      at: 0,
      kind: "agent:model:request",
      agentId: "alice",
      agentName: "Alice",
      message: "Alice requested a model turn",
      detail: {
        request: {
          prompt: [
            { role: "system", content: "You are concise." },
            { role: "user", content: "Inspect the activity panel." },
          ],
        },
      },
    },
  ]);
  assertEquals(activity.map((display) => display.key), ["20:0:0", "20:1:0"]);
  const fragments = buildActivityFragments(activity, 50, 6, new Set());
  assertEquals(
    new Set(fragments.map((fragment) => fragment.key)).size,
    fragments.length,
  );
});

Deno.test("activity projection does not repeat assistant context after a tool call", () => {
  const reasoning = "I will create the requested file.";
  const activity = projectActivity([
    {
      sequence: 30,
      at: 0,
      kind: "agent:model:response",
      agentId: "alice",
      agentName: "Alice",
      message: "Alice received a model response",
      detail: {
        response: {
          content: [{ type: "reasoning", text: reasoning }],
        },
      },
    },
    {
      sequence: 31,
      at: 1,
      kind: "agent:model:request",
      agentId: "alice",
      agentName: "Alice",
      message: "Alice requested a model turn",
      detail: {
        request: {
          prompt: [
            {
              role: "assistant",
              content: [{ type: "reasoning", text: reasoning }],
            },
            {
              role: "tool",
              content: [{ type: "tool-result", output: "created" }],
            },
          ],
        },
      },
    },
  ]);
  assertEquals(activity.length, 1);
  assertEquals(activity[0].details, [reasoning]);
});

Deno.test("activity display includes shell command and real output snippets", () => {
  const command = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:tool:start",
    agentId: "alpha",
    toolName: "shell",
    message: "alpha called shell",
    detail: { command: "printf hello", cwd: "/shared" },
  });
  assertEquals(command.details, ["$ printf hello", "cwd: /shared"]);

  const output = formatActivity({
    sequence: 2,
    at: 1,
    kind: "agent:tool:end",
    agentId: "alpha",
    toolName: "shell",
    message: "alpha finished shell",
    detail: {
      status: "success",
      result: {
        exitCode: 0,
        timedOut: false,
        aborted: false,
        stdout: "hello\nsecond line",
        stderr: "",
      },
    },
  });
  assertEquals(output.details, [
    "result: exit=0",
    "stdout: hello",
    "  second line",
  ]);
});

Deno.test("activity display includes shell timeout recovery guidance", () => {
  const output = formatActivity({
    sequence: 2,
    at: 1,
    kind: "agent:tool:end",
    agentId: "alpha",
    toolName: "shell",
    message: "alpha finished shell",
    detail: {
      status: "success",
      result: {
        exitCode: 143,
        timedOut: true,
        aborted: false,
        stdout: "",
        stderr: "",
        message:
          "The command exceeded its 3-minute timeout and was stopped. A terminated package-manager operation may have left an interrupted transaction.",
      },
    },
  });
  assertEquals(output.details, [
    "result: exit=143 · timed out",
    "message: The command exceeded its 3-minute timeout and was stopped. A terminated package-manager operation may have left an interrupted transaction.",
  ]);
});

Deno.test("terminal activity cards retain typed input and render the screen without duplicate metadata", () => {
  const activity = projectActivity([
    {
      sequence: 1,
      at: 0,
      kind: "agent:tool:start",
      agentId: "alice",
      agentName: "Alice",
      toolCallId: "terminal-1",
      toolName: "terminal_send",
      message: "Alice called terminal_send",
      detail: { name: "universe", text: "garden", enter: true },
    },
    {
      sequence: 2,
      at: 1,
      kind: "agent:tool:end",
      agentId: "alice",
      agentName: "Alice",
      toolCallId: "terminal-1",
      toolName: "terminal_send",
      message: "Alice finished terminal_send",
      detail: {
        status: "success",
        result: { name: "universe", status: "sent" },
      },
    },
    {
      sequence: 3,
      at: 2,
      kind: "agent:tool:start",
      agentId: "alice",
      agentName: "Alice",
      toolCallId: "terminal-2",
      toolName: "terminal_read",
      message: "Alice called terminal_read",
      detail: { name: "universe" },
    },
    {
      sequence: 4,
      at: 3,
      kind: "agent:tool:end",
      agentId: "alice",
      agentName: "Alice",
      toolCallId: "terminal-2",
      toolName: "terminal_read",
      message: "Alice finished terminal_read",
      detail: {
        status: "success",
        result: {
          name: "universe",
          found: true,
          output: "Welcome to the garden\n> ",
        },
      },
    },
  ]);
  assertEquals(activity.length, 2);
  assertEquals(activity[0].type, "tool");
  assertEquals(activity[1].type, "tool");
  if (activity[0].type !== "tool" || activity[1].type !== "tool") {
    throw new Error("Expected terminal tool cards");
  }
  assertEquals(activity[0].details, [
    "terminal: universe",
    "sent: garden",
    "enter: true",
  ]);
  assertEquals(activity[1].details, [
    "terminal: universe",
    "range: all retained scrollback",
    "screen: Welcome to the garden",
    "  >",
  ]);
  const collapsed = buildActivityFragments(
    activity,
    100,
    10,
    new Set(),
  );
  assertEquals(collapsed[0].body, [
    "✓ complete",
    "terminal: universe",
    "sent: garden",
  ]);
});

Deno.test("activity display makes optional MCP loss conspicuous", () => {
  const display = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:mcp:unavailable",
    agentId: "rowan",
    agentName: "Rowan",
    message: "Rowan continues without MCP server browseros",
    detail: {
      serverName: "browseros",
      message: "MCP server browseros is unavailable during discovery",
    },
  });
  assertStringIncludes(display.headline, "MCP unavailable");
  assertStringIncludes(display.details.join("\n"), "browseros");
  assertStringIncludes(
    display.details.join("\n"),
    "Continuing with the remaining capabilities.",
  );
});

Deno.test("wake activity shows environment entries instead of a blank row", () => {
  const display = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:wake",
    agentId: "alpha",
    message: "alpha woke after 0 milliseconds",
    detail: {
      idleMs: 0,
      prompt: "",
      role: "user",
      initialSystemContext:
        "You are in /root.\nIts current contents are:\n\nfile ./.profile\nfile ./.bashrc",
      appendPrompt: false,
    },
  });
  assertEquals(display.details, [
    "system: You are in /root.",
    "  Its current contents are:",
    "  file ./.profile",
    "  file ./.bashrc",
  ]);
});

Deno.test("activity display summarizes structured filesystem work", () => {
  const start = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:tool:start",
    agentId: "alpha",
    toolName: "edit_file",
    message: "alpha called edit_file",
    detail: { path: "/root/main.ts", oldText: "a", newText: "b" },
  });
  assertEquals(start.details, [
    "path: /root/main.ts",
    "oldText: a",
    "newText: b",
  ]);
  const end = formatActivity({
    sequence: 2,
    at: 1,
    kind: "agent:tool:end",
    agentId: "alpha",
    toolName: "edit_file",
    message: "alpha finished edit_file",
    detail: {
      status: "success",
      result: { path: "/root/main.ts", replacements: 1 },
    },
  });
  assertEquals(end.details, ["replacements: 1"]);
});

Deno.test("directory activity retains the requested path once and summarizes entries", () => {
  const activity = projectActivity([
    {
      sequence: 1,
      at: 0,
      kind: "agent:tool:start",
      agentId: "alpha",
      toolName: "list_directory",
      toolCallId: "tool-1",
      message: "alpha called list_directory",
      detail: { path: "/shared" },
    },
    {
      sequence: 2,
      at: 1,
      kind: "agent:tool:end",
      agentId: "alpha",
      toolName: "list_directory",
      toolCallId: "tool-1",
      message: "alpha finished list_directory",
      detail: {
        status: "success",
        result: {
          path: "/shared",
          entries: [{ name: "notes", type: "directory", sizeBytes: 4096 }],
        },
      },
    },
  ]);
  assertEquals(activity[0].type, "tool");
  const tool = activity[0];
  if (tool.type !== "tool") throw new Error("Expected a tool display");
  assertEquals(tool.details, [
    "path: /shared",
    "result: 1 entry",
    "directory: notes (4096 bytes)",
  ]);
});

Deno.test("skills activity displays the available skill names and descriptions", () => {
  const display = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:tool:end",
    agentId: "alpha",
    toolName: "skills_list",
    message: "alpha finished skills_list",
    detail: {
      status: "success",
      result: JSON.stringify([
        { name: "editing-files", description: "Edit existing files safely." },
        { name: "interactive-work", description: "Work with live programs." },
      ]),
    },
  });
  assertEquals(display.details, [
    "result: 2 skills",
    "skill: editing-files — Edit existing files safely.",
    "skill: interactive-work — Work with live programs.",
  ]);
});

Deno.test("activity display shows patch snippets and changed-file results", () => {
  const start = formatActivity({
    sequence: 1,
    at: 0,
    kind: "agent:tool:start",
    agentId: "alpha",
    toolName: "apply_patch",
    message: "alpha called apply_patch",
    detail: {
      cwd: "/root/project",
      patch: "--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@",
    },
  });
  assertEquals(start.details, [
    "cwd: /root/project",
    "patch: --- a/main.ts",
    "  +++ b/main.ts",
    "  @@ -1 +1 @@",
  ]);
  const end = formatActivity({
    sequence: 2,
    at: 1,
    kind: "agent:tool:end",
    agentId: "alpha",
    toolName: "apply_patch",
    message: "alpha finished apply_patch",
    detail: { status: "success", result: { filesChanged: 1, changes: [] } },
  });
  assertEquals(end.details, ["result: 1 files changed"]);
});

Deno.test("activity display survives malformed provider errors and missing fields", () => {
  const providerError = new Error(
    "XML syntax error on line 2: element <function> closed by </parameter>",
  );
  providerError.name = "AI_APICallError";
  Object.assign(providerError, {
    statusCode: 500,
    url: "http://localhost:11434/api/chat",
    responseBody: "Jinja Exception: invalid turn sequence",
    isRetryable: false,
    cause: { name: "TypeError", message: "provider rejected request" },
  });
  const displayed = formatActivity({
    sequence: 3,
    at: Date.parse("2026-08-12T09:12:21Z"),
    kind: "agent:model:error",
    agentId: "coding-2",
    agentName: "Bob",
    message: "Bob (coding-2) model request failed",
    detail: {
      kind: "error",
      callId: "model:17",
      at: Date.parse("2026-08-12T09:12:21Z"),
      error: providerError,
    },
  });
  assertEquals(displayed.headline, "Bob (coding-2) — error");
  assertStringIncludes(displayed.details.join("\n"), "AI_APICallError");
  assertStringIncludes(displayed.details.join("\n"), "XML syntax error");
  assertStringIncludes(displayed.details.join("\n"), "status: 500");
  assertStringIncludes(
    displayed.details.join("\n"),
    "Jinja Exception: invalid turn sequence",
  );
  assertStringIncludes(
    displayed.details.join("\n"),
    "cause: TypeError: provider rejected request",
  );

  const retryDisplayed = formatActivity({
    sequence: 3.5,
    at: Date.parse("2026-08-12T09:12:21Z"),
    kind: "agent:model:error",
    agentId: "coding-2",
    message: "model request failed after retries",
    detail: {
      error: {
        name: "AI_RetryError",
        message: "Failed after 2 attempts",
        lastError: providerError,
        errors: [providerError],
      },
    },
  });
  assertStringIncludes(
    retryDisplayed.details.join("\n"),
    "last error: AI_APICallError: XML syntax error",
  );
  assertStringIncludes(
    retryDisplayed.details.join("\n"),
    "attempt 1: AI_APICallError: XML syntax error",
  );

  const serialized = formatActivity({
    sequence: 4,
    at: 0,
    kind: "agent:model:error",
    message: "model request failed",
    detail: {
      error: {
        name: "AI_APICallError",
        message: "malformed tool-call response",
      },
    },
  });
  assertEquals(serialized.details, [
    "error: AI_APICallError: malformed tool-call response",
  ]);

  const missingError = formatActivity({
    sequence: 5,
    at: 0,
    kind: "agent:model:error",
    message: "model request failed",
    detail: { kind: "error", callId: "model:18" },
  });
  assertEquals(missingError.details, ["error: Details unavailable."]);

  const missingPrompt = formatActivity({
    sequence: 6,
    at: 0,
    kind: "agent:model:request",
    message: "requested a model turn",
    detail: {},
  });
  assertEquals(missingPrompt.details, ["(unavailable)"]);
});

Deno.test(
  "activity log is timestamped beside config and preserves full model telemetry",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "agent-zoo-log-test-" });
    class FakeZoo extends EventTarget {
      getAgent() {
        return { config: { model: "local-qwen", name: "Alice" } };
      }
      state() {
        return {
          state: "stopped",
          agents: [{
            id: "alpha",
            name: "Alice",
            model: "local-qwen",
            state: "stopped",
            activations: 1,
          }],
        };
      }
    }
    const zoo = new FakeZoo();
    const models = {
      get: () => ({ provider: "ollama", model: "qwen3.5:9b" }),
    };
    try {
      const log = await ActivityLog.create(
        zoo as unknown as AgentZoo,
        models as unknown as ModelRegistry,
        `${directory}/zoo.yaml`,
        new Date("2026-08-11T12:34:56.789Z"),
      );
      assertMatch(
        log.path.replaceAll("\\", "/"),
        /\/agent-zoo-20260811T123456\.789Z\.jsonl$/,
      );
      zoo.dispatchEvent(
        new CustomEvent("activity", {
          detail: {
            sequence: 1,
            at: Date.parse("2026-08-11T12:35:00Z"),
            kind: "agent:response",
            agentId: "alpha",
            message: "alpha responded",
            detail: {
              output: "full output",
              messages: [{ role: "assistant", content: "uncut model message" }],
            },
          },
        }),
      );
      for (
        const detail of [
          {
            sequence: 2,
            kind: "agent:tool:start",
            message: "alpha called shell",
            toolName: "shell",
            toolCallId: "alpha:tool:1",
            detail: { command: "false" },
          },
          {
            sequence: 3,
            kind: "agent:tool:end",
            message: "alpha failed shell",
            toolName: "shell",
            toolCallId: "alpha:tool:1",
            detail: { status: "error", error: new Error("failed") },
          },
          {
            sequence: 4,
            kind: "agent:error",
            message: "alpha: max turns",
            detail: {
              error: new Error("max turns"),
              activation: {
                messages: [{ role: "assistant", content: "partial reasoning" }],
                modelExchanges: [{
                  request: "full request",
                  response: "full response",
                }],
              },
            },
          },
          {
            sequence: 5,
            kind: "agent:model:error",
            message: "alpha model request failed",
            detail: {
              error: Object.assign(
                new Error("Internal Server Error"),
                {
                  name: "AI_APICallError",
                  statusCode: 500,
                  url: "http://localhost:11434/api/chat",
                  responseHeaders: { "content-type": "application/json" },
                  responseBody:
                    "Jinja Exception: System message must be at the beginning.",
                  isRetryable: false,
                  requestBodyValues: { prompt: ["sensitive prompt"] },
                  cause: Object.assign(new Error("HTTP 500"), {
                    name: "APICallError",
                  }),
                },
              ),
            },
          },
        ]
      ) {
        zoo.dispatchEvent(
          new CustomEvent("activity", {
            detail: {
              ...detail,
              at: Date.parse("2026-08-11T12:35:01Z") + detail.sequence,
              agentId: "alpha",
            },
          }),
        );
      }
      await log.close();

      const records = (await Deno.readTextFile(log.path)).trim().split("\n")
        .map((line) => JSON.parse(line));
      assertEquals(records[1].modelKey, "local-qwen");
      assertEquals(records[1].modelName, "qwen3.5:9b");
      assertEquals(records[1].agentId, "alpha");
      assertEquals(records[1].agentName, "Alice");
      assertEquals(
        records[1].detail.messages[0].content,
        "uncut model message",
      );
      const starts = records.filter((record) =>
        record.kind === "agent:tool:start"
      );
      const ends = records.filter((record) => record.kind === "agent:tool:end");
      assertEquals(starts[0].toolCallId, ends[0].toolCallId);
      const failure = records.find((record) => record.kind === "agent:error");
      assertEquals(
        failure.detail.activation.messages[0].content,
        "partial reasoning",
      );
      assertEquals(
        failure.detail.activation.modelExchanges[0].response,
        "full response",
      );
      const providerFailure = records.find((record) =>
        record.kind === "agent:model:error"
      );
      assertEquals(providerFailure.detail.error.statusCode, 500);
      assertEquals(
        providerFailure.detail.error.url,
        "http://localhost:11434/api/chat",
      );
      assertEquals(
        providerFailure.detail.error.responseBody,
        "Jinja Exception: System message must be at the beginning.",
      );
      assertEquals(providerFailure.detail.error.requestBodyValues, "[omitted]");
      assertEquals(
        providerFailure.detail.error.cause.message,
        "HTTP 500",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
