import { assert, assertEquals } from "@std/assert";
import type { ToolDefinition } from "@vibesjs/sdk";
import {
  type AgentRunDeps,
  DockerRuntimeManager,
  TerminalFeature,
  unwrapObservedToolResult,
} from "../mod.ts";
import type { CommandResult, RuntimeEnv } from "../types.ts";

let dockerIntegrationEnabled = false;
try {
  dockerIntegrationEnabled =
    Deno.env.get("AGENT_ZOO_TERMINAL_INTEGRATION") === "1";
} catch {
  // Unit tests do not need environment permission.
}

class TerminalRuntime implements RuntimeEnv {
  readonly agentId = "alpha";
  readonly commands: string[] = [];
  exists = false;
  capture = "ready\n";

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  exec(command: string | string[]): Promise<CommandResult> {
    const text = Array.isArray(command) ? command.join(" ") : command;
    this.commands.push(text);
    if (text.includes("has-session")) {
      return Promise.resolve(result(this.exists ? 0 : 1));
    }
    if (text.includes("capture-pane")) {
      return Promise.resolve(result(0, this.capture));
    }
    if (text.includes("list-sessions")) {
      return Promise.resolve(result(0, "agent-zoo-terminal-game\nother\n"));
    }
    return Promise.resolve(result(0));
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }

  reset(): Promise<void> {
    return Promise.resolve();
  }
}

function result(exitCode: number, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr, timedOut: false, aborted: false };
}

function context(runtime: RuntimeEnv) {
  return {
    deps: {
      agentId: runtime.agentId,
      provider: "test",
      model: "test",
      runtime,
      cwd: "/root",
      control: {},
    },
  } as never;
}

async function terminalTools(): Promise<
  Map<string, ToolDefinition<AgentRunDeps>>
> {
  return new Map(
    (await new TerminalFeature().createTools()).map((
      tool,
    ) => [tool.name, tool]),
  );
}

Deno.test("TerminalFeature exposes the persistent terminal surface", async () => {
  const tools = await terminalTools();
  assertEquals([...tools.keys()], [
    "terminal_create",
    "terminal_list",
    "terminal_read",
    "terminal_send",
    "terminal_keys",
    "terminal_clear",
    "terminal_kill",
  ]);
});

Deno.test("terminal_create starts a direct program with agent-local tmux state", async () => {
  const runtime = new TerminalRuntime();
  const create = (await terminalTools()).get("terminal_create")!;
  const value = await create.execute(context(runtime), {
    name: "game",
    command: "python3",
    args: ["pong.py"],
    cwd: "/shared/game",
    historyLimit: 2000,
  });
  const output = unwrapObservedToolResult(value).result as Record<
    string,
    unknown
  >;
  assertEquals(output.status, "created");
  assert(
    runtime.commands.some((command) =>
      command.includes("tmux set-option -g history-limit 2000")
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes(
        "tmux new-session -d -s 'agent-zoo-terminal-game' -c '/shared/game'",
      )
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes("remain-on-exit on")
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes("respawn-pane -k -t 'agent-zoo-terminal-game'") &&
      command.includes("pong.py")
    ),
  );
});

Deno.test("terminal interaction separates literal text, symbolic keys, and inert capture", async () => {
  const runtime = new TerminalRuntime();
  runtime.exists = true;
  const tools = await terminalTools();
  await tools.get("terminal_send")!.execute(context(runtime), {
    name: "game",
    text: "hello world",
  });
  await tools.get("terminal_keys")!.execute(context(runtime), {
    name: "game",
    keys: ["Up", "Enter"],
  });
  const read = await tools.get("terminal_read")!.execute(context(runtime), {
    name: "game",
    start: -20,
  });
  const output = unwrapObservedToolResult(read).result as Record<
    string,
    unknown
  >;
  assertEquals(output.output, "ready\n");
  assert(
    runtime.commands.some((command) =>
      command.includes(
        "tmux send-keys -l -t 'agent-zoo-terminal-game' 'hello world'",
      )
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes("tmux send-keys -t 'agent-zoo-terminal-game' Enter")
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes(
        "tmux send-keys -t 'agent-zoo-terminal-game' 'Up' 'Enter'",
      )
    ),
  );
  assert(
    runtime.commands.some((command) =>
      command.includes("capture-pane -p -S -20") && !command.includes(" -e")
    ),
  );
});

Deno.test("terminal_list hides unrelated sessions and missing sessions are model-visible", async () => {
  const runtime = new TerminalRuntime();
  const tools = await terminalTools();
  const listed = unwrapObservedToolResult(
    await tools.get("terminal_list")!.execute(context(runtime), {}),
  ).result as { terminals: string[] };
  assertEquals(listed.terminals, ["game"]);
  runtime.exists = false;
  const missing = unwrapObservedToolResult(
    await tools.get("terminal_kill")!.execute(context(runtime), {
      name: "game",
    }),
  ).result as Record<string, unknown>;
  assertEquals(missing.status, "not_found");
});

Deno.test({
  name:
    "terminal feature runs an interactive program in one isolated Docker runtime",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "agent-zoo-terminal-live-" });
    const runtime = new DockerRuntimeManager(
      root,
      "agent-runtime:dev",
      undefined,
      {
        project: `${root}/config.yaml`,
      },
    );
    try {
      const env = await runtime.createEnv("terminal-live");
      const tools = await terminalTools();
      const toolContext = context(env);
      const created = unwrapObservedToolResult(
        await tools.get("terminal_create")!.execute(toolContext, {
          name: "echo",
          command: "cat",
        }),
      ).result as Record<string, unknown>;
      assertEquals(created.status, "created");
      await tools.get("terminal_send")!.execute(toolContext, {
        name: "echo",
        text: "TERMINAL_LIVE_OK",
      });
      const read = unwrapObservedToolResult(
        await tools.get("terminal_read")!.execute(toolContext, {
          name: "echo",
        }),
      ).result as Record<string, unknown>;
      assert(
        String(read.output).includes("TERMINAL_LIVE_OK"),
        JSON.stringify(read),
      );
      await tools.get("terminal_kill")!.execute(toolContext, { name: "echo" });
    } finally {
      await runtime.purge().catch(() => undefined);
      await Deno.remove(root, { recursive: true }).catch(() => undefined);
    }
  },
});
