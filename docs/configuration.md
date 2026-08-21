---
title: Configuration Reference
description: Complete reference for AgentZoo YAML models, templates, runtime, populations, services, prompts, and completion.
---

# Configuration reference

AgentZoo loads YAML and validates the entire document with Zod before building
models, environments, services, or agents.

```yaml
taskPrompt: Optional objective for the whole run

models:
  local-qwen:
    provider: ollama
    model: qwen3.5:9b
templates: {}
runtime: {}
services: []
mcp: []
agents:
  - type: example
    model: local-qwen
completion: {}
```

## `taskPrompt`

Optional non-empty run-wide objective. It is supplied to every expanded agent as
`OBJECTIVE: ...`. The CLI `--task` option overrides it for that run.

An agent population's `prompt` and the run-wide objective form one user message:

```text
INSTRUCTIONS: <prompt>
OBJECTIVE: <taskPrompt>
```

## `models`

Models are named centrally. Each agent refers to a model key instead of
repeating endpoint configuration.

### Ollama

```yaml
models:
  local-qwen:
    provider: ollama
    model: qwen3.5:9b
    baseUrl: http://127.0.0.1:11434
    apiKey: ENV[OLLAMA_API_KEY]
    reasoning: true
    reasoningEffort: medium
    context:
      window: 32768
      maxOutputTokens: 8192
    sampling:
      temperature: 0.7
      topP: 0.9
      minP: 0.05
```

`baseUrl` defaults to `http://127.0.0.1:11434`. AgentZoo uses Ollama's native
`/api/chat` protocol so native context and sampling options are applied instead
of being discarded by the OpenAI-compatibility endpoint. `apiKey` is optional.

### OpenAI-compatible endpoint

```yaml
models:
  hosted:
    provider: openai-compatible
    model: provider-model-name
    baseUrl: https://example.invalid/v1
    apiKey: ENV[HOSTED_API_KEY]
    headers:
      X-Custom-Header: value
```

`baseUrl` is required. `apiKey` and `headers` are optional.

### API keys and environment variables

Every model provider accepts `apiKey`. Use `ENV[name]` to resolve it from the
process environment while parsing or loading the YAML:

```yaml
apiKey: ENV[MY_PROVIDER_API_KEY]
```

For example, set `MY_PROVIDER_API_KEY` before starting AgentZoo. A referenced
variable that is missing or empty causes configuration loading to fail before
models or runtime environments are constructed. Literal API keys remain
supported, but environment references avoid placing secrets in configurations
that may be committed. The resolved value is passed to the provider and is not
written back to the YAML.

### Reasoning controls

Both providers accept:

- `reasoning: true | false`
- `reasoningEffort: auto | low | medium | high | max`

For Ollama these map to native `think` values. For OpenAI-compatible endpoints
they map to `reasoning_effort`; `false` becomes `none`. `reasoning: true`
defaults to medium when no effort is specified. `auto` leaves the endpoint's
default unchanged; with Ollama, `reasoning: true` plus `auto` sends native
`think: true` without selecting an effort.

### Context limits

Both model definitions and agent population entries accept:

```yaml
context:
  window: 32768
  maxOutputTokens: 8192
```

- `window` is the total input-plus-output context budget.
- `maxOutputTokens` limits one model response and reserves that space when
  trimming conversation history.

AgentZoo applies Vibes' provider-independent token history trimmer before every
model request. Its estimator keeps system messages and the newest conversation
messages, and does not mutate the persistent history. Ollama also receives
`window` as native `num_ctx`. Generic OpenAI-compatible APIs have no standard
request field for changing model context size, so AgentZoo enforces the limit
through history trimming without inventing a provider field.

If both values are present, `maxOutputTokens` must be smaller than `window`.

### Sampling controls

Both model definitions and agent population entries accept this normalized
shape:

```yaml
sampling:
  temperature: 0.7
  topP: 0.9
  topK: 40
  minP: 0.05
  typicalP: 0.95
  repeatPenalty: 1.1
  repeatLastN: 64
  frequencyPenalty: 0
  presencePenalty: 0
  seed: 42
  stopSequences: ["<END>"]
```

AgentZoo maps these names to each provider's request spelling. Ollama receives
native snake-case values inside `options`, including `num_predict` for
`maxOutputTokens`. OpenAI-compatible endpoints receive their OpenAI spellings
plus the conventional snake-case extensions for `top_k`, `min_p`, `typical_p`,
and repetition controls. Support for those non-standard extensions ultimately
depends on the selected compatible endpoint.

`topK` remains part of the normalized configuration and is deliberately
forwarded to the provider layer rather than ignored or stripped. The current
Ollama adapter does not support it, however: `topK` is a no-op there, and the
AI-SDK layer emits unsupported-setting noise on shutdown when it is configured.
Leave it unset for Ollama; use `topP` and/or `minP` instead.

Probability values (`topP`, `minP`, and `typicalP`) must be between 0 and 1.
`frequencyPenalty` and `presencePenalty` must be between -2 and 2.

An optional model `name` is accepted as a registry label. Current durable model
telemetry identifies models by the configured registry key and provider model
string.

## `templates`

A mapping of template name to `TextTemplate` source:

```yaml
templates:
  neutral-system: |
    {#IF name}
    You are {name}.
    {#ELSE}
    You are {agent}.
    {#END}
```

Agents select one with `system: neutral-system`. See [Templates](templates.md)
for variables and directives.

## `runtime`

```yaml
runtime:
  backend: docker
  sharedWorkspace: .shared
```

- `backend` defaults to and currently only accepts `docker`.
- `sharedWorkspace` defaults to `.shared`. Relative paths are resolved beside
  the selected config file in the standalone application.

The host directory is mounted as `/shared` in every agent environment.

