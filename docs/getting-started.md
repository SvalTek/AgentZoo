---
title: Getting Started
description: Prepare AgentZoo, configure a model and population, and start the standalone application.
---

# Getting started

## Prerequisites

The current standalone runtime expects:

- Deno 2.
- Docker with a running Linux container engine.
- A Docker installation that permits privileged containers and OverlayFS mounts.
- An Ollama server or an OpenAI-compatible model endpoint.

The current Docker implementation invokes `docker.exe`, so the checked-in
standalone runtime is presently oriented toward a Windows host with Docker
available. Docker is one outer runtime host; AgentZoo does not create one
container per agent.

Build the managed runtime image once before the first run:

```powershell
deno task docker:build
```

The image is tagged `agent-runtime:dev` and carries AgentZoo's managed labels, so
`docker list` and `docker purge --prune-images` recognize it. When the image is
missing, the runtime builds it from source if the `Containerfile` is present in
this installation, and otherwise pulls the published image; if neither works it
fails with a message pointing back to `deno task docker:build`. An explicit
build is the reliable way to refresh a stale image after updating
`runtime-entrypoint.sh` or the `Containerfile`.

For an Ollama model, pull it before the first run if necessary:

```powershell
ollama pull qwen3.5:9b
```

A cold model can take several minutes to load. AgentZoo does not treat a slow
initial load as evidence that the model failed.

## Create a configuration

Copy the executable example:

```powershell
Copy-Item agent-zoo.example.yaml agent-zoo.yaml
```

A minimal configuration is:

```yaml
models:
  local:
    provider: ollama
    model: qwen3.5:9b

runtime:
  backend: docker
  sharedWorkspace: .shared

agents:
  - type: observer
    count: 2
    model: local

completion:
  enabled: false
```

This creates `observer-1` and `observer-2`. They receive the default `shell` and
`filesystem` convenience tools. No task is invented for them: each starts from a
real observation of its configured working directory.

## Start AgentZoo

```powershell
deno task dev
```

The task runs the application with full Deno permissions. AgentZoo needs broad
process, filesystem, environment, signal, and network access to manage Docker,
models, logging, and the terminal UI.

When attached to a terminal, AgentZoo enters a full-screen deno-ink dashboard.
Press `q` or Ctrl+C to request a graceful stop.

## Inspect and clean up Docker resources

Runtime containers and data volumes carry explicit ownership labels including
their run ID, creation time, and resolved configuration path. Inspect them with:

```powershell
deno task dev docker list
```

Remove one selected run and its named data volume:

```powershell
deno task dev docker purge --runtime <run-id>
```

Or explicitly remove every labelled managed run:

```powershell
deno task dev docker purge --all
```

Add `--prune-images` to either purge command to remove unused runtime images
that also carry AgentZoo's managed-image label. Cleanup never selects resources
from an `agent-runtime-*` name prefix. Resources from older versions without
ownership labels are reported by Docker itself but are not touched by these
commands.

## Supply an objective

Put a run-wide objective in YAML:

```yaml
taskPrompt: Inspect the available project and make the requested change.
```

Or override it for one run:

```powershell
deno task dev --task "Inspect the project and report its test status."
```

The CLI value takes precedence over `taskPrompt`. It does not alter the YAML
file.

## Use another configuration

```powershell
deno task dev --config experiments/autonomy.yaml
```

Without `--config`, AgentZoo selects `agent-zoo.yaml` in the current directory
when it exists, otherwise `agent-zoo.example.yaml`. Relative
`runtime.sharedWorkspace` paths are resolved beside the selected config file.

## What a first activation contains

AgentZoo's leading system content contains its environment contract and guidance
from enabled features. When `shell` is enabled, Shell guidance also identifies
the agent's own login user, starting directory, and bounded listing with
readable entry types such as `file`, `directory`, and `symlink`. With `shell`
disabled, AgentZoo does not make that observation.

If configured, the first user message contains:

```text
INSTRUCTIONS: <agent population prompt>
OBJECTIVE: <run-wide taskPrompt>
```

Either section may appear alone. With neither one present, startup is
system-only; AgentZoo does not add a fake task or an empty user message.

Continue with the [configuration reference](configuration.md) or learn about the
[runtime and tools](runtime-and-tools.md).
