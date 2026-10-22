import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "@std/assert";
import type { LanguageModel } from "npm:ai@^6";
import {
  AgentActivationError,
  AgentZoo,
  buildAgentZoo,
  parseConfig,
  SharedWorkspace,
  type ZooActor,
  ZooAgent,
} from "../mod.ts";
import type {
  AgentActivationOptions,
  AgentActivationResult,
  AgentConfig,
  CommandOptions,
  CommandResult,
  RuntimeEnv,
  RuntimeManager,
} from "../types.ts";

class FakeActor extends EventTarget implements ZooActor {
  readonly prompts: string[] = [];
  readonly promptRoles: ("user" | "system")[] = [];
  readonly activationOptions: AgentActivationOptions[] = [];
  prepared = 0;
  stopped = 0;
  observations = 0;

  constructor(
    readonly id: string,
    readonly config: Readonly<AgentConfig>,
    readonly results: AgentActivationResult[],
    readonly onActivate?: () => void,
  ) {
    super();
  }

  prepare(): Promise<void> {
    this.prepared++;
    return Promise.resolve();
  }

  activate(
    prompt: string,
    _signal?: AbortSignal,
    options: AgentActivationOptions = {},
  ): Promise<AgentActivationResult> {
    this.prompts.push(prompt);
    this.promptRoles.push(options.role ?? "user");
    this.activationOptions.push(options);
    this.onActivate?.();
    return Promise.resolve(this.results.shift() ?? { outcome: "yield" });
  }

  observeEnvironment(): Promise<string> {
    this.observations++;
    return Promise.resolve(
      `You are in /root.\nIts current contents are:\n\nfile ./real-file`,
    );
  }

  stop(): Promise<void> {
    this.stopped++;
    return Promise.resolve();
  }
}

async function resolveConfiguredSystemPrompt(agent: ZooActor | undefined) {
  const prompt = agent?.config.systemPrompt;
  return (typeof prompt === "function" ? await prompt() : prompt)?.trim();
}

Deno.test("runner preserves actors, tracks idle time, wakes with time, and completes by agreement", async () => {
  let now = 10_000;
  const alpha = new FakeActor(
    "alpha",
    {
      id: "alpha",
      name: "Alpha",
      type: "coding",
      model: "local",
      features: ["shell"],
    },
    [{ outcome: "yield" }, { outcome: "complete" }],
    () => now += 1_000,
  );
  const beta = new FakeActor(
    "beta",
    { id: "beta", name: "Beta", type: "research", model: "local" },
    [{ outcome: "yield" }, { outcome: "complete" }],
    () => now += 1_000,
  );
  const zoo = new AgentZoo({
    initialPrompts: { alpha: "Do the configured task." },
    clock: () => now,
    random: () => 0,
  });
  zoo.registerAgent(alpha).registerAgent(beta);
  await zoo.run();

  assertEquals(alpha.prompts[0], "Do the configured task.");
  assertEquals(alpha.promptRoles[0], "user");
  assertEquals(alpha.observations, 1);
  assertMatch(
    alpha.activationOptions[0].initialSystemContext ?? "",
    /real-file/,
  );
  assertEquals(alpha.activationOptions[0].appendPrompt, true);
  assertEquals(beta.observations, 0);
  assertEquals(beta.prompts[0], "");
  assertEquals(beta.activationOptions[0].initialSystemContext, undefined);
  assertEquals(beta.activationOptions[0].appendPrompt, false);
  assertMatch(
    alpha.prompts[1],
    /^Automated activity update: You have been idle for 1 seconds\.$/,
  );
  assertEquals(alpha.activationOptions[1].initialSystemContext, undefined);
  assertEquals(alpha.activationOptions[1].appendPrompt, true);
  assertEquals(alpha.promptRoles[1], "system");
  assertEquals(
    alpha.prompts.length,
    2,
    "the same persistent actor was reactivated",
  );
  assertEquals(zoo.state().state, "completed");
  assert(
    zoo.state().recentActivity.some((event) => event.kind === "agent:yield"),
  );
  const namedWake = zoo.state().recentActivity.find((event) =>
    event.kind === "agent:wake" && event.agentId === "alpha"
  );
  assertEquals(namedWake?.agentName, "Alpha");
  assertMatch(namedWake?.message ?? "", /^Alpha \(alpha\) woke after /);
  assertEquals(
    zoo.state().recentActivity.filter((event) =>
      event.kind === "agent:complete"
    ).length,
    2,
  );
  assertEquals(alpha.stopped, 1);
  assertEquals(beta.stopped, 1);
});

