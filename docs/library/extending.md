---
title: Extension Points
description: Extend AgentZoo with injected providers, runtimes, services, routers, context, or direct actors.
---

# Extension points

The configured bootstrap provides focused injection points without requiring a
second lifecycle or dependency system.

## Bootstrap options

```ts
import { buildAgentZoo } from "agent-zoo";

const built = await buildAgentZoo(config, {
  baseDir: Deno.cwd(),
  taskPrompt: "Host-provided objective",
  modelFactory,
  runtimeFactory,
  workspaceFactory,
  services,
  clock,
  random,
});
```

Supported options are:

- `baseDir` — base for the shared workspace path.
- `taskPrompt` — run-wide objective override.
- `modelFactory` — construct a concrete AI SDK `LanguageModel` from a named
  `ModelRegistry` entry.
- `runtimeFactory` — construct a `RuntimeManager` for the validated runtime
  configuration and shared host path.
- `workspaceFactory` — construct the `SharedWorkspace` abstraction.
- `services` — named service factories available to config.
- `clock` — injectable millisecond clock, primarily for deterministic hosts and
  tests.
- `random` — injectable `[0, 1)` sample source for scheduler selection.

## Model factory

```ts
import type { LanguageModelFactory } from "agent-zoo";

const modelFactory: LanguageModelFactory = (key, registry, settings) => {
  const configured = registry.get(key);
  // settings contains effective context/sampling values after agent overrides.
  return createMyLanguageModel(configured, settings);
};
```

The default factory supports `ollama` and `openai-compatible`. A custom factory
may replace construction while preserving named central configuration.

## Runtime factory

A runtime manager owns multiple agent environments:

```ts
import type { RuntimeManager } from "agent-zoo";

const runtimeFactory = async (
  runtimeConfig: { backend: "docker"; sharedWorkspace: string },
  sharedWorkspace: string,
): Promise<RuntimeManager> => {
  return new MyRuntimeManager(runtimeConfig, sharedWorkspace);
};
```

Each `RuntimeEnv` must implement `prepare`, scoped `exec`, `destroy`, and
`reset`. It must preserve the contract that shell and structured filesystem
operations observe the same namespace. A replacement backend must also provide
private agent roots and the common `/shared` surface if it claims compatibility
with the configured runtime behavior. When `exec` times out or is aborted, it
must stop the invoked command's descendant process tree before resolving; it
must not leave that work running after reporting interruption.

## Services and mounted routers

Services are configured by name and supplied by the embedding host:

```yaml
services: [system]
```

```ts
import { buildAgentZoo, Router, Service } from "agent-zoo";

class SystemService extends Service {
  readonly router = new Router().addRoute(
    { method: "GET", path: "/health" },
    () => new Response("ok"),
  );
}

const built = await buildAgentZoo(config, {
  services: {
    system: () => new SystemService(),
  },
});
```

The service is started and stopped with the zoo. Its router is mounted at:

```text
/services/system/health
```

The in-process router is available as `built.zoo.router`:

```ts
const response = await built.zoo.router.fetch(
  new Request("http://local/services/system/health"),
);
```

AgentZoo does not automatically start an HTTP server. A host may expose
`zoo.router.fetch` through `Deno.serve` when that is part of the embedding
application.

## Ambient context

The root package exports the established context singleton:

```ts
import { Context } from "agent-zoo";

const zoo = Context.get("agentZoo");
const models = Context.get("models");
```

Configured bootstrap registers `agentZoo`, `models`, `templates`, `runtime`, and
`workspace`, then removes its own values during disposal. Services obtain a
typed view over this same registry; do not introduce a parallel dependency
container for service integration.

## Direct runner construction

Applications that do not want YAML/bootstrap composition can construct the
runner and register compatible persistent actors directly:

```ts
import { AgentZoo } from "agent-zoo";

const zoo = new AgentZoo({
  completionEnabled: false,
  initialPrompts: { "custom-1": "INSTRUCTIONS: Observe this input." },
});

zoo.registerAgent(myActor);
await zoo.run();
```

A `ZooActor` is an `EventTarget` with stable `id`/`config` and `prepare`,
`activate`, `observeEnvironment`, and `stop` methods. Use the existing
`ZooAgent` when integrating Vibes; the structural actor boundary mainly supports
embedding and deterministic tests.

## Features

The root exports `Feature`, `FeatureRegistry`, and the built-in feature classes.
However, the current `buildAgentZoo` bootstrap constructs its built-in feature
registry internally and does not yet accept custom configured feature factories.
To expose additional model-visible tools today, construct `ZooAgent`s/direct
actors and register them with `AgentZoo`, or extend the bootstrap in the host
project deliberately. Do not document an arbitrary feature name in YAML unless
the bootstrap that consumes it registers that feature.

## Narrow subpackage imports

Workspace packages remain available when a consumer deliberately wants a smaller
boundary:

```ts
import { AgentZoo } from "@agent-zoo/core";
import { Router } from "@agent-zoo/api";
```

These are not required for ordinary use; `agent-zoo` re-exports the supported
public surfaces from one root.
