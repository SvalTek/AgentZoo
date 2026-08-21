import { assertEquals } from "@std/assert";
import { ZooAgent } from "../Agent.ts";
import { ModelRegistry } from "../ModelRegistry.ts";
import { createLanguageModel } from "../Providers.ts";
import { buildRuntimeImage, DockerRuntimeManager } from "../Runtime.ts";
import { ShellFeature } from "../tools/ShellTool.ts";

let ollamaIntegrationEnabled = false;
try {
  ollamaIntegrationEnabled =
    Deno.env.get("AGENT_ZOO_OLLAMA_INTEGRATION") === "1";
} catch {
  // Normal tests must not require a local model server.
}

if (ollamaIntegrationEnabled) {
  await buildRuntimeImage("agent-zoo-runtime:ollama-test");
}

Deno.test({
  name: "qwen3.5 uses the production shell feature in its chroot",
  ignore: !ollamaIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({ prefix: "agent-zoo-ollama-test-" });
    const runtimeManager = new DockerRuntimeManager(
      shared,
      "agent-zoo-runtime:ollama-test",
      "agent-zoo-runtime-ollama-test",
    );
    try {
      const runtime = await runtimeManager.createEnv("ollama");
      const models = new ModelRegistry({
        local: {
          provider: "ollama",
          model: "qwen3.5:9b",
          baseUrl: "http://127.0.0.1:11434",
        },
      });
      const shell = await new ShellFeature().createTool();
      const agent = new ZooAgent(
        {
          id: "ollama",
          model: "local",
          systemPrompt: "Use the shell tool when asked to run a command.",
        },
        runtime,
        models,
        createLanguageModel,
        [shell],
      );

      const output = await agent.run(
        "Use the shell tool exactly once to run: printf ollama-live > /shared/ollama-handoff. Then give a short confirmation.",
      );
      try {
        assertEquals(
          await Deno.readTextFile(`${shared}/ollama-handoff`),
          "ollama-live",
        );
      } catch (error) {
        throw new Error(`Agent output: ${output}\n${error}`);
      }
    } finally {
      await runtimeManager.purge();
      await Deno.remove(shared, { recursive: true });
    }
  },
});
