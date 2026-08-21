/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of AgentZoo.
 *
 * AgentZoo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * AgentZoo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AgentZoo.  If not, see <https://www.gnu.org/licenses/>.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { LanguageModel } from "npm:ai@^6";
import { Agent as VibesAgent, type ToolDefinition } from "@vibesjs/sdk";
import { FunctionModel } from "../../../vendor/vibes/lib/testing/function_model.ts";
import { z } from "zod";
import type {
  CommandOptions,
  CommandResult,
  ModelConfig,
  RuntimeEnv,
} from "../types.ts";
import {
  actionableToolError,
  AgentZoo,
  composeInitialPrompt,
  configureModelRequest,
  ConfigValidationError,
  createCompletionTool,
  createLanguageModel,
  createYieldTool,
  DockerRuntimeManager,
  FilesystemFeature,
  HttpFeature,
  loadConfig,
  ModelRegistry,
  observedToolResult,
  parseConfig,
  resolveConfigEnvironment,
  ShellFeature,
  TemplateRegistry,
  ToolExecutionError,
} from "../mod.ts";
import { assertAgentId, SharedWorkspace } from "../mod.ts";
import {
  AgentActivationError,
  type AgentRunDeps,
  buildAgentSystemPrompt,
  modelInputTokenBudget,
  observeLanguageModel,
  ZooAgent,
} from "../Agent.ts";
import { Router } from "@agent-zoo/api";
import { Service } from "@agent-zoo/service";
import { unwrapObservedToolResult } from "../ToolSupport.ts";
import Context from "@agent-zoo/context";
import { FeatureRegistry } from "../Feature.ts";

Deno.test("actionable tool feedback preserves ordered recovery lines", () => {
  const error = actionableToolError([
    "No files were changed.",
    "The requested text was not found.",
    "Read the current file before retrying.",
  ]);
  assertEquals(
    error.message,
    "No files were changed.\nThe requested text was not found.\nRead the current file before retrying.",
  );
});
import { modelSettingsToAISDKOptions } from "../../../vendor/vibes/lib/execution/_run_utils.ts";

Deno.test("completion tool uses a project-neutral public name", () => {
  const completion = createCompletionTool();
  assertEquals(completion.name, "complete");
  assertEquals(createYieldTool().description, "Stop for now.");
  assertEquals(
    completion.description,
    "Signal that you have nothing else to do.",
  );
  const schema = z.toJSONSchema(completion.parameters) as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  assertEquals(schema.required, undefined);
  assert("reason" in (schema.properties ?? {}));
});

Deno.test("model-facing defaults do not disclose the harness identity or mechanics", async () => {
  const forbidden =
    /agent[ -]?zoo|scheduler|population|participant|experiment|harness/i;
  const toolText = [
    createYieldTool().description,
    createCompletionTool().description,
  ].join("\n");
  assert(!forbidden.test(toolText));

  const system = await buildAgentSystemPrompt(undefined);
  assert(!/agent[ -]?zoo|experiment|harness/i.test(system));

  const genericTools = [
    ...await new ShellFeature().createTools(),
    ...await new FilesystemFeature().createTools(),
    ...await new HttpFeature().createTools(),
  ];
  assert(genericTools[0].description.includes("Execute a Bash command."));
  assert(genericTools[0].description.includes("filesystem tools"));
  assertEquals(
    genericTools.map((tool) => tool.name),
    [
      "shell",
      "start_background",
      "stop_background",
      "get_background",
      "send_background",
      "apply_patch",
      "write_file",
      "edit_file",
      "read_file",
      "list_directory",
      "search_files",
      "http_request",
    ],
  );
  const writeSchema = z.toJSONSchema(
    genericTools.find((tool) => tool.name === "write_file")!.parameters,
  ) as { properties?: Record<string, unknown> };
  assert("content" in (writeSchema.properties ?? {}));
  assert("force" in (writeSchema.properties ?? {}));
  assert(!("lines" in (writeSchema.properties ?? {})));
  const editSchema = z.toJSONSchema(
    genericTools.find((tool) => tool.name === "edit_file")!.parameters,
  ) as { properties?: Record<string, unknown> };
  assert("oldText" in (editSchema.properties ?? {}));
  assert("newText" in (editSchema.properties ?? {}));
  assert(!("oldLines" in (editSchema.properties ?? {})));
  assert(!("newLines" in (editSchema.properties ?? {})));
  assert(
    !forbidden.test(JSON.stringify(genericTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: z.toJSONSchema(tool.parameters),
    })))),
  );

  const example = parseConfig(
    await Deno.readTextFile(
      new URL("../../../agent-zoo.example.yaml", import.meta.url),
    ),
  );
  assert(!forbidden.test(Object.values(example.templates).join("\n")));

  const containerfile = await Deno.readTextFile(
    new URL("../runtime/Containerfile", import.meta.url),
  );
  const shellPrompt = containerfile.split("\n").find((line) =>
    line.includes("PS1=")
  );
  assert(shellPrompt && !/@agent(?:\W|$)/i.test(shellPrompt));
  assert(shellPrompt.includes('PS1="\\\\u@localhost:'));
  assert(!/agent[ -]?zoo/i.test(new DockerRuntimeManager("shared").hostName));
});

Deno.test("Docker runtime identity is stable per config path", () => {
  const first = new DockerRuntimeManager("shared-a", undefined, undefined, {
    project: "C:/projects/zoo-a/agent-zoo.yaml",
  });
  const same = new DockerRuntimeManager("shared-a", undefined, undefined, {
    project: "C:/projects/zoo-a/agent-zoo.yaml",
  });
  const other = new DockerRuntimeManager("shared-b", undefined, undefined, {
    project: "C:/projects/zoo-b/agent-zoo.yaml",
  });

  assertEquals(first.hostName, same.hostName);
  assertEquals(first.dataVolumeName, same.dataVolumeName);
  assert(first.hostName !== other.hostName);
});

