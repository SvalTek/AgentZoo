---
title: Embedding AgentZoo
description: Consume the root AgentZoo package to build, observe, run, and stop a zoo from TypeScript.
---

# Embedding AgentZoo

Use the root package for normal library consumption:

```ts
import { buildAgentZoo, loadConfig } from "agent-zoo";
```

The root exports runner/config/model/runtime APIs as well as `Service`,
`Router`, `Context`, and `TextTemplate`. Direct workspace imports such as
`@agent-zoo/core` are optional narrow boundaries, not the primary public API.

## Build and run

```ts
import { dirname } from "@std/path";
import { buildAgentZoo, loadConfig } from "agent-zoo";

const configPath = "agent-zoo.yaml";
const config = await loadConfig(configPath);
const built = await buildAgentZoo(config, {
  baseDir: dirname(configPath),
});

built.zoo.addEventListener("activity", (rawEvent) => {
  const event = (rawEvent as CustomEvent).detail;
  console.log(event.kind, event.agentId, event.agentName, event.message);
});

await built.zoo.run();
```

`buildAgentZoo` returns:

- `zoo` — the persistent runner and lifecycle owner.
- `models` — the named `ModelRegistry`.
- `templates` — the compiled `TemplateRegistry`.
- `runtime` — the selected `RuntimeManager`.
- `workspace` — the host-side `SharedWorkspace` abstraction.

`baseDir` controls resolution of relative `runtime.sharedWorkspace`. The
standalone CLI uses the selected config file's directory.

## Separate start and wait

Use separate calls when the host needs to perform work after startup:

```ts
await built.zoo.start();

const snapshot = built.zoo.state();
console.log(snapshot.state, snapshot.activeAgentId);

await built.zoo.wait();
```

`run()` is equivalent to `start()` followed by `wait()`.

## Stop programmatically

```ts
await built.zoo.stop("host shutdown");
```

Stopping aborts the active activation where possible, stops services, destroys
agent environments, disposes the runtime, and resolves the runner loop.

Call `stop()` from the host's signal/lifecycle handling. The standalone CLI
already handles SIGINT and `q`.

## Inspect live state

```ts
const snapshot = built.zoo.state();

for (const agent of snapshot.agents) {
  console.log({
    id: agent.id,
    name: agent.name,
    state: agent.state,
    activeForMs: agent.activeForMs,
    idleForMs: agent.idleForMs,
    activity: agent.currentActivity,
    error: agent.error,
  });
}
```

Zoo states are `created`, `starting`, `running`, `stopping`, `completed`,
`stopped`, and `errored`. Agent states are `created`, `ready`, `active`, `idle`,
`completed`, `errored`, and `stopped`.

Other lookup methods include:

```ts
built.zoo.agents(); // stable agent IDs
built.zoo.getAgent("worker-1");
built.zoo.services(); // registered service names
built.zoo.get("metrics"); // registered service
```

## Observe events

The broad `activity` event receives every structured `ZooActivityEvent`.
Consumers may also subscribe to its exact `kind`, including:

- `zoo:start`, `zoo:complete`, `zoo:stop`
- `agent:wake`, `agent:response`, `agent:yield`, `agent:complete`
- `agent:model:request`, `agent:model:response`, `agent:model:error`
- `agent:tool:start`, `agent:tool:end`, `agent:tool:error`
- `agent:error`

```ts
built.zoo.addEventListener("agent:tool:end", (rawEvent) => {
  const event = (rawEvent as CustomEvent).detail;
  console.log(event.agentId, event.toolName, event.toolCallId, event.detail);
});
```

Every activity record has a sequence number, timestamp, kind, and message. Agent
events also carry stable `agentId` and an optional configured `agentName`. Tool
records include `toolName` and `toolCallId`.

The runner additionally emits `started`, `stopped`, `statechange`,
`agentregistered`, and `serviceadded` lifecycle events.

## Override the run-wide objective

```ts
const built = await buildAgentZoo(config, {
  taskPrompt: "Objective supplied by the embedding host.",
});
```

This has the same precedence as CLI `--task`: it overrides `config.taskPrompt`
for the built population without mutating the config object.

## Parse in-memory YAML

```ts
import { parseConfig } from "agent-zoo";

const config = parseConfig(`
models:
  local:
    provider: ollama
    model: qwen3.5:9b
agents:
  - type: observer
    model: local
`);
```

Both `parseConfig` and `loadConfig` return the validated/defaulted `ZooConfig`
shape. Both also resolve model `apiKey: ENV[name]` references from the process
environment. `parseConfig` accepts an optional environment lookup function as
its second argument when an embedding application supplies credentials from a
different source.
