---
title: AgentZoo Documentation
description: User and library documentation for configuring, running, observing, and embedding AgentZoo.
---

# AgentZoo documentation

AgentZoo runs a configurable population of persistent AI agents. Each agent has
its own conversation and private Linux filesystem, while `/shared` is visible to
the whole population. The standalone application provides a live terminal
dashboard, lifecycle controls, and a durable JSONL activity log.

## Start here

- [Getting started](getting-started.md) — prerequisites, first configuration,
  and the first run.
- [Configuration reference](configuration.md) — every supported YAML field,
  population naming, models, prompts, and completion.
- [Templates](templates.md) — reusable system prompts and the `TextTemplate`
  syntax.
- [Runtime and tools](runtime-and-tools.md) — private filesystems, `/shared`,
  shell access, filesystem helpers, and optional HTTP.
- [Running and observing](running-and-observability.md) — CLI options, dashboard
  behavior, scheduling, stopping, and JSONL logs.
- [Troubleshooting](troubleshooting.md) — common configuration, Docker, model,
  and lifecycle problems.

## Use AgentZoo as a library

The root `agent-zoo` package is the normal public import. It re-exports the
runner, configuration, models, runtime contracts, services, router, context, and
template APIs.

- [Embedding AgentZoo](library/README.md) — build, start, observe, and stop a
  configured zoo from TypeScript.
- [Extension points](library/extending.md) — injected model/runtime factories,
  services, routers, context, and direct runner construction.
- [Development and testing](development.md) — repository checks and gated
  Docker/Ollama tests.

Direct imports such as `@agent-zoo/core` are available to workspace consumers
that deliberately want a narrower package, but ordinary applications should
import from `agent-zoo`.