## `mcp`

Optional named host-side MCP servers. AgentZoo constructs them during build,
connects and discovers a selected server lazily when an agent first needs its
tools, and disconnects them during shutdown. An MCP server is trusted host-side
code: use only servers and commands you trust.

```yaml
mcp:
  - name: context7
    type: stdio
    command: npx
    args: ["-y", "@upstash/context7-mcp@4.0.3"]
```

Every server needs a unique lowercase `name` (letters, digits, and hyphens).
`stdio` needs `command` and optional `args`/`env`; `http` needs an HTTP(S) `url`
and optional `headers`. `${NAME}` references in MCP transport strings are
expanded from the environment during config loading; missing or empty values
fail loading without disclosing the resolved secret.

MCP processes run on the host, not in an agent's Docker root. Use
`{shared.host}` for the host absolute shared-workspace path. `{shared.agent}`
means the literal `/shared` when passing that string intentionally to another
agent-facing system. A literal `/shared` is never rewritten.

## `agents`

Each item describes a population group rather than one transient model call.

```yaml
agents:
  - type: research
    name: Rowan
    count: 3
    model: local-qwen
    system: neutral-system
    prompt: Examine the supplied materials.
    features: [shell, filesystem]
    mcp: [github]
    cwd: /root
    maxTurns: 100
    context:
      maxOutputTokens: 4096
    sampling:
      temperature: 0.3
```

### `type`

Required population type/profile. It must begin with a lowercase letter and
contain only lowercase letters, digits, and hyphens.

It forms the stable semantic source identity. A `research` population produces
`research-1`, `research-2`, and so on before AgentZoo deterministically hashes
that value into the canonical opaque ID. Numbering continues across repeated
entries with the same type; changing a configured name does not change the ID.

### `count`, `name`, and `names`

`count` is a positive integer from 1 through 100 and defaults to 1.

`name` applies one model-facing/display name to every member in that population:

```yaml
- type: research
  name: Rowan
  count: 3
```

This produces three independently identified agents:

```text
Rowan (62d2f5686392)
Rowan (9ef0b7db0217)
Rowan (c4842989967d)
```

Identical names are intentional and valid. Stable IDs remain the correlation
identity in events and logs.

Use `names` for per-member names:

```yaml
- type: research
  names: [Rowan, Alice, Morgan]
  model: local-qwen
```

The list length determines the population size. `names` cannot be combined with
`name` or `count`. Duplicate values in `names` are valid.

### `model`

Required key from the top-level `models` mapping. An unknown key causes the
build to fail before the zoo starts.

### `captioningModel`

Optional key from the top-level `models` mapping. When set, the `vision`
feature's `view_image` tool delegates image captioning to this model instead of
the agent's own model. An unknown key causes the build to fail before the zoo
starts.

### `system` and `systemPrompt`

Use exactly one:

- `system` names a top-level template.
- `systemPrompt` supplies inline instruction text.

Both become Vibes instructions, supplied on every model turn without being
retained in conversation history. AgentZoo's stable environment contract,
including the existence of `/shared`, is system content independent of either
field.

### `prompt`

Optional population-specific initial instruction. It is prefixed with
`INSTRUCTIONS:` and combined with `taskPrompt` in the first user message.

### `features`

List of structured convenience interfaces shown to the model. Defaults to:

```yaml
features: [shell, filesystem]
```

Supported built-in values are `shell`, `filesystem`, `http`, `vision`, and
`terminal`. `vision` is opt-in and is not part of the default set. The lifecycle
tool `yield` is always added. `complete` is added only when completion is
enabled.

Features affect the model-visible tool list and add their own system guidance;
the guidance follows the same feature-group order as the tools. They do not
necessarily remove an underlying capability already available through `shell`.

`terminal` is opt-in and provides persistent interactive terminals in the
agent's own runtime. It is distinct from `shell`, which executes bounded
one-shot commands.

### `mcp`

Selects host-side MCP servers for every member of this population. Omit it or
use `[]` to expose none; use `["*"]` for every top-level server; or list exact
names such as `[github, docs]`. Names must exist, may not repeat, and `"*"` must
appear alone.

Each selected server is prefixed before Vibes combines toolsets. For example,
the server `github` exposes `search` as `mcp_github_search`, so it can coexist
with another server's `search` and AgentZoo's own tools. A post-prefix collision
with an explicitly identically named local tool is rejected rather than silently
replaced.

### `cwd`

Starting working directory inside the private agent environment. Defaults to
`/root`. It is used by shell/filesystem tools. When `shell` is enabled, its
system guidance observes the agent's actual login user (normally `root`),
working directory, and bounded directory listing; without `shell`, AgentZoo does
not make that observation.

### `maxTurns`

Maximum Vibes model/tool iterations in one activation. Defaults to 100. A model
that repeatedly works without yielding may need a larger value. Reaching the
limit records an errored activation with the available provider transcript.

### Agent model overrides

`context` and `sampling` use the same fields documented under `models`. Values
on a population entry override only the named fields; all other values remain
inherited from the selected model. This makes model definitions useful as
run-wide defaults while allowing a population to use a different temperature,
output limit, or context budget.

## `completion`

```yaml
completion:
  enabled: true
```

Completion defaults to enabled. The `complete` tool signals that one agent has
nothing else to do. The run finishes only after every non-errored member has
signalled completion; one agent cannot finish the whole population alone.

Set `enabled: false` for an ongoing run. In that mode completion signals do not
end the zoo, and the process continues until externally stopped or no runnable
condition ends it.

## `services`

```yaml
services: []
```

The standalone distribution has no optional service factories registered by
default. An embedding application may provide named factories to
`buildAgentZoo`; every configured service name must have a corresponding factory
or the build fails. See [Extension points](library/extending.md).
