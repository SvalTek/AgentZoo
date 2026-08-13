# AgentZoo

AgentZoo runs a configured population of persistent Vibes agents. One Docker
runtime host provides a private OverlayFS/chroot root to every agent and mounts
the same host directory at `/shared` in each root.

See [the documentation](docs/README.md) for the user guide, complete
configuration reference, runtime/tool behavior, observability, library
embedding, extension points, and troubleshooting.

## Run the standalone application

Copy `agent-zoo.example.yaml` to `agent-zoo.yaml`, adjust the model and agent
population, then run:

```sh
deno task dev
```

Use another config with `deno task dev --config path/to/zoo.yaml`. The Cliffy
command starts a deno-ink dashboard when attached to an interactive terminal.
Press `q` or Ctrl+C for a graceful stop. Use `--no-ui` for line-oriented output.
Supply a run-wide objective without editing YAML using `--task "..."`; it
overrides the top-level `taskPrompt` for that run.

Every standalone run also writes a timestamped `agent-zoo-*.jsonl` file beside
the selected YAML. It records the initial prompt, Vibes message deltas, provider
request deltas and responses, model output, correlated tool arguments/results,
transitions, and errors, tagged with the agent and both the configured and
provider model names. Failed activations retain their partial transcript and
model exchanges, including `MaxTurnsError` runs.

Each run also labels its Docker containers, volumes, and images. Inspect or
remove them with `deno task dev docker list` and `deno task dev docker purge
--runtime <id>` (or `--all`, plus optional `--prune-images`); see
[getting-started](docs/getting-started.md).

Each `agents` entry is a population group. `count` defaults to one and creates
stable IDs such as `coding-1`. An optional `name` supplies a model-facing and
display name for every member expanded from that population entry without
changing their stable IDs. Alternatively, `names` supplies one name per member
and determines the population size; it cannot be combined with `name` or
`count`, and duplicate names are valid. Numbering continues across repeated
entries of the same `type`. System templates receive the configured name as
`{name}` when present and the stable ID as `{agent}`, so a neutral fallback can
be written as:

```text
{#IF name}
{name}
{#ELSE}
{agent}
{#END}
```

`system` names a configured `TextTemplate`; `systemPrompt` supplies inline text
instead. `prompt` is optional. Without it, AgentZoo starts that agent with a
real listing of its private working directory. The listing is always appended to
the single leading system message. Agent `prompt` text is labelled
`INSTRUCTIONS:` and the run-wide `taskPrompt` is labelled `OBJECTIVE:`; when
present, they form one user message in that order. With neither, startup is
system-only. Later wake stimuli use
`Automated activity update: You have been idle for <duration>.` as system-role
history, so they remain part of the agent's conversation. `maxTurns` controls
how many model/tool iterations one activation may perform before Vibes raises
`MaxTurnsError`; it defaults to 100 and may be set separately for each
configured population group.

`features` controls which structured convenience tools appear to the model. It
does not remove capabilities already available through `shell`. The default
features are `shell` and `filesystem`; `filesystem` provides bounded file
reading, writing, exact text edits, directory listing, and bounded search. Add
`http` to expose the raw `http_request` convenience tool. It is omitted by
default because presenting a network-specific tool changes the model-facing
environment, even though ordinary shell programs may provide the same underlying
capability.

Named models may set `reasoning: true` or `false` and an optional
`reasoningEffort: auto | low | medium | high | max`. `auto` leaves the endpoint
default unchanged. An explicit `false` disables reasoning even if an effort is
also present. These settings are translated by the Ollama and OpenAI-compatible
provider constructors rather than added to agent prompts or Vibes options.

Named models may also define normalized `context` and `sampling` settings.
Population entries can override individual fields. `context.window` drives
Vibes' provider-independent history trimmer, while `context.maxOutputTokens`
both reserves input space and limits generation. Ollama uses its native API so
`num_ctx`, `min_p`, and the other native samplers are actually applied;
OpenAI-compatible endpoints receive the corresponding OpenAI/common extension
field names. `topK` remains available for compatible providers but is not
supported by the current Ollama adapter and produces an unsupported-setting
warning when configured there.

The `yield` tool ends only the current activation. AgentZoo retains the agent's
Vibes message history and later supplies the automated activity update with its
measured idle duration. `complete` records a completion vote; global completion
requires every non-errored member of the population to vote. Set
`completion.enabled: false` for open-ended operation.

Docker is the only runtime backend accepted by the current schema. `services`
contains names resolved from service factories supplied by an embedding
application; the standalone distribution does not enable optional services by
default.

The repository carries a narrow patch over Vibes 1.0.13 in `vendor/vibes`. It
passes AI SDK's `allowSystemInMessages` option through and lets an activation
append a system-role message. The patch is documented in
`vendor/vibes/AGENTZOO_PATCH.md` and exists solely for the two context updates
described above.

## Embed the runner

```ts
import { buildAgentZoo, loadConfig } from "agent-zoo";

const config = await loadConfig("agent-zoo.yaml");
const { zoo } = await buildAgentZoo(config);

zoo.addEventListener("activity", (event) => {
  console.log((event as CustomEvent).detail);
});

await zoo.start();
// zoo.state() returns live population snapshots.
// await zoo.stop("host shutdown") requests a programmatic stop.
await zoo.wait();
```

Embedding applications can inject model/runtime factories, named service
factories, a clock, and a random source through `buildAgentZoo` and `AgentZoo`
options. This keeps scheduling, observability, and lifecycle control in core
rather than in the CLI.

## Checks

```sh
deno task check
deno task lint
deno task test
```

Docker and Ollama acceptance tests are gated. The full configured-runner test
uses `qwen3.5:9b` and asserts real shell events and `/shared` side effects:

```sh
AGENT_ZOO_RUNNER_INTEGRATION=1 deno test -A packages/core/tests/runner_ollama_integration_test.ts
```
