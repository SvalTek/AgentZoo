---
title: Troubleshooting
description: Diagnose AgentZoo configuration, Docker runtime, model, template, and lifecycle issues.
---

# Troubleshooting

## Configuration is rejected

AgentZoo reports Zod issues using YAML paths. Common causes include:

- A type, service, or feature identifier containing uppercase letters or
  unsupported punctuation.
- Both `system` and `systemPrompt` on one population.
- Both `name` and `names` on one population.
- `names` combined with `count`.
- An empty `names` list or more than 100 population members.
- An unsupported runtime backend. Only `docker` is operational in config.
- An OpenAI-compatible model without `baseUrl`.

## An agent references an unknown model or template

`model` must match a top-level `models` key. `system` must match a top-level
`templates` key. These references are resolved while building the zoo, before
the runner starts.

## Docker startup fails

Check that:

- Docker is installed and `docker.exe` is available to the Deno process.
- The Docker daemon is running Linux containers.
- Privileged containers and OverlayFS mounts are permitted.
- No stale process outside AgentZoo is holding a conflicting explicitly chosen
  runtime host name (the standalone builder normally generates one).

The runtime builds its image, creates one data volume, and starts one privileged
host container. Per-agent environments are OverlayFS/chroot roots inside it.

## Ollama cannot be reached

For the default local endpoint, verify:

```powershell
ollama list
```

Then check the configured `baseUrl`. AgentZoo accepts the Ollama host URL with
or without a trailing `/api` and uses the native `/api/chat` endpoint. A
trailing `/v1` is also normalized for older configurations.

Cold models, especially `qwen3.5:9b`, can take several minutes to load. Use a
realistic timeout before deciding the run is stuck.

## `apt` reports missing `gpgv` or unsigned Debian repositories

The current runtime supplies the device nodes and mounts required by apt and
package maintainer scripts. If this appears on an older runtime image, rebuild
it by starting a fresh run. In particular, verify that `/dev/null` is a
character device inside the agent environment before treating the message as a
keyring problem:

```sh
test -c /dev/null
command -v gpgv
apt-get update
```

The Docker integration test performs a signed update, installs `jq`, executes
it, and confirms that another agent cannot see the installed package.

## The model claims it used a tool, but nothing changed

Model prose is not proof of tool execution. Inspect the dashboard and JSONL for
correlated `agent:tool:start` and `agent:tool:end` records, then verify the
actual filesystem or HTTP side effect.

## `MaxTurnsError`

`maxTurns` limits model/tool iterations within one activation, not across the
agent's entire lifetime. Increase it for populations that legitimately perform
long tool sequences:

```yaml
agents:
  - type: worker
    model: local
    maxTurns: 250
```

The failed activation log retains available provider messages and model
exchanges so the interrupted work can be diagnosed.

## An unnamed agent sees a type-shaped identity

When no `name` is configured, `{agent}` resolves to the stable opaque ID, such
as `446eb29a731d`. Configure `name` or `names` when the model needs a readable
identity, and use the documented conditional template.

## Template directives appear literally

Control directives are line-oriented. This is valid:

```text
{#IF name}
{name}
{#ELSE}
{agent}
{#END}
```

An inline form such as `{#IF name}{name}{#END}` is not interpreted as a block.

## One-agent zoo becomes idle and does not wake again

This is intentional. A sole yielded participant cannot immediately reschedule
itself, because repeated zero-duration idle wakes would become accidental
stimuli. Add another population member or stop the open-ended run externally.

## The terminal display is unsuitable

Use `--no-ui` for line-oriented output. The durable JSONL log is written in both
modes.

## Runtime host logs

The resident runtime host writes an application log to
`<project>/.agent-zoo-logs/<runId>/runtime-host.log` on the host, bind-mounted
at `/var/log/agentzoo`. `DockerRuntimeManager.runtimeLogFile()` is
authoritative; the directory moves beside the workspace if the project path
would otherwise sit inside the agent-visible `/shared` mount.

The log is JSONL with `ts`, `level`, `source`, `message`, and optional
`details`/`error`. It records startup, connections, handshake rejections,
subscriptions, upload lifecycle, and operation failures with agent, operation,
and error code. Set `AGENTZOO_LOG_LEVEL=debug` for per-request detail.

The file is truncated on the first service start of a container run; supervisor
restarts append, so crash history survives. If the log path cannot be opened,
the service reports that on stderr and continues without application logging.
Container stdout/stderr remains separate for infrastructure diagnostics and is
not copied into the application log.