Deno.test("scheduler excludes the yielding actor and otherwise follows injected randomness", async () => {
  const wakeOrder: string[] = [];
  const random = [0, 0.999, 0];
  const zoo = new AgentZoo({ random: () => random.shift() ?? 0 });
  for (const id of ["alpha", "beta", "gamma"]) {
    zoo.registerAgent(
      new FakeActor(
        id,
        { id, model: "local" },
        [{ outcome: "complete" }],
      ),
    );
  }
  zoo.addEventListener("agent:wake", (event) => {
    wakeOrder.push((event as CustomEvent).detail.agentId);
  });
  await zoo.run();
  assertEquals(wakeOrder, ["alpha", "gamma", "beta"]);
});

Deno.test("a sole yielded participant remains idle until externally stopped", async () => {
  let activations = 0;
  const actor = new FakeActor(
    "alpha",
    { id: "alpha", model: "local" },
    [{ outcome: "yield" }],
    () => activations++,
  );
  const zoo = new AgentZoo({ completionEnabled: false });
  zoo.registerAgent(actor);
  zoo.addEventListener("agent:yield", () => {
    queueMicrotask(() => void zoo.stop("test stop"));
  });

  await zoo.run();

  assertEquals(activations, 1);
  assertEquals(actor.prompts.length, 1);
  assertEquals(
    zoo.state().recentActivity.filter((event) => event.kind === "agent:wake")
      .length,
    1,
  );
  assertEquals(zoo.state().stopReason, "test stop");
});

Deno.test("completion-disabled zoo ignores completion votes and stops externally", async () => {
  let activations = 0;
  const zoo = new AgentZoo({ completionEnabled: false });
  for (const id of ["alpha", "beta"]) {
    zoo.registerAgent(
      new FakeActor(
        id,
        { id, model: "local" },
        [{ outcome: "complete" }, { outcome: "complete" }],
        () => {
          activations++;
          if (activations === 3) {
            queueMicrotask(() => void zoo.stop("test stop"));
          }
        },
      ),
    );
  }
  await zoo.run();
  assertEquals(activations, 3);
  assertEquals(zoo.state().state, "stopped");
  assertEquals(zoo.state().stopReason, "test stop");
  assertEquals(
    zoo.state().recentActivity.some((event) => event.kind === "agent:complete"),
    false,
  );
});

Deno.test("runner retains failed transcripts and continues another agent", async () => {
  const activation = {
    prompt: "original input",
    promptRole: "user" as const,
    systemPrompt: "system input",
    messages: [{ role: "assistant", content: "partial reasoning" }],
    modelExchanges: [{
      callId: "model:1",
      startedAt: 1,
      endedAt: 2,
      request: { prompt: "original input" },
      response: { content: "partial reasoning" },
    }],
  };
  const actor = new FakeActor(
    "alpha",
    { id: "alpha", model: "local" },
    [],
    () => {
      throw new AgentActivationError(
        new Error("failed activation"),
        activation,
      );
    },
  );
  const survivor = new FakeActor(
    "beta",
    { id: "beta", model: "local" },
    [{ outcome: "complete" }],
  );
  const zoo = new AgentZoo({
    initialPrompts: { alpha: "original input" },
    random: () => 0,
  });
  zoo.registerAgent(actor).registerAgent(survivor);
  await zoo.run();

  const event = zoo.state().recentActivity.find((item) =>
    item.kind === "agent:error"
  );
  const detail = event?.detail as { activation?: typeof activation };
  assertEquals(detail.activation?.messages, activation.messages);
  assertEquals(
    detail.activation?.modelExchanges,
    activation.modelExchanges,
  );
  assertEquals(survivor.prompts.length, 1);
  assertEquals(zoo.state().state, "completed");
});

Deno.test("shutdown still disposes runtime when an actor stop fails", async () => {
  let disposed = 0;
  const actor = new class extends FakeActor {
    override stop(): Promise<void> {
      this.stopped++;
      return Promise.reject(new Error("stop failed"));
    }
  }("alpha", { id: "alpha", model: "local" }, []);
  const zoo = new AgentZoo({
    dispose: () => {
      disposed++;
      return Promise.resolve();
    },
  });
  zoo.registerAgent(actor);

  await assertRejects(
    () => zoo.stop("test"),
    AggregateError,
    "shutdown failed",
  );
  assertEquals(actor.stopped, 1);
  assertEquals(disposed, 1);
});

