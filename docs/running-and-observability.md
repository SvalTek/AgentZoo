---
title: Running and Observing AgentZoo
description: Use the CLI dashboard, understand scheduling, stop cleanly, and inspect durable activity logs.
---

# Running and observing AgentZoo

## CLI options

```text
deno task dev [options]
```

| Option                | Meaning                           |
| --------------------- | --------------------------------- |
| `-c, --config <path>` | Select a YAML configuration       |
| `-t, --task <task>`   | Override the run-wide objective   |
| `--no-ui`             | Use line-oriented terminal output |
| `-h, --help`          | Show help                         |
| `-V, --version`       | Show the CLI version              |

Docker resource management subcommands:

```text
deno task dev docker list
deno task dev docker purge [-c <config> | --runtime <id> | --all] [--prune-images]
```

`docker list` shows the labelled AgentZoo Docker resources (runs, volumes, and
images). `docker purge` removes the labelled Docker resources for one run
(`--runtime <id>`) or for every run (`--all`); add `--prune-images` to also remove
unused managed runtime images.

State is durable across runs: `stop()` preserves the container and data volume so
a later run resumes from the same state, and only `docker purge` removes them.
If a run fails part-way through startup, the labelled data volume is kept and
reused on the next attempt; use `docker purge` when you want to abandon it
instead.

Without `--config`, the CLI uses `agent-zoo.yaml` when present, otherwise the
checked-in `agent-zoo.example.yaml`.

## Dashboard

On an interactive terminal, the deno-ink dashboard enters the alternate screen
and clears the terminal immediately. It shows:

- Zoo state, selected config, and total run duration.
- The resolved objective when one exists.
- Each agent's configured name and stable ID, type, model, state, current
  high-level activity, and active/idle duration.
- Recent model inputs/outputs, tool arguments/results, yields, wakes, and
  errors, with bounded snippets.

The dashboard header does not show the log filename; it is printed in `--no-ui`
line-oriented mode.

Configured names are displayed as `Alice (c4842989967d)`. Stable IDs remain the
unambiguous identity even when several agents deliberately share one name.

Press `q` or Ctrl+C to request a graceful shutdown. The alternate terminal
screen and cursor are restored after cleanup.

## Scheduling behavior

Agents are persistent participants; the runner does not recreate them between
activations.

After an activation:

1. `yield` or a normal response places the agent into idle state.
2. Its idle-start timestamp is recorded.
3. Another runnable agent is selected stochastically.
4. The immediately previous agent is excluded while another candidate exists.
5. A returning agent receives
   `Automated activity update: You have been idle for <duration>.` as a system
   history message.

A population with only one yielded runnable agent becomes quiescent instead of
immediately waking itself in a zero-duration loop. It remains idle until an
external stop.

## Completion

With completion enabled, an agent may call `complete`. Global completion occurs
only when every non-errored population member has signalled completion.

With completion disabled, the run is ongoing. Completion signals do not finish
the zoo; stop it with `q`, Ctrl+C, or a programmatic `zoo.stop()` call.

## Durable JSONL log

Every standalone run creates:

```text
agent-zoo-YYYYMMDDTHHMMSS.sssZ.jsonl
```

beside the selected configuration file. Each line is one JSON record. The log
contains session boundaries, lifecycle transitions, model request/response
deltas, tool activity, errors, and available failed-activation transcripts.

Agent identity stays structured:

```json
{
  "agentId": "c4842989967d",
  "agentName": "Alice",
  "modelKey": "local-qwen",
  "modelName": "qwen3.5:9b",
  "provider": "ollama"
}
```

Human-readable headlines may use `Alice (c4842989967d)`, but the JSON identity
fields are never collapsed into that display string.

Every entered tool execution emits a correlated `agent:tool:start` and
`agent:tool:end` using the same `toolCallId`, including failures. Failures also
emit `agent:tool:error`. Model activity is logged as semantic deltas rather than
repeating the entire conversation on every turn; failed activations retain their
available transcript and provider exchanges for recovery analysis.

Treat the log as sensitive. It can contain prompts, model output, commands, file
contents, HTTP material, and errors.

## Line-oriented mode

Use this when redirecting output or when the terminal cannot support the live
renderer:

```powershell
deno task dev --no-ui --config agent-zoo.yaml
```

The same core runner and durable log are used; only the terminal presentation
changes.
