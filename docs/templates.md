---
title: Templates
description: Define reusable AgentZoo system prompts with the shared TextTemplate renderer.
---

# Templates

Top-level `templates` contain reusable system prompt source. Agent populations
select a template by name with `system`.

```yaml
templates:
  identity: |-
    {#IF name}
    You are {name}.
    {#ELSE}
    You are {agent}.
    {#END}

agents:
  - type: research
    names: [Rowan, Alice]
    model: local
    system: identity
```

## Agent variables

Agent system templates receive:

| Variable | Value                                       |
| -------- | ------------------------------------------- |
| `agent`  | Stable generated ID, such as `research-1`   |
| `id`     | The same stable generated ID                |
| `name`   | Configured `name`/`names` value, or missing |
| `type`   | Population type                             |
| `model`  | Configured model registry key               |

Use `name` when you want a model-facing identity that does not imply the
population type. Use `agent` as a fallback, not as a display name substitute.

## Replacement

Named values use braces:

```text
You are {name}.
```

Inserted values are not parsed again as template source.

## Conditional blocks

Directives are line-oriented. Put each control directive on its own line:

```text
{#IF name}
You are {name}.
{#ELSE}
You are {agent}.
{#END}
```

Negation is supported:

```text
{#IF !name}
You have no configured name.
{#END}
```

Do not write directives inline, such as `{#IF name}{name}{#ELSE}{agent}{#END}`;
inline control directives are treated as ordinary text by the current renderer.

## Iteration and object scope

```text
{#FOR item IN items}
{item}
{#END}
```

`FOR` requires an array. A missing collection produces zero iterations.

Within an object value, `WITH` exposes its direct properties:

```text
{#FOR user IN users}
{#WITH user}
{id}: {username}
{#END}
{#END}
```

## Render-local values

Templates support line-oriented `SET`, `INC`, and `DEC` directives:

```text
{#SET index: 0}
{#INC index}
{index}
```

Values supplied by the render context and temporary loop bindings are read-only
and take precedence over render-local assignments.

## Stable environment context

Configured template text is only one part of the leading system prompt. AgentZoo
always appends a neutral environment contract explaining that the agent operates
in a Linux filesystem and that `/shared` is persistent shared storage. The
initial real directory observation is then merged into that same leading system
message before the first model request.
