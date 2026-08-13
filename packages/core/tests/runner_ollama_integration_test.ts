import { assertEquals } from "@std/assert";
import { buildAgentZoo, buildRuntimeImage, DockerRuntimeManager, parseConfig } from "../mod.ts";

let enabled = false;
try {
  enabled = Deno.env.get("AGENT_ZOO_RUNNER_INTEGRATION") === "1";
} catch {
  // Ordinary tests do not need environment permission.
}

if (enabled) {
  await buildRuntimeImage();
}

Deno.test({
  name: "configured qwen zoo performs real shell work, yields, and shuts down",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "agent-zoo-runner-live-",
    });
    const config = parseConfig(`
models:
  qwen:
    provider: ollama
    model: qwen3.5:9b
    baseUrl: http://127.0.0.1:11434
    reasoning: true
    reasoningEffort: low
    context:
      window: 32768
      maxOutputTokens: 4096
    sampling:
      temperature: 0.4
      topP: 0.9
      minP: 0.05
runtime:
  backend: docker
  sharedWorkspace: shared
agents:
  - type: alpha
    model: qwen
    systemPrompt: Use tools when explicitly asked. You are alpha-1.
    prompt: Use the shell tool exactly once to run "printf alpha-live > /shared/alpha-1.done". Then call the yield tool by itself.
  - type: beta
    model: qwen
    systemPrompt: Use tools when explicitly asked. You are beta-1.
    prompt: Use the shell tool exactly once to run "printf beta-live > /shared/beta-1.done". Then call the yield tool by itself.
completion:
  enabled: false
`);
    const built = await buildAgentZoo(config, { baseDir: directory });
    const yielded = new Set<string>();
    built.zoo.addEventListener("agent:yield", (event) => {
      yielded.add((event as CustomEvent).detail.agentId);
      if (yielded.size === 2) {
        queueMicrotask(() => void built.zoo.stop("live acceptance complete"));
      }
    });
    const timeout = setTimeout(
      () => void built.zoo.stop("live acceptance timed out after 20 minutes"),
      20 * 60_000,
    );
    try {
      await built.zoo.run();
      assertEquals([...yielded].sort(), ["alpha-1", "beta-1"]);
      assertEquals(
        await Deno.readTextFile(`${directory}/shared/alpha-1.done`),
        "alpha-live",
      );
      assertEquals(
        await Deno.readTextFile(`${directory}/shared/beta-1.done`),
        "beta-live",
      );
      const events = built.zoo.state().recentActivity;
      const starts = events.filter((event) =>
        event.kind === "agent:tool:start" && event.toolName === "shell"
      );
      const ends = events.filter((event) =>
        event.kind === "agent:tool:end" && event.toolName === "shell"
      );
      assertEquals(starts.length, 2);
      assertEquals(
        starts.map((event) => event.toolCallId).sort(),
        ends.map((event) => event.toolCallId).sort(),
      );
    } finally {
      clearTimeout(timeout);
      await built.zoo.stop("live test cleanup");
      if (built.runtime instanceof DockerRuntimeManager) {
        await built.runtime.purge();
      }
      await Deno.remove(directory, { recursive: true });
    }
  },
});