class FakeEnv implements RuntimeEnv {
  prepared = 0;
  destroyed = 0;
  readonly commands: Array<{
    command: string | string[];
    options?: CommandOptions;
  }> = [];
  constructor(readonly agentId: string) {}
  prepare(): Promise<void> {
    this.prepared++;
    return Promise.resolve();
  }
  exec(
    command: string | string[],
    options?: CommandOptions,
  ): Promise<CommandResult> {
    this.commands.push({ command, options });
    return Promise.resolve({
      exitCode: 0,
      stdout: "/root\nf ./observed\n",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  }
  destroy(): Promise<void> {
    this.destroyed++;
    return Promise.resolve();
  }
  reset(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeRuntime implements RuntimeManager {
  readonly envs = new Map<string, FakeEnv>();
  prepare(): Promise<void> {
    return Promise.resolve();
  }
  createEnv(id: string): Promise<RuntimeEnv> {
    const env = new FakeEnv(id);
    this.envs.set(id, env);
    return Promise.resolve(env);
  }
  getEnv(id: string): RuntimeEnv | undefined {
    return this.envs.get(id);
  }
  destroyEnv(id: string): Promise<void> {
    return this.envs.get(id)?.destroy() ?? Promise.resolve();
  }
}

Deno.test("validated config builds a heterogeneous real ZooAgent population", async () => {
  const runtime = new FakeRuntime();
  const config = parseConfig(`
models:
  local:
    provider: ollama
    model: qwen-test
    context:
      window: 32768
      maxOutputTokens: 4096
    sampling:
      temperature: 0.7
      topP: 0.9
      minP: 0.05
taskPrompt: Complete the whole run.
templates:
  coding: |-
    {#IF name}
    You are {name} of type {type}.
    {#ELSE}
    You are {agent} of type {type}.
    {#END}
runtime:
  backend: docker
  sharedWorkspace: shared
agents:
  - type: coding
    name: Rowan
    count: 2
    model: local
    system: coding
    prompt: configured task
    maxTurns: 77
    context:
      maxOutputTokens: 2048
    sampling:
      temperature: 0.2
      topK: 30
    features: []
  - type: research
    model: local
    system: coding
    features: []
completion:
  enabled: false
`);
  const built = await buildAgentZoo(config, {
    baseDir: "C:/agent-zoo-test",
    workspaceFactory: (root) =>
      new class extends SharedWorkspace {
        override prepare(): Promise<void> {
          return Promise.resolve();
        }
      }(root),
    runtimeFactory: () => runtime,
    modelFactory: () => ({} as LanguageModel),
  });
  assertEquals(built.zoo.agents(), [
    "446eb29a731d",
    "8e71e6d8a598",
    "62d2f5686392",
  ]);
  assertEquals(runtime.envs.size, 3);
  assertEquals(runtime.envs.get("446eb29a731d")?.commands.slice(0, 2), [
    {
      command: ["git", "config", "--global", "user.name", "Rowan"],
      options: { env: { HOME: "/root" } },
    },
    {
      command: [
        "git",
        "config",
        "--global",
        "user.email",
        "rowan@446eb29a731d.local",
      ],
      options: { env: { HOME: "/root" } },
    },
  ]);
  assertEquals(built.zoo.getAgent("446eb29a731d")?.config.type, "coding");
  assertEquals(built.zoo.getAgent("446eb29a731d")?.config.name, "Rowan");
  assertEquals(
    await resolveConfiguredSystemPrompt(built.zoo.getAgent("446eb29a731d")),
    "You are Rowan of type coding.",
  );
  assertEquals(built.zoo.getAgent("446eb29a731d")?.config.maxTurns, 77);
  assertEquals(built.zoo.getAgent("446eb29a731d")?.config.context, {
    window: 32_768,
    maxOutputTokens: 2_048,
  });
  assertEquals(built.zoo.getAgent("446eb29a731d")?.config.sampling, {
    temperature: 0.2,
    topP: 0.9,
    minP: 0.05,
    topK: 30,
  });
  assertEquals(built.zoo.getAgent("62d2f5686392")?.config.maxTurns, 100);
  assertEquals(built.zoo.getAgent("62d2f5686392")?.config.context, {
    window: 32_768,
    maxOutputTokens: 4_096,
  });
  assertEquals(built.zoo.getAgent("62d2f5686392")?.config.sampling, {
    temperature: 0.7,
    topP: 0.9,
    minP: 0.05,
  });
  assertEquals(built.zoo.getAgent("62d2f5686392")?.config.name, undefined);
  assertEquals(
    await resolveConfiguredSystemPrompt(built.zoo.getAgent("62d2f5686392")),
    "You are 62d2f5686392 of type research.",
  );
  assertEquals(built.zoo.getAgent("62d2f5686392")?.config.features, []);
  assertEquals(built.templates.list(), ["coding"]);
  assertEquals(built.models.list(), ["local"]);
  assertEquals(
    config.taskPrompt,
    "Complete the whole run.",
  );
  await built.zoo.stop("test cleanup");
});

Deno.test("population names fan out and same-type IDs continue across entries", async () => {
  const runtime = new FakeRuntime();
  const config = parseConfig(`
models:
  local:
    provider: ollama
    model: qwen-test
templates:
  identity: |-
    {#IF name}
    You are {name}.
    {#ELSE}
    You are {agent}.
    {#END}
agents:
  - type: research
    names: [Rowan, Rowan]
    model: local
    system: identity
    features: []
  - type: research
    name: Alice
    count: 2
    model: local
    system: identity
    features: []
completion:
  enabled: false
`);
  const built = await buildAgentZoo(config, {
    baseDir: "C:/population-name-test",
    workspaceFactory: (root) =>
      new class extends SharedWorkspace {
        override prepare(): Promise<void> {
          return Promise.resolve();
        }
      }(root),
    runtimeFactory: () => runtime,
    modelFactory: () => ({} as LanguageModel),
  });
  try {
    assertEquals(built.zoo.agents(), [
      "62d2f5686392",
      "9ef0b7db0217",
      "c4842989967d",
      "1792e8014809",
    ]);
    assertEquals(
      built.zoo.state().agents.map(({ id, name }) => ({ id, name })),
      [
        { id: "62d2f5686392", name: "Rowan" },
        { id: "9ef0b7db0217", name: "Rowan" },
        { id: "c4842989967d", name: "Alice" },
        { id: "1792e8014809", name: "Alice" },
      ],
    );
    assertEquals(
      await resolveConfiguredSystemPrompt(built.zoo.getAgent("9ef0b7db0217")),
      "You are Rowan.",
    );
    assertEquals(
      await resolveConfiguredSystemPrompt(built.zoo.getAgent("1792e8014809")),
      "You are Alice.",
    );
  } finally {
    await built.zoo.stop("test cleanup");
  }
});

Deno.test("population names reject competing name and size fields", () => {
  const prefix = `
models:
  local:
    provider: ollama
    model: qwen-test
agents:
  - type: research
    model: local
`;
  assertThrows(() =>
    parseConfig(`${prefix}    name: Rowan\n    names: [Alice]\n`)
  );
  assertThrows(() =>
    parseConfig(`${prefix}    count: 2\n    names: [Alice]\n`)
  );
});

Deno.test("feature configuration grants optional HTTP and preserves canonical built-in tool order", async () => {
  const runtime = new FakeRuntime();
  const config = parseConfig(`
models:
  local:
    provider: ollama
    model: qwen-test
agents:
  - type: default
    model: local
  - type: networked
    model: local
    features: [http, filesystem, shell]
completion:
  enabled: false
`);
  const built = await buildAgentZoo(config, {
    baseDir: "C:/feature-test",
    workspaceFactory: (root) =>
      new class extends SharedWorkspace {
        override prepare(): Promise<void> {
          return Promise.resolve();
        }
      }(root),
    runtimeFactory: () => runtime,
    modelFactory: () => ({} as LanguageModel),
  });
  try {
    assertEquals((built.zoo.getAgent("654ddb14e1dc") as ZooAgent).toolNames, [
      "shell",
      "bash",
      "apply_patch",
      "write_file",
      "edit_file",
      "read_file",
      "list_directory",
      "search_files",
      "start_background",
      "stop_background",
      "get_background",
      "send_background",
      "yield",
    ]);
    assertEquals((built.zoo.getAgent("6d58953e1a16") as ZooAgent).toolNames, [
      "shell",
      "bash",
      "apply_patch",
      "write_file",
      "edit_file",
      "read_file",
      "list_directory",
      "search_files",
      "http_request",
      "start_background",
      "stop_background",
      "get_background",
      "send_background",
      "yield",
    ]);
    assertEquals(built.zoo.getAgent("6d58953e1a16")?.config.features, [
      "shell",
      "filesystem",
      "http",
    ]);
  } finally {
    await built.zoo.stop("test cleanup");
  }
});