Deno.test("Vibes preserves provider-facing tool definition order", async () => {
  const definitions = [
    ...await new ShellFeature().createTools(),
    ...await new FilesystemFeature().createTools(),
    createYieldTool(),
    createCompletionTool(),
  ];
  let renderedTools: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
  }> = [];
  const model = new FunctionModel(({ tools }) => {
    renderedTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return {
      content: [{ type: "text", text: "done" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    };
  });
  const agent = new VibesAgent({
    name: "tool-order-test",
    model,
    tools: definitions,
    maxTurns: 1,
  });
  await agent.run("Inspect the available functions.");
  assertEquals(renderedTools.map((tool) => tool.name), [
    "shell",
    "start_background",
    "stop_background",
    "get_background",
    "send_background",
    "apply_patch",
    "write_file",
    "edit_file",
    "read_file",
    "list_directory",
    "search_files",
    "yield",
    "complete",
  ]);
  assert(renderedTools.every((tool) => tool.description));
  assert(renderedTools.every((tool) => tool.inputSchema));
});

Deno.test("generic tools expose usable provider-facing instructions", async () => {
  const tools = [
    ...await new ShellFeature().createTools(),
    ...await new FilesystemFeature().createTools(),
    ...await new HttpFeature().createTools(),
  ];
  const exposed = Object.fromEntries(tools.map((tool) => [
    tool.name,
    JSON.stringify({
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters),
    }),
  ]));

  for (
    const term of [
      "The Bash command to execute",
      "milliseconds",
      "Defaults to 120000",
      "cannot exceed 1800000",
      "installing software",
      "exit code",
      "truncation flags",
    ]
  ) assert(exposed.shell.includes(term));

  const shell = tools.find((tool) => tool.name === "shell")!;
  const shellSchema = z.toJSONSchema(shell.parameters) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  assertEquals(shellSchema.required, undefined);
  assert(shellSchema.properties?.command !== undefined);
  assertEquals(shellSchema.properties?.script, undefined);
  assert(exposed.shell.includes("Put all shell code in command"));
  assert(
    shell.parameters.safeParse({
      command: "apt-get update\napt-get install -y python3",
      cwd: "/root",
    }).success,
  );
  const misplacedCall = shell.parameters.safeParse({
    cwd: "/shared/calculator,command>python3 verify.py",
  });
  assert(misplacedCall.success);
  const misplacedError = await assertRejects(
    async () => await shell.argsValidator!(misplacedCall.data),
    ToolExecutionError,
    "No command was provided, and cwd appears to contain shell commands.",
  );
  assert(misplacedError.message.includes("Put the shell code in command"));
  assert(misplacedError.message.includes('"command":"python3 verify.py"'));

  const missingCommand = shell.parameters.safeParse({ cwd: "/root" });
  assert(missingCommand.success);
  await assertRejects(
    async () => await shell.argsValidator!(missingCommand.data),
    ToolExecutionError,
    "Provide the command to execute in command.",
  );
  const badCwdError = await assertRejects(
    async () =>
      await shell.argsValidator!({
        command: "apt-get update",
        cwd: "/root && echo wrong",
      }),
    ToolExecutionError,
    "cwd accepts only a directory path",
  );
  assert(badCwdError.message.includes("Put all shell commands in command"));

  for (
    const command of [
      "apt-get update && apt-get install -y python3-pip",
      "npm install",
      "python3 -m pip install requests",
    ]
  ) {
    const shortPackageCall = shell.parameters.safeParse({
      command,
      timeoutMs: 180_000,
    });
    assert(shortPackageCall.success);
    const timeoutError = await assertRejects(
      async () => await shell.argsValidator!(shortPackageCall.data),
      ToolExecutionError,
      "The command runs a package manager with a timeout of 3 minutes or less.",
    );
    assert(timeoutError.message.includes("Set timeoutMs to at least 300000"));
  }
  for (
    const command of [
      "dpkg -l | grep python; ls /usr/bin/python*; find / -name '*.py' 2>/dev/null | head",
      "dpkg --list",
      "npm list",
      "pip3 list",
      "python3 -m pip list",
      "apt list",
    ]
  ) {
    await shell.argsValidator!({ command, timeoutMs: 120_000 });
  }
  await shell.argsValidator!({
    command: "apt-get update && apt-get install -y python3-pip",
    timeoutMs: 300_000,
  });
  await shell.argsValidator!({
    command: "printf 'apt-get is available\\n'",
    timeoutMs: 120_000,
  });

  const timedOutContext = ({ stdout = "", stderr = "" } = {}) =>
    ({
      deps: {
        agentId: "alpha",
        provider: "openai-compatible",
        model: "test-model",
        cwd: "/root",
        runtime: {
          agentId: "alpha",
          prepare: () => Promise.resolve(),
          exec: () =>
            Promise.resolve({
              exitCode: 143,
              stdout,
              stderr,
              timedOut: true,
              aborted: false,
            }),
          destroy: () => Promise.resolve(),
          reset: () => Promise.resolve(),
        },
        control: {},
      },
    }) as never;
  const ordinaryTimeout = unwrapObservedToolResult(
    await shell.execute!(timedOutContext(), {
      command: "sleep 600",
      timeoutMs: 180_000,
    }),
  ).result as Record<string, unknown>;
  assertEquals(
    ordinaryTimeout.message,
    "The command exceeded its 3-minute timeout and was stopped. Retry with a longer timeoutMs if the command is expected to take longer.",
  );
  assert(!String(ordinaryTimeout.message).includes("dpkg"));

  const packageTimeout = unwrapObservedToolResult(
    await shell.execute!(
      timedOutContext({ stderr: "processing package data" }),
      {
        command: "apt-get update && apt-get install -y python3-pip",
        timeoutMs: 180_000,
      },
    ),
  ).result as Record<string, unknown>;
  assertEquals(packageTimeout.timedOut, true);
  assert(String(packageTimeout.message).includes("interrupted transaction"));
  assert(String(packageTimeout.message).includes("dpkg --configure -a"));
  assert(String(packageTimeout.message).includes("longer timeoutMs"));

  const failingContext = (exitCode: number) =>
    ({
      deps: {
        agentId: "alpha",
        provider: "openai-compatible",
        model: "test-model",
        cwd: "/root",
        runtime: {
          agentId: "alpha",
          prepare: () => Promise.resolve(),
          exec: () =>
            Promise.resolve({
              exitCode,
              stdout: "",
              stderr: "",
              timedOut: false,
              aborted: false,
            }),
          destroy: () => Promise.resolve(),
          reset: () => Promise.resolve(),
        },
        control: {},
      },
    }) as never;
  const edit = tools.find((tool) => tool.name === "edit_file")!;
  const missingText = await assertRejects(
    () =>
      edit.execute!(failingContext(44), {
        path: "/root/file.txt",
        oldText: "missing",
        newText: "replacement",
      }),
    ToolExecutionError,
    "No files were changed.",
  );
  assert(missingText.message.includes("The requested text was not found"));
  assert(missingText.message.includes("copy the exact text into oldText"));
  const ambiguousText = await assertRejects(
    () =>
      edit.execute!(failingContext(45), {
        path: "/root/file.txt",
        oldText: "repeated",
        newText: "replacement",
      }),
    ToolExecutionError,
    "No files were changed.",
  );
  assert(ambiguousText.message.includes("replaceAll"));

  const http = tools.find((tool) => tool.name === "http_request")!;
  const malformedHttp = http.parameters.safeParse({ url: "not a URL" });
  assert(malformedHttp.success, "diagnosable URLs must reach argsValidator");
  await assertRejects(
    async () => await http.argsValidator!(malformedHttp.data),
    ToolExecutionError,
    "The URL is malformed.",
  );
  const httpFailure = await assertRejects(
    () =>
      http.execute!(failingContext(49), {
        url: "https://example.invalid/",
      }),
    ToolExecutionError,
    "No HTTP response was received.",
  );
  assert(httpFailure.message.includes("network availability"));

  const semanticRequirements: Array<
    [string, Record<string, unknown>, string]
  > = [
    ["read_file", {}, "Provide the file to read in path."],
    ["write_file", { path: "/root/a.txt" }, "content"],
    [
      "edit_file",
      { path: "/root/a.txt", newText: "new" },
      "oldText",
    ],
    ["apply_patch", {}, "Provide the complete unified diff in patch."],
    ["http_request", {}, "Provide the HTTP or HTTPS URL"],
  ];
  for (const [name, args, message] of semanticRequirements) {
    const target = tools.find((tool) => tool.name === name)!;
    const parsed = target.parameters.safeParse(args);
    assert(parsed.success, `${name} should admit diagnosable missing input`);
    await assertRejects(
      async () => await target.argsValidator!(parsed.data),
      ToolExecutionError,
      message,
    );
  }

  const write = tools.find((tool) => tool.name === "write_file")!;
  const createWrite = write.parameters.safeParse({
    path: "/root/new.txt",
    content: "new",
  });
  assert(createWrite.success);
  await write.argsValidator!(createWrite.data);
  const unconfirmedOverwrite = write.parameters.safeParse({
    path: "/root/existing.txt",
    content: "replacement",
    mode: "overwrite",
  });
  assert(unconfirmedOverwrite.success);
  const overwriteError = await assertRejects(
    async () => await write.argsValidator!(unconfirmedOverwrite.data),
    ToolExecutionError,
    "Replacing the complete file requires explicit confirmation.",
  );
  assert(
    overwriteError.message.includes("For a local change, prefer edit_file"),
  );
  assert(overwriteError.message.includes("apply_patch"));
  assert(overwriteError.message.includes("force to true"));
  const confirmedOverwrite = write.parameters.safeParse({
    path: "/root/existing.txt",
    content: "replacement",
    mode: "overwrite",
    force: true,
  });
  assert(confirmedOverwrite.success);
  await write.argsValidator!(confirmedOverwrite.data);
  const meaninglessForce = write.parameters.safeParse({
    path: "/root/new.txt",
    content: "new",
    force: true,
  });
  assert(meaninglessForce.success);
  await assertRejects(
    async () => await write.argsValidator!(meaninglessForce.data),
    ToolExecutionError,
    "force only applies with mode overwrite.",
  );

  for (
    const term of [
      "UTF-8",
      "Defaults to 0",
      "Defaults to 65536",
      "nextOffset",
    ]
  ) assert(exposed.read_file.includes(term));

  assert(exposed.write_file.includes("multiline text directly"));
  assert(exposed.edit_file.includes("multiline text directly"));
  assert(
    exposed.apply_patch.includes("complete unified diff as multiline text"),
  );
  assert(exposed.write_file.includes("Defaults to create"));
  assert(exposed.write_file.includes("force true"));
  assert(exposed.write_file.includes("refuses to replace an existing path"));
  assert(exposed.write_file.includes("parent directory must already exist"));
  assert(exposed.write_file.includes("Prefer edit_file"));
  assert(exposed.write_file.includes("apply_patch"));
  assert(exposed.write_file.includes("explicitly replace"));
  assert(
    exposed.edit_file.includes("requires the old text to occur exactly once"),
  );
  assert(exposed.edit_file.includes("prefer apply_patch"));
  assert(exposed.apply_patch.includes("prefer edit_file"));
  assert(exposed.apply_patch.includes("@@"));
  assert(exposed.apply_patch.includes("Every hunk line must begin"));
  assert(exposed.apply_patch.includes("+third"));
  const patchDescription = (z.toJSONSchema(
    tools.find((tool) => tool.name === "apply_patch")!.parameters,
  ) as { properties?: { patch?: { description?: string } } }).properties?.patch
    ?.description ?? "";
  assert(patchDescription.includes("Example:\n--- a/file.txt\n+++ b/file.txt"));
  assert(!patchDescription.includes("\\n+++ b/file.txt"));
  assert(exposed.list_directory.includes("without recursive traversal"));
  assert(exposed.shell.includes("processes it started are terminated"));

  for (
    const term of [
      "Search recursively",
      "case-sensitive",
      "literal",
      "Defaults to 50",
      "truncated",
    ]
  ) assert(exposed.search_files.includes(term));
  const searchSchema = z.toJSONSchema(
    tools.find((tool) => tool.name === "search_files")!.parameters,
  ) as { type?: string; anyOf?: unknown; required?: string[] };
  assertEquals(searchSchema.type, "object");
  assertEquals(searchSchema.anyOf, undefined);
  assertEquals(searchSchema.required, undefined);
  assert(exposed.search_files.includes("Defaults to '*'"));

  for (
    const term of [
      "HTTP or HTTPS",
      "Defaults to GET",
      "5 redirects",
      "120 seconds",
      "bodyEncoding",
      "truncation status",
    ]
  ) assert(exposed.http_request.includes(term));
});

