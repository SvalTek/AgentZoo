---
title: Development and Testing
description: Run AgentZoo repository checks and opt into Docker and Ollama integration tests.
---

# Development and testing

## Repository checks

Run the normal verification set from the repository root:

```powershell
deno fmt --check
deno task check
deno task lint
deno task test
```

`deno task test` uses full permissions because runtime, filesystem, subprocess,
network, signal, and integration behavior are part of the application.

The normal suite leaves live Docker/Ollama tests gated so ordinary unit runs do
not build runtime images or load large models.

## Docker isolation integration

```powershell
$env:AGENT_ZOO_DOCKER_INTEGRATION = "1"
deno test -A packages/core/tests/docker_runtime_test.ts
```

This verifies private roots and PID namespaces, the shared `/shared` mount, cwd
behavior, filesystem-tool agreement, timeout/abort process-tree cleanup, private
device mounts, and a real signed `apt-get update` plus package installation
through the Docker runtime.

## Production shell with Ollama

```powershell
$env:AGENT_ZOO_OLLAMA_INTEGRATION = "1"
deno test -A packages/core/tests/ollama_integration_test.ts
```

The test uses `qwen3.5:9b` and verifies the actual shell side effect. Model text
claiming that a tool ran is not considered success.

## Configured runner integration

```powershell
$env:AGENT_ZOO_RUNNER_INTEGRATION = "1"
deno test -A packages/core/tests/runner_ollama_integration_test.ts
```

This exercises YAML parsing, bootstrap, named models, the Docker runtime,
multiple persistent agents, real production shell calls, `/shared` side effects,
yield, correlated tool telemetry, and graceful shutdown.

The test allows up to 20 minutes because a cold 7 GB model load and reasoning
can take substantially longer than a warm request.

## Test design conventions

- Inject clocks and random sources for lifecycle/scheduler tests instead of
  sleeping.
- Assert real tool side effects and correlated events.
- Keep live tests gated and state clearly whether they ran.
- Preserve the single Docker host plus per-agent OverlayFS/chroot topology.
- Keep model-facing names, descriptions, errors, and results neutral.
- Treat JSONL as an append-only semantic history; do not repeat the full
  transcript on every successful turn.

## Vendored Vibes compatibility patch

The repository vendors a narrow compatibility layer under `vendor/vibes`.
Details are recorded in `vendor/vibes/AGENTZOO_PATCH.md`. It enables system-role
idle messages and a system-only first activation while preserving the expected
AI SDK message shape.

When updating Vibes, revalidate:

- `allowSystemInMessages` forwarding.
- `messageRole` for system wake stimuli.
- `appendPrompt: false` for taskless startup.
- `systemPromptAsMessage` for one leading system message.
- Model request delta logging after every response.
