import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { createCli } from "../cli_command.ts";
import { formatActivity } from "../packages/cli/activity_format.ts";
import { ActivityLog } from "../packages/cli/ActivityLog.ts";
import { formatRunElapsed } from "../packages/cli/components/DashboardHeader.tsx";
import type { AgentZoo, ModelRegistry } from "@agent-zoo/core";

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

Deno.test("Cliffy Docker cleanup requires and forwards explicit scope", async () => {
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
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    await createCli(() => Promise.resolve(), actions).parse([
      "docker",
      "cleanup",
      "--run",
      "run-1",
      "--prune-images",
    ]);
  } finally {
    console.log = originalLog;
  }
  assertEquals(calls, [{ runId: "run-1", pruneImages: true }]);
});

Deno.test("dashboard run timer formats the complete elapsed duration", () => {
  assertEquals(formatRunElapsed(0), "00:00:00");
  assertEquals(formatRunElapsed(3_723_999), "01:02:03");
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
  assertEquals(command.details, ["command (/shared): $ printf hello"]);

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
  assertEquals(output.details, ["output exit=0: hello", "  second line"]);
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
    "output exit=143 timed-out: (no output)",
    "message: The command exceeded its 3-minute timeout and was stopped. A terminated package-manager",
    " operation may have left an interrupted transaction.",
  ]);
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
  assertEquals(start.details, ["path: /root/main.ts"]);
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
  assertEquals(end.details, ["result: replaced 1 occurrence(s)"]);
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
    "patch (/root/project): --- a/main.ts",
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
  assertEquals(displayed.headline, "Bob (coding-2) model request failed");
  assertStringIncludes(displayed.details.join("\n"), "AI_APICallError");
  assertStringIncludes(displayed.details.join("\n"), "XML syntax error");

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
    "model error: AI_APICallError: malformed tool-call response",
  ]);

  const missingError = formatActivity({
    sequence: 5,
    at: 0,
    kind: "agent:model:error",
    message: "model request failed",
    detail: { kind: "error", callId: "model:18" },
  });
  assertEquals(missingError.details, ["model error: Details unavailable."]);

  const missingPrompt = formatActivity({
    sequence: 6,
    at: 0,
    kind: "agent:model:request",
    message: "requested a model turn",
    detail: {},
  });
  assertEquals(missingPrompt.details, ["model input: (unavailable)"]);
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
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