Deno.test("Vibes returns semantic argument validation errors to the model", async () => {
  const prompts: unknown[][] = [];
  let turn = 0;
  let runtimeCalled = false;
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "semantic-validation",
    supportedUrls: {},
    doGenerate: (options: unknown) => {
      prompts.push([
        ...(((options as { prompt?: unknown[] }).prompt) ?? []),
      ]);
      turn++;
      return Promise.resolve(
        turn === 1
          ? {
            content: [{
              type: "tool-call",
              toolCallId: "bad-shell-call",
              toolName: "shell",
              input: '{"cwd":"/shared/calculator,command>python3 verify.py"}',
            }],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage,
            warnings: [],
          }
          : {
            content: [{ type: "text", text: "recovered" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage,
            warnings: [],
          },
      );
    },
    doStream: () => {
      throw new Error("not used");
    },
  } as unknown as LanguageModel;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(): Promise<CommandResult> {
      runtimeCalled = true;
      throw new Error("semantic validation should prevent execution");
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const shell = await new ShellFeature().createTools();
  const agent = new ZooAgent(
    { id: "alpha", model: "local" },
    runtime,
    new ModelRegistry({
      local: { provider: "ollama", model: "fake" },
    }),
    () => model,
    shell,
  );

  const result = await agent.activate("test");
  assertEquals(result.output, "recovered");
  assert(result.metadata);
  assertEquals(result.metadata.retryCount, 0);
  assertEquals(runtimeCalled, false);
  assertEquals(prompts.length, 2);
  const repairedTurn = JSON.stringify(prompts[1]);
  assert(repairedTurn.includes("No command was provided"));
  assert(repairedTurn.includes("Put the shell code in command"));
  assert(!repairedTurn.includes("expected string, received undefined"));
});

Deno.test("search_files accepts an empty object as bounded discovery", async () => {
  let received:
    | { command: string | string[]; options?: CommandOptions }
    | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(
      command: string | string[],
      options?: CommandOptions,
    ): Promise<CommandResult> {
      received = { command, options };
      return Promise.resolve({
        exitCode: 0,
        stdout: "./folder\0d\0./file.txt\0f\0",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const tool = (await new FilesystemFeature().createTools()).find((tool) =>
    tool.name === "search_files"
  )!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "openai-compatible",
      model: "test-model",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, {});
  const result = unwrapObservedToolResult(value).result as {
    path: string;
    results: Array<{ path: string; type: string }>;
    truncated: boolean;
  };
  assertEquals(result, {
    path: ".",
    results: [
      { path: "./folder", type: "directory" },
      { path: "./file.txt", type: "file" },
    ],
    truncated: false,
  });
  const command = received?.command;
  assert(Array.isArray(command));
  assertEquals(command.slice(-3), [".", "*", "50"]);
});

Deno.test("HTTP convenience tool returns a bounded neutral response", async () => {
  let received:
    | { command: string | string[]; options?: CommandOptions }
    | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(
      command: string | string[],
      options?: CommandOptions,
    ): Promise<CommandResult> {
      received = { command, options };
      const headers = btoa(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Internal: omitted\r\n",
      );
      const body = btoa("x".repeat(70_000));
      return Promise.resolve({
        exitCode: 0,
        stdout: `200\nhttps://example.test/final\n${headers}\n${body}\n`,
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const tool = (await new HttpFeature().createTools())[0];
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "openai-compatible",
      model: "test-model",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, {
    url: "https://example.test/start",
    method: "post",
    headers: { "content-type": "text/plain" },
    body: "request body",
  });
  const result = unwrapObservedToolResult(value).result as Record<
    string,
    unknown
  >;
  assertEquals(result.status, 200);
  assertEquals(result.url, "https://example.test/final");
  assertEquals(String(result.body).length, 65_536);
  assertEquals(result.truncated, true);
  assertEquals(result.headers, { "content-type": "text/plain" });
  assertEquals(received?.options?.stdin, "request body");
});

Deno.test("ModelRegistry: register and resolve named configs", () => {
  const registry = new ModelRegistry({
    default: { provider: "ollama", model: "qwen3:8b" },
    reviewer: {
      provider: "openai-compatible",
      baseUrl: "http://localhost:8080/v1",
      model: "gpt-4o-mini",
    },
  });

  assert(registry.has("default"));
  assert(!registry.has("missing"));

  assertEquals(registry.get("default"), {
    provider: "ollama",
    model: "qwen3:8b",
  });

  assertEquals(registry.list().sort(), ["default", "reviewer"]);
});

Deno.test("model reasoning config maps to provider request fields", () => {
  const request = { model: "test", messages: [] };
  assertEquals(
    configureModelRequest(request, {
      provider: "ollama",
      model: "qwen3.5:9b",
      reasoning: true,
    }),
    { ...request, think: "medium" },
  );
  assertEquals(
    configureModelRequest(request, {
      provider: "ollama",
      model: "qwen3.5:9b",
      reasoning: false,
      reasoningEffort: "high",
    }),
    { ...request, think: false },
  );
  assertEquals(
    configureModelRequest(request, {
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "reasoning-model",
      reasoningEffort: "high",
    }),
    { ...request, reasoning_effort: "high" },
  );
  assertEquals(
    configureModelRequest(request, {
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "reasoning-model",
      reasoning: true,
      reasoningEffort: "auto",
    }),
    request,
  );
});

Deno.test("normalized context and samplers map to native Ollama options", () => {
  assertEquals(
    configureModelRequest(
      {
        model: "test",
        messages: [],
        temperature: 0.2,
        top_p: 0.8,
        max_output_tokens: 10,
        think: false,
      },
      {
        provider: "ollama",
        model: "qwen3.5:9b",
        context: { window: 32_768, maxOutputTokens: 4_096 },
        sampling: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          minP: 0.05,
          typicalP: 0.95,
          repeatPenalty: 1.1,
          repeatLastN: 64,
          frequencyPenalty: 0.2,
          presencePenalty: 0.1,
          seed: 7,
          stopSequences: ["END"],
        },
      },
    ),
    {
      model: "test",
      messages: [],
      options: {
        num_ctx: 32_768,
        num_predict: 4_096,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        typical_p: 0.95,
        repeat_penalty: 1.1,
        repeat_last_n: 64,
        frequency_penalty: 0.2,
        presence_penalty: 0.1,
        seed: 7,
        stop: ["END"],
      },
    },
  );
});

Deno.test("normalized settings map to OpenAI-compatible request fields", () => {
  assertEquals(
    configureModelRequest(
      { model: "test", messages: [] },
      {
        provider: "openai-compatible",
        baseUrl: "https://example.test/v1",
        model: "model",
        context: { window: 16_384, maxOutputTokens: 2_048 },
        sampling: {
          temperature: 0.4,
          topP: 0.8,
          topK: 20,
          minP: 0.03,
          typicalP: 0.9,
          repeatPenalty: 1.05,
          repeatLastN: 32,
          frequencyPenalty: -0.2,
          presencePenalty: 0.3,
          seed: 9,
          stopSequences: ["STOP"],
        },
      },
    ),
    {
      model: "test",
      messages: [],
      max_tokens: 2_048,
      temperature: 0.4,
      top_p: 0.8,
      top_k: 20,
      min_p: 0.03,
      typical_p: 0.9,
      repetition_penalty: 1.05,
      repeat_last_n: 32,
      frequency_penalty: -0.2,
      presence_penalty: 0.3,
      seed: 9,
      stop: ["STOP"],
    },
  );
});

Deno.test("Ollama model construction uses native chat with mapped options", async () => {
  let receivedPath: string | undefined;
  let receivedBody: Record<string, unknown> | undefined;
  const controller = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, async (request) => {
    receivedPath = new URL(request.url).pathname;
    receivedBody = await request.json() as Record<string, unknown>;
    return Response.json({
      model: "qwen-test",
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
      total_duration: 1,
      load_duration: 1,
      prompt_eval_count: 1,
      prompt_eval_duration: 1,
      eval_count: 1,
      eval_duration: 1,
    });
  });
  try {
    const registry = new ModelRegistry({
      local: {
        provider: "ollama",
        model: "qwen-test",
        baseUrl: `http://127.0.0.1:${server.addr.port}`,
        context: { window: 8_192, maxOutputTokens: 1_024 },
        sampling: { temperature: 0.25, minP: 0.04 },
      },
    });
    const model = await createLanguageModel("local", registry);
    await (model as unknown as {
      doGenerate(options: Record<string, unknown>): Promise<unknown>;
    }).doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }],
    });
    assertEquals(receivedPath, "/api/chat");
    assertEquals(receivedBody?.options, {
      num_ctx: 8_192,
      num_predict: 1_024,
      temperature: 0.25,
      min_p: 0.04,
    });
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("ModelRegistry: get throws for unknown configuration", () => {
  const registry = new ModelRegistry();
  assertThrows(
    () => registry.get("nope"),
    Error,
    "Unknown model configuration",
  );
});

Deno.test("ModelRegistry: rejects malformed config", () => {
  const registry = new ModelRegistry();
  const bad = { provider: "ollama" } as unknown as ModelConfig;
  assertThrows(
    () => registry.register("bad", bad),
    TypeError,
  );
});

Deno.test("ModelRegistry: runtime registration override", () => {
  const registry = new ModelRegistry();
  registry.register("a", { provider: "ollama", model: "x" });
  registry.register("a", { provider: "ollama", model: "y" });
  assertEquals(registry.get("a").model, "y");
});

Deno.test("parseConfig: validates YAML Zoo config", () => {
  const config = parseConfig([
    "taskPrompt: Finish the run.",
    "models:",
    "  default:",
    "    provider: ollama",
    "    model: qwen3:8b",
    "    reasoning: true",
    "    reasoningEffort: high",
    "    context:",
    "      window: 32768",
    "      maxOutputTokens: 4096",
    "    sampling:",
    "      temperature: 0.6",
    "      topP: 0.9",
    "      minP: 0.05",
    "runtime:",
    "  backend: docker",
    "  sharedWorkspace: /tmp/agentzoo/shared",
    "services:",
    "  - coding",
    "templates:",
    "  coding-system: 'You are {agent}.'",
    "agents:",
    "  - type: coding",
    "    count: 2",
    "    model: default",
    "    maxTurns: 42",
    "    sampling:",
    "      temperature: 0.2",
  ].join("\n"));

  assertEquals(config.models?.default, {
    provider: "ollama",
    model: "qwen3:8b",
    reasoning: true,
    reasoningEffort: "high",
    context: { window: 32_768, maxOutputTokens: 4_096 },
    sampling: { temperature: 0.6, topP: 0.9, minP: 0.05 },
  });
  assertEquals(config.runtime.backend, "docker");
  assertEquals(config.taskPrompt, "Finish the run.");
  assertEquals(config.services, ["coding"]);
  assertEquals(config.templates?.["coding-system"], "You are {agent}.");
  assertEquals(config.agents[0].maxTurns, 42);
  assertEquals(config.agents[0].sampling, { temperature: 0.2 });
});

Deno.test("context config validates output space and sampler ranges", () => {
  const prefix =
    `models:\n  local:\n    provider: ollama\n    model: x\nagents:\n  - type: test\n    model: local\n`;
  assertThrows(
    () =>
      parseConfig(
        `${prefix}    context:\n      window: 1024\n      maxOutputTokens: 1024\n`,
      ),
    ConfigValidationError,
    "maxOutputTokens must be smaller than window",
  );
  assertThrows(
    () => parseConfig(`${prefix}    sampling:\n      minP: 1.1\n`),
    ConfigValidationError,
  );
});

Deno.test("context input budget reserves maximum generation length", () => {
  assertEquals(
    modelInputTokenBudget({ window: 32_768, maxOutputTokens: 8_192 }),
    24_576,
  );
  assertEquals(modelInputTokenBudget({ window: 4_096 }), 4_096);
  assertEquals(modelInputTokenBudget(undefined), undefined);
});

Deno.test("initial instructions and objective compose as one labelled user message", () => {
  assertEquals(
    composeInitialPrompt("Inspect carefully.", "Finish the requested work."),
    "INSTRUCTIONS: Inspect carefully.\nOBJECTIVE: Finish the requested work.",
  );
  assertEquals(
    composeInitialPrompt(undefined, "Finish the requested work."),
    "OBJECTIVE: Finish the requested work.",
  );
  assertEquals(
    composeInitialPrompt("Inspect carefully.", undefined),
    "INSTRUCTIONS: Inspect carefully.",
  );
  assertEquals(composeInitialPrompt(), undefined);
});

Deno.test("parseConfig: rejects invalid model configuration", () => {
  assertThrows(
    () =>
      parseConfig(
        "models:\n  default:\n    provider: openai-compatible\n    model: x",
      ),
    ConfigValidationError,
    "Invalid AgentZoo configuration",
  );
});

Deno.test("model API keys resolve from environment during config loading", () => {
  const config = parseConfig(
    `
models:
  local:
    provider: ollama
    model: qwen3.5:9b
    apiKey: ENV[OLLAMA_TOKEN]
  hosted:
    provider: openai-compatible
    model: hosted-model
    baseUrl: https://example.test/v1
    apiKey: literal-key
agents:
  - type: worker
    model: local
`,
    (name) => name === "OLLAMA_TOKEN" ? "resolved-secret" : undefined,
  );
  assertEquals(config.models.local.apiKey, "resolved-secret");
  assertEquals(config.models.hosted.apiKey, "literal-key");
  assertThrows(
    () =>
      resolveConfigEnvironment({
        ...config,
        models: {
          ...config.models,
          local: { ...config.models.local, apiKey: "ENV[OLLAMA_TOKEN]" },
        },
      }, () => undefined),
    ConfigValidationError,
    'Environment variable "OLLAMA_TOKEN" is not set or is empty',
  );
});

Deno.test("loadConfig resolves API keys before returning configuration", async () => {
  const directory = await Deno.makeTempDir({ prefix: "agent-zoo-config-" });
  const path = `${directory}/zoo.yaml`;
  const environmentName = `AGENT_ZOO_TEST_KEY_${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  Deno.env.set(environmentName, "loaded-secret");
  try {
    await Deno.writeTextFile(
      path,
      `
models:
  local:
    provider: ollama
    model: qwen3.5:9b
    apiKey: ENV[${environmentName}]
agents:
  - type: worker
    model: local
`,
    );
    const config = await loadConfig(path);
    assertEquals(config.models.local.apiKey, "loaded-secret");
  } finally {
    Deno.env.delete(environmentName);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("TemplateRegistry: compiles YAML template sources with TextTemplate", async () => {
  const templates = new TemplateRegistry({ greeting: "Hello, {name}!" });
  assertEquals(
    await templates.get("greeting")({ name: "AgentZoo" }),
    "Hello, AgentZoo!",
  );
});

class RoutedService extends Service {
  constructor() {
    super();
  }

  readonly router = new Router().addRoute(
    { method: "GET", path: "/health" },
    () => new Response("ok"),
  );
}

Deno.test("AgentZoo: mounts a service router below its service name", async () => {
  const zoo = new AgentZoo().use("coding", new RoutedService());
  const response = await zoo.router.fetch(
    new Request("http://agent.zoo/services/coding/health"),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
});

Deno.test("runtime: rejects unsafe agent IDs", () => {
  assertAgentId("62d2f5686392");
  assertThrows(() => assertAgentId("../other"), TypeError);
  assertThrows(() => assertAgentId("Agent"), TypeError);
});

Deno.test("SharedWorkspace: cannot resolve paths outside its root", () => {
  const workspace = new SharedWorkspace("C:/agent-zoo/shared");
  assertThrows(() => workspace.resolve("..", "private"), TypeError);
});

Deno.test("AgentZoo system prompt renders enabled feature guidance from Context", async () => {
  const features = new FeatureRegistry<AgentRunDeps>();
  features.register(new ShellFeature());
  features.register(new FilesystemFeature());
  Context.set("features", features);
  try {
    const promptWithFeatures = await buildAgentSystemPrompt(
      ["shell", "filesystem"],
      { shellEnvironment: "You are logged into the shell as root." },
    );
    assert(promptWithFeatures.includes("## Shell"));
    assert(promptWithFeatures.includes("logged into the shell as root"));
    assert(promptWithFeatures.includes("## Filesystem tools"));
    assert(promptWithFeatures.includes("Use apply_patch for related changes"));
  } finally {
    Context.delete("features");
  }

  const prompt = await buildAgentSystemPrompt();
  assert(prompt.includes("`/shared`"));
  assert(
    !/agent[ -]?zoo|other agents|scheduler|experiment|harness/i.test(
      prompt,
    ),
  );
});

Deno.test("AgentZoo system stays in history for taskless startup and idle wake is system history", async () => {
  assertEquals(
    modelSettingsToAISDKOptions({ allowSystemInMessages: true })
      .allowSystemInMessages,
    true,
  );
  const requests: Array<Record<string, unknown>> = [];
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "roles",
    supportedUrls: {},
    doGenerate: (options: Record<string, unknown>) => {
      requests.push(options);
      return Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      });
    },
    doStream: () => {
      throw new Error("not used");
    },
  } as unknown as LanguageModel;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(): Promise<CommandResult> {
      throw new Error("not used");
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const agent = new ZooAgent(
    { id: "alpha", model: "local", systemPrompt: "Configured guidance." },
    runtime,
    new ModelRegistry({
      local: { provider: "ollama", model: "fake" },
    }),
    () => model,
  );
  const loggedRequests: Array<Record<string, unknown>> = [];
  agent.addEventListener("modelrequest", (event) => {
    const detail = (event as CustomEvent).detail as {
      request: Record<string, unknown>;
    };
    loggedRequests.push(detail.request);
  });

  await agent.activate(
    "",
    undefined,
    {
      initialSystemContext:
        "You are in /root.\nIts current contents are:\n\nfile ./a",
      appendPrompt: false,
    },
  );
  await agent.activate(
    "Automated activity update: You have been idle for 17 minutes.",
    undefined,
    { role: "system" },
  );

  const firstPrompt = requests[0].prompt as Array<Record<string, unknown>>;
  const secondPrompt = requests[1].prompt as Array<Record<string, unknown>>;
  assertEquals(
    firstPrompt.filter((message) => message.role === "system").length,
    2,
  );
  assertEquals(firstPrompt.some((message) => message.role === "user"), false);
  assert(JSON.stringify(firstPrompt).includes("## Environment"));
  assert(JSON.stringify(firstPrompt).includes("Configured guidance."));
  assertEquals(
    secondPrompt.filter((message) => message.role === "system").length,
    3,
  );
  assertEquals(secondPrompt.some((message) => message.role === "user"), false);
  assert(JSON.stringify(secondPrompt).includes("## Environment"));
  assert(
    JSON.stringify(secondPrompt.at(-1)).includes(
      "Automated activity update: You have been idle for 17 minutes.",
    ),
  );
  const secondLoggedPrompt = loggedRequests[1].prompt as Array<
    Record<string, unknown>
  >;
  assertEquals(loggedRequests[1].promptMode, "delta");
  assertEquals(loggedRequests[1].systemMode, "omitted-after-initial");
  assertEquals(secondLoggedPrompt.length, 1);
  assertEquals(secondLoggedPrompt[0].role, "system");
  assert(
    JSON.stringify(secondLoggedPrompt).includes(
      "Automated activity update: You have been idle for 17 minutes.",
    ),
  );
  assert(!JSON.stringify(secondLoggedPrompt).includes("## Environment"));

  const promptedAgent = new ZooAgent(
    { id: "beta", model: "local" },
    new class implements RuntimeEnv {
      readonly agentId = "beta";
      prepare(): Promise<void> {
        return Promise.resolve();
      }
      exec(): Promise<CommandResult> {
        throw new Error("not used");
      }
      destroy(): Promise<void> {
        return Promise.resolve();
      }
      reset(): Promise<void> {
        return Promise.resolve();
      }
    }(),
    new ModelRegistry({
      local: { provider: "ollama", model: "fake" },
    }),
    () => model,
  );
  await promptedAgent.activate(
    composeInitialPrompt("Inspect carefully.", "Finish the work.")!,
    undefined,
    {
      role: "user",
      initialSystemContext:
        "You are in /root.\nIts current contents are:\n\nfile ./b",
    },
  );

  const prompted = requests[2].prompt as Array<Record<string, unknown>>;
  assertEquals(prompted.map((message) => message.role), ["system", "user"]);
  assert(JSON.stringify(prompted[0]).includes("## Environment"));
  const promptedUser = JSON.stringify(prompted[1]);
  assert(promptedUser.includes("INSTRUCTIONS: Inspect carefully."));
  assert(promptedUser.includes("OBJECTIVE: Finish the work."));
});

Deno.test("malformed provider tool calls add a system correction on retry", async () => {
  const providerPrompts: unknown[][] = [];
  let call = 0;
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "malformed-tool-retry",
    supportedUrls: {},
    doGenerate: (options: Record<string, unknown>) => {
      providerPrompts.push(options.prompt as unknown[]);
      if (++call === 1) {
        const error = new Error(
          "XML syntax error on line 29: element <function> closed by </parameter>",
        );
        error.name = "AI_APICallError";
        return Promise.reject(error);
      }
      return Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      });
    },
    doStream: () => {
      throw new Error("not used");
    },
  } as unknown as LanguageModel;
  const events: Array<{ kind: string; request?: Record<string, unknown> }> = [];
  const observed = observeLanguageModel(
    model,
    (event) => events.push(event as typeof events[number]),
  );
  const prompt = [
    { role: "system", content: "Base system context." },
    { role: "user", content: [{ type: "text", text: "Work." }] },
  ];
  const request = { prompt };

  await assertRejects(
    () =>
      (observed as unknown as { doGenerate(v: unknown): Promise<unknown> })
        .doGenerate(request),
    Error,
    "XML syntax error",
  );
  await (observed as unknown as {
    doGenerate(v: unknown): Promise<unknown>;
  }).doGenerate(request);

  assertEquals(providerPrompts.length, 2);
  assertEquals(providerPrompts[0], prompt);
  assertEquals(providerPrompts[1].length, prompt.length + 1);
  const repairedSystem = providerPrompts[1].at(-1) as Record<string, unknown>;
  assertEquals(repairedSystem.role, "system");
  assert(String(repairedSystem.content).includes("tool call was malformed"));
  assertEquals(providerPrompts[1][0], prompt[0]);
  assertEquals(
    providerPrompts[1].filter((message) =>
      (message as Record<string, unknown>).role === "system"
    ).length,
    2,
  );
  assertEquals(events.map((event) => event.kind), [
    "request",
    "error",
    "request",
    "response",
  ]);
  assertEquals(events[2].request?.systemMode, "omitted-after-initial");
  assertEquals(
    (events[2].request?.prompt as unknown[]).length,
    1,
  );
  assert(
    JSON.stringify(events[2].request?.prompt).includes(
      "tool call was malformed",
    ),
  );
});

Deno.test("environment observations use readable entry types", async () => {
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(): Promise<CommandResult> {
      return Promise.resolve({
        exitCode: 0,
        stdout: "/root\nroot\nf ./.profile\nd ./project\nl ./current\n",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const agent = new ZooAgent(
    { id: "alpha", model: "local" },
    runtime,
    new ModelRegistry({
      local: { provider: "ollama", model: "test" },
    }),
    () => ({}) as never,
  );
  assertEquals(
    await agent.observeEnvironment(),
    "You are logged into the shell as root.\n\nYour current working directory is /root.\nIts visible contents are:\n\nfile ./.profile\ndirectory ./project\nsymlink ./current",
  );
});

Deno.test("failed activations retain provider messages and pair every tool start with an end", async () => {
  let modelTurn = 0;
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 0, reasoning: 1 },
  };
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "max-turns",
    supportedUrls: {},
    doGenerate: () => {
      const turn = ++modelTurn;
      return Promise.resolve({
        content: [{
          type: "tool-call",
          toolCallId: `provider-call-${turn}`,
          toolName: "work",
          input: JSON.stringify({ turn }),
        }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      });
    },
    doStream: () => {
      throw new Error("not used");
    },
  } as unknown as LanguageModel;
  const tool: ToolDefinition<AgentRunDeps> = {
    name: "work",
    description: "Perform one test action.",
    parameters: z.object({ turn: z.number() }),
    execute: (_context, args) => {
      const turn = (args as { turn: number }).turn;
      return turn === 3
        ? Promise.reject(
          new ToolExecutionError("tool failed deliberately", {
            rawFailure: `failure ${turn}`,
          }),
        )
        : Promise.resolve(observedToolResult(`worked ${turn}`, {
          rawResult: `full result ${turn}`,
        }) as never);
    },
  };
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> {
      return Promise.resolve();
    }
    exec(
      _command: string | string[],
      _options?: CommandOptions,
    ): Promise<CommandResult> {
      throw new Error("not used");
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
    reset(): Promise<void> {
      return Promise.resolve();
    }
  }();
  const registry = new ModelRegistry({
    local: { provider: "ollama", model: "fake" },
  });
  const agent = new ZooAgent(
    { id: "alpha", model: "local", maxTurns: 3 },
    runtime,
    registry,
    () => model,
    [tool],
  );
  const starts: Array<Record<string, unknown>> = [];
  const ends: Array<Record<string, unknown>> = [];
  agent.addEventListener("toolstart", (event) => {
    starts.push((event as CustomEvent).detail);
  });
  agent.addEventListener("toolend", (event) => {
    ends.push((event as CustomEvent).detail);
  });

  const error = await assertRejects(
    () => agent.activate("begin"),
    AgentActivationError,
    "maxTurns",
  );
  assert(error.activation.modelExchanges.length > 1);
  assert(error.activation.messages.length > 1);
  assertEquals(starts.length, ends.length);
  assertEquals(
    starts.map((event) => event.toolCallId),
    ends.map((event) => event.toolCallId),
  );
  assert(ends.some((event) => event.status === "error"));
  assert(starts.every((event) => typeof event.startedAt === "number"));
  assert(ends.every((event) => typeof event.endedAt === "number"));
  assert(ends.every((event) => typeof event.durationMs === "number"));
  assertEquals(starts[0].args, { turn: 1 });
  assertEquals(ends[0].telemetry, { rawResult: "full result 1" });
  assertEquals(
    ends.find((event) => event.status === "error")?.telemetry,
    { rawFailure: "failure 3" },
  );
  assertEquals(
    JSON.stringify(
      new ToolExecutionError("neutral", { hiddenRuntimePath: "C:/host" }),
    ),
    '{"name":"ToolExecutionError"}',
  );
});

// ---------------------------------------------------------------------------
// Configured shell tools
// ---------------------------------------------------------------------------

Deno.test("parseConfig: tools field defaults to empty", () => {
  const config = parseConfig(
    [
      "models:",
      "  local:",
      "    provider: ollama",
      "    model: x",
      "agents:",
      "  - type: test",
      "    model: local",
    ].join("\n"),
  );
  assertEquals(config.tools, {});
});

Deno.test("parseConfig: tools field parses configured shell tools", () => {
  const config = parseConfig(
    [
      "models:",
      "  local:",
      "    provider: ollama",
      "    model: x",
      "agents:",
      "  - type: test",
      "    model: local",
      "tools:",
      "  search_code:",
      "    description: Search the codebase",
      "    command: rg {pattern}",
      "    params:",
      "      pattern:",
      "        type: string",
      "        description: Search pattern",
    ].join("\n"),
  );
  assertEquals(Object.keys(config.tools), ["search_code"]);
  assertEquals(config.tools.search_code.description, "Search the codebase");
  assertEquals(config.tools.search_code.command, "rg {pattern}");
  assertEquals(config.tools.search_code.params.pattern.type, "string");
  assertEquals(config.tools.search_code.params.pattern.required, true);
  assertEquals(config.tools.search_code.params.pattern.array, false);
});

Deno.test("parseConfig: tools param defaults required true and array false", () => {
  const config = parseConfig(
    [
      "models:",
      "  local:",
      "    provider: ollama",
      "    model: x",
      "agents:",
      "  - type: test",
      "    model: local",
      "tools:",
      "  run_thing:",
      "    description: Do the thing",
      "    command: some_command",
      "    params:",
      "      enabled:",
      "        type: boolean",
      "        description: Enable feature",
      "      flags:",
      "        type: string",
      "        array: true",
      "        required: false",
      "        description: Extra args",
    ].join("\n"),
  );
  const params = config.tools.run_thing.params;
  assertEquals(params.enabled.required, true);
  assertEquals(params.enabled.array, false);
  assertEquals(params.flags.required, false);
  assertEquals(params.flags.array, true);
});

Deno.test("parseConfig: rejects tool name with hyphens", () => {
  assertThrows(
    () =>
      parseConfig(
        [
          "models:",
          "  local:",
          "    provider: ollama",
          "    model: x",
          "agents:",
          "  - type: test",
          "    model: local",
          "tools:",
          "  my-tool:",
          "    description: Bad name",
          "    command: echo hi",
        ].join("\n"),
      ),
    ConfigValidationError,
  );
});

Deno.test("parseConfig: rejects tool with missing description", () => {
  assertThrows(
    () =>
      parseConfig(
        [
          "models:",
          "  local:",
          "    provider: ollama",
          "    model: x",
          "agents:",
          "  - type: test",
          "    model: local",
          "tools:",
          "  my_tool:",
          "    command: echo hi",
        ].join("\n"),
      ),
    ConfigValidationError,
  );
});

Deno.test("parseConfig: rejects tool with missing command", () => {
  assertThrows(
    () =>
      parseConfig(
        [
          "models:",
          "  local:",
          "    provider: ollama",
          "    model: x",
          "agents:",
          "  - type: test",
          "    model: local",
          "tools:",
          "  my_tool:",
          "    description: A tool",
        ].join("\n"),
      ),
    ConfigValidationError,
  );
});

Deno.test("parseConfig: rejects invalid param type", () => {
  assertThrows(
    () =>
      parseConfig(
        [
          "models:",
          "  local:",
          "    provider: ollama",
          "    model: x",
          "agents:",
          "  - type: test",
          "    model: local",
          "tools:",
          "  my_tool:",
          "    description: A tool",
          "    command: echo hi",
          "    params:",
          "      foo:",
          "        type: object",
          "        description: Bad type",
        ].join("\n"),
      ),
    ConfigValidationError,
  );
});

Deno.test("ShellFeature: emits only shell when no configured tools", async () => {
  const tools = await new ShellFeature().createTools();
  assertEquals(tools.length, 5);
  assertEquals(tools[0].name, "shell");
  const background = [
    "start_background",
    "stop_background",
    "get_background",
    "send_background",
  ];
  for (const name of background) {
    assert(tools.some((t) => t.name === name), `missing ${name}`);
  }
});

Deno.test("ShellFeature: emits raw shell plus configured tools", async () => {
  const tools = await new ShellFeature({
    search_code: {
      command: "rg {pattern}",
      description: "Search code",
      params: {
        pattern: { type: "string", required: true, array: false, description: "Pattern" },
      },
    },
    run_linter: {
      command: "eslint {file}",
      description: "Run linter",
      params: {
        file: { type: "string", required: true, array: false, description: "File" },
      },
    },
  }).createTools();
  assertEquals(tools.length, 7);
  assertEquals(tools[0].name, "shell");
  assertEquals(tools[1].name, "search_code");
  assertEquals(tools[2].name, "run_linter");
  const background = [
    "start_background",
    "stop_background",
    "get_background",
    "send_background",
  ];
  for (const name of background) {
    assert(tools.some((t) => t.name === name), `missing ${name}`);
  }
});

Deno.test("ShellFeature: configured tool Zod schema matches config", async () => {
  const tools = await new ShellFeature({
    search_code: {
      command: "rg {pattern}",
      description: "Search code",
      params: {
        pattern: { type: "string", required: true, array: false, description: "Pattern" },
        hidden: { type: "boolean", required: false, array: false, description: "Hidden" },
        max_results: { type: "number", required: false, array: false, description: "Max" },
      },
    },
  }).createTools();
  const searchTool = tools.find((t) => t.name === "search_code")!;
  const schema = z.toJSONSchema(searchTool.parameters) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  assertEquals(schema.required, ["pattern"]);
  assert("pattern" in (schema.properties ?? {}));
  assert("hidden" in (schema.properties ?? {}));
  assert("max_results" in (schema.properties ?? {}));
  assert(searchTool.description === "Search code");
});

Deno.test("ShellFeature: configured tool with array param produces Zod array", async () => {
  const tools = await new ShellFeature({
    run_cmd: {
      command: "echo {#FOR flag IN flags}{flag}{#END}",
      description: "Run with flags",
      params: {
        flags: { type: "string", required: true, array: true, description: "Flags" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "run_cmd")!;
  const schema = z.toJSONSchema(tool.parameters) as {
    properties?: Record<string, { type?: string; items?: unknown }>;
  };
  const flagsProp = schema.properties?.flags as { type?: string; items?: unknown };
  assertEquals(flagsProp.type, "array");
  assert(flagsProp.items !== undefined);
});

Deno.test("ShellFeature: configured tool validate rejects missing required params", async () => {
  const tools = await new ShellFeature({
    run_cmd: {
      command: "echo {pattern}",
      description: "Run",
      params: {
        pattern: { type: "string", required: true, array: false, description: "Pattern" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "run_cmd")!;
  const result = tool.parameters.safeParse({});
  assertEquals(result.success, false);
});

Deno.test("ShellFeature: configured tool validates optional params", async () => {
  const tools = await new ShellFeature({
    run_cmd: {
      command: "echo {pattern}",
      description: "Run",
      params: {
        pattern: { type: "string", required: true, array: false, description: "Pattern" },
        verbose: { type: "boolean", required: false, array: false, description: "Verbose" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "run_cmd")!;
  // Without optional param should succeed
  const result = tool.parameters.safeParse({ pattern: "test" });
  assert(result.success);
  // With optional param should also succeed
  const withVerbose = tool.parameters.safeParse({ pattern: "test", verbose: true });
  assert(withVerbose.success);
});

Deno.test("ShellFeature: configured tool renders command via TextTemplate", async () => {
  let receivedCommand: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(
      command: string | string[],
    ): Promise<CommandResult> {
      receivedCommand = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();

  const tools = await new ShellFeature({
    rg_search: {
      command: "rg {pattern}\n{#IF hidden}\n--hidden\n{#END}",
      description: "Search",
      params: {
        pattern: { type: "string", required: true, array: false, description: "Pattern" },
        hidden: { type: "boolean", required: false, array: false, description: "Hidden" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "rg_search")!;

  // Execute with hidden=true
  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { pattern: "foo", hidden: true });
  assert(receivedCommand!.includes("'foo'"));
  assert(receivedCommand!.includes("--hidden"));

  // Execute with hidden=false
  receivedCommand = undefined;
  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { pattern: "bar" });
  assert(receivedCommand!.includes("'bar'"));
  assert(!receivedCommand!.includes("--hidden"));
});

Deno.test("ShellFeature: configured tool shell-escapes string params", async () => {
  let receivedCommand: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(
      command: string | string[],
    ): Promise<CommandResult> {
      receivedCommand = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();

  const tools = await new ShellFeature({
    echo_tool: {
      command: "echo {msg}",
      description: "Echo",
      params: {
        msg: { type: "string", required: true, array: false, description: "Message" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "echo_tool")!;

  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { msg: "hello world" });
  // Should be shell-quoted
  assert(receivedCommand!.includes("'hello world'"));
});

Deno.test("ShellFeature: configured tool preserves array order for {#FOR}", async () => {
  let receivedCommand: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(
      command: string | string[],
    ): Promise<CommandResult> {
      receivedCommand = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();

  const tools = await new ShellFeature({
    multi_echo: {
      command: "echo\n{#FOR item IN items}\n{item}\n{#END}",
      description: "Multi echo",
      params: {
        items: { type: "string", required: true, array: true, description: "Items" },
      },
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "multi_echo")!;

  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { items: ["foo", "hello world", "bar"] });
  // Each item individually quoted and rendered in order
  assert(receivedCommand!.includes("'foo'"));
  assert(receivedCommand!.includes("'hello world'"));
  assert(receivedCommand!.includes("'bar'"));
});

Deno.test("ShellFeature: configured tool returns model-facing result", async () => {
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(): Promise<CommandResult> {
      return Promise.resolve({
        exitCode: 0,
        stdout: "result-data",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();

  const tools = await new ShellFeature({
    simple: {
      command: "echo done",
      description: "Simple tool",
      params: {},
    },
  }).createTools();
  const tool = tools.find((t) => t.name === "simple")!;

  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, {});
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdout, "result-data");
  assertEquals(result.timedOut, false);
});

Deno.test("ShellFeature: emits background management tools", async () => {
  const tools = await new ShellFeature().createTools();
  const names = tools.map((t) => t.name);
  assert(names.includes("shell"));
  assert(names.includes("start_background"));
  assert(names.includes("stop_background"));
  assert(names.includes("get_background"));
  assert(names.includes("send_background"));
});

Deno.test("ShellFeature: start_background builds a tmux new-session command", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      received = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "start_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server", command: "python3 -m http.server 8000" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.status, "started");
  assertEquals(result.name, "server");
  assert(received!.startsWith("tmux new-session -d"));
  assert(received!.includes("-s 'server'"));
  assert(received!.includes("-c '/root'"));
  assert(received!.includes("bash -c 'python3 -m http.server 8000'"));
});

Deno.test("ShellFeature: start_background shell-escapes the command", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      received = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "start_background")!;
  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "weird", command: "echo 'hi'" });
  // Single quotes inside the command must be escaped for the bash -c wrapper.
  assert(received!.includes("'\\''"), `expected escaped quote, got: ${received}`);
});

Deno.test("ShellFeature: stop_background kills the session", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      received = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "stop_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.status, "stopped");
  assert(received!.includes("tmux kill-session -t 'server'"));
});

Deno.test("ShellFeature: stop_background reports not_found", async () => {
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(): Promise<CommandResult> {
      return Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "session not found: server",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "stop_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.status, "not_found");
});

Deno.test("ShellFeature: get_background returns output and liveness", async () => {
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      const cmd = Array.isArray(command) ? command.join(" ") : command;
      if (cmd.includes("has-session")) {
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: false,
        });
      }
      if (cmd.includes("capture-pane")) {
        return Promise.resolve({
          exitCode: 0,
          stdout: "listening on 8000\n",
          stderr: "",
          timedOut: false,
          aborted: false,
        });
      }
      if (cmd.includes("list-panes")) {
        return Promise.resolve({
          exitCode: 0,
          stdout: "0",
          stderr: "",
          timedOut: false,
          aborted: false,
        });
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "unknown",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "get_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.found, true);
  assertEquals(result.alive, true);
  assertEquals(result.output, "listening on 8000\n");
});

Deno.test("ShellFeature: get_background reports not found", async () => {
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      const cmd = Array.isArray(command) ? command.join(" ") : command;
      if (cmd.includes("has-session")) {
        return Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "session not found",
          timedOut: false,
          aborted: false,
        });
      }
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "get_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "ghost" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.found, false);
  assertEquals(result.alive, false);
});

Deno.test("ShellFeature: get_background honours the n line limit", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      const cmd = Array.isArray(command) ? command.join(" ") : command;
      if (cmd.includes("has-session")) {
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: false,
        });
      }
      if (cmd.includes("capture-pane")) {
        received = cmd;
        return Promise.resolve({
          exitCode: 0,
          stdout: "tail\n",
          stderr: "",
          timedOut: false,
          aborted: false,
        });
      }
      return Promise.resolve({
        exitCode: 0,
        stdout: "0",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "get_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server", last: 50 });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.found, true);
  assertEquals(result.output, "tail\n");
  // -S -50 captures the last 50 lines instead of all history.
  assert(received!.includes("capture-pane -t 'server' -p -S -50"));
});

Deno.test("ShellFeature: send_background sends keys with Enter", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      received = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "send_background")!;
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server", input: "GET /" });
  const result = unwrapObservedToolResult(value).result as Record<string, unknown>;
  assertEquals(result.status, "sent");
  assert(received!.includes("tmux send-keys -t 'server' 'GET /' Enter"));
});

Deno.test("ShellFeature: send_background omits Enter when enter is false", async () => {
  let received: string | undefined;
  const runtime = new class implements RuntimeEnv {
    readonly agentId = "alpha";
    prepare(): Promise<void> { return Promise.resolve(); }
    exec(command: string | string[]): Promise<CommandResult> {
      received = Array.isArray(command) ? command.join(" ") : command;
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    }
    destroy(): Promise<void> { return Promise.resolve(); }
    reset(): Promise<void> { return Promise.resolve(); }
  }();
  const tools = await new ShellFeature().createTools();
  const tool = tools.find((t) => t.name === "send_background")!;
  await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never, { name: "server", input: "GET /", enter: false });
  assert(received!.includes("tmux send-keys -t 'server' 'GET /'"));
  assert(!received!.includes("Enter"));
});

Deno.test("ShellFeature: feature gating — no shell feature means no configured tools", async () => {
  const features = new FeatureRegistry<AgentRunDeps>();
  features.register(new ShellFeature({
    custom_tool: {
      command: "echo hi",
      description: "Custom",
      params: {},
    },
  }));
  features.register(new FilesystemFeature());
  Context.set("features", features);
  try {
    // Agent with only filesystem — should not get shell or custom_tool
    const filesystemOnly = features.get("filesystem");
    const fsTools = await filesystemOnly.createTools?.() ?? [];
    const fsNames = fsTools.map((t) => t.name);
    assert(!fsNames.includes("shell"));
    assert(!fsNames.includes("custom_tool"));

    // Agent with shell — should get shell + custom_tool
    const shellFeature = features.get("shell");
    const shellTools = await shellFeature.createTools?.() ?? [];
    const shellNames = shellTools.map((t) => t.name);
    assert(shellNames.includes("shell"));
    assert(shellNames.includes("custom_tool"));
  } finally {
    Context.delete("features");
  }
});
