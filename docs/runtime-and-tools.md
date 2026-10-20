---
title: Runtime and Tools
description: Understand AgentZoo filesystem isolation, shared storage, and model-visible tools.
---

# Runtime and tools

## Filesystem model

AgentZoo starts one privileged Docker runtime host. Inside it, each agent gets a
private OverlayFS copy-on-write root and commands enter that root through a
chroot.

Consequences:

- Changes under `/root`, `/etc`, `/tmp`, installed packages, and other ordinary
  paths belong to that agent.
- Another agent does not see those private changes.
- `/shared` is deliberately mounted into every agent environment.
- The configured `cwd` refers to a path inside the agent environment.
- Shell and filesystem convenience tools see the same namespace. If `shell`
  writes `/root/a.txt`, `read_file` reads that same file.
- Each agent receives a private minimal `/dev` with a private `/dev/shm`, and a
  persistent private PID namespace with its own `/proc`. The devpts instance is
  shared with the runtime host so an attached terminal resolves its pty, which
  `docker exec` allocated in that instance. Background processes remain visible
  to later commands in the same environment but are not visible or signalable
  from another agent environment.
- Debian package management is available inside the private root; packages
  installed by one agent remain private to that agent.

Docker is the outer host, not the per-agent isolation unit. AgentZoo does not
create a Docker container for every agent.

Runtime containers and their named data volumes are labelled with
`agent-zoo.managed`, `agent-zoo.resource`, `agent-zoo.run`, `agent-zoo.created`,
and `agent-zoo.project`. Runtime images carry the managed and resource labels.
These labels are the resource-management ownership boundary; cleanup does not
infer ownership from Docker object names.

## Model-visible neutrality

Tool names and descriptions expose immediate computer capabilities without
describing the scheduler, population, experiment, Docker, OverlayFS, or host
paths. `/shared` exists naturally in the filesystem; tools do not prescribe a
collaboration protocol for it.

## MCP toolsets

MCP servers are Zoo-owned host connections, not tools executed inside an agent's
private runtime. Each assigned server is represented by its own Vibes toolset.
The model initially sees the assigned server names and descriptions plus
`list_tools`, `list_resources`, and `read_resource`. Calling `list_tools`
discovers one server's tools and exposes that server's direct tools on the next
model turn. `list_resources` returns its resources and resource templates;
`read_resource` reads a discovered URI. Unrequested toolsets stay hidden and do
not connect. Vibes caches each discovered server's tool list. AgentZoo creates a
transport only on first discovery and performs one clean reconnect/re-discovery
when a previously healthy server no longer answers discovery. It never replays a
failed tool call. If a selected server remains unavailable, AgentZoo omits it
for that activation and emits a prominent MCP-unavailable activity event.
AgentZoo prefixes every server's tool names as `mcp_<server>_` before
composition, then records MCP calls through the same correlated tool lifecycle
events as built-in tools.

Tool schemas are part of each provider request. AgentZoo measures the resolved
per-turn tool surface—including MCP servers requested during the current
activation—before history trimming and reserves it together with the system
prompt and configured output allowance. Unrequested MCP schemas do not consume
that context budget. The three small MCP discovery and resource builtins are
present for agents assigned MCP servers.

MCP tool results are returned as text, and resource reads as JSON containing
text or base64 resource content. These results are not passed as native
multimodal content; do not rely on MCP for workflows that require native image
or other structured-content handling.

## Interactive terminals

The opt-in `terminal` feature gives an agent persistent interactive terminals
inside its own isolated runtime. It is for REPLs, TUIs, debuggers, interactive
programs, SSH, and development servers that require later keyboard input. Use
`shell` for ordinary one-shot commands instead.

The feature exposes `terminal_create`, `terminal_list`, `terminal_read`,
`terminal_send`, `terminal_keys`, `terminal_clear`, and `terminal_kill`.
Sessions persist across model turns, activations, yields, and idle periods; an
agent may stop them explicitly, and runtime teardown stops all of them.

`terminal_read` returns a bounded plain-text tmux capture. Interactive programs
therefore receive a real terminal while AgentZoo renders only inert text in its
own TUI. Use `terminal_send` for literal text (optionally followed by Enter) and
`terminal_keys` for symbolic keys such as `Up`, `Escape`, or `C-c`.

## Lifecycle tools

### `yield`

Description: `Stop for now.`

Ends the current activation without destroying the agent. Conversation state is
retained and the agent becomes idle. On a later activation it receives a
system-role message containing
`Automated activity update: You have been idle for <duration>.`

### `complete`

Description: `Signal that you have nothing else to do.`

Available only when completion is enabled. Its population-level agreement
semantics remain internal to the runner. An optional `reason` parameter can
briefly explain why no further action is needed.

## `shell` feature

Exposes one tool:

```text
shell — Execute a shell command.
```

The command runs using login Bash inside the calling agent's environment. Inputs
are:

- `command` — Bash command text, required for execution; multiline commands are
  supported.
- `cwd` — optional directory path only; defaults to the agent's configured cwd.
  Commands, operators, and redirects belong in `command`, not `cwd`.
- `timeoutMs` — optional positive timeout, capped at 1,800,000 ms. The default
  is 120,000 ms. On timeout, the runtime terminates the command and its
  descendant process group before returning control. A pipeline or package
  installation does not continue secretly after a timed-out result. Unrelated
  background processes started by an earlier completed command are not
  terminated.

Model-visible stdout and stderr are each bounded to 65,536 characters and report
whether truncation occurred. Durable telemetry retains the complete available
runtime result.

When a tool can identify a specific input or operation failure, its error also
states the smallest safe correction. Provider-facing schemas describe each
argument, while semantic validation admits incomplete but diagnosable calls and
returns a specific repair before execution. For example, `shell` recognizes a
missing `command` whose text was accidentally placed in `cwd` and tells the
caller where each value belongs; exact-text edits suggest rereading the file or
disambiguating the match. Arbitrary command failures remain ordinary shell
results because the tool cannot reliably infer how an unknown program should be
repaired.

## `filesystem` feature

This feature exposes six structured convenience tools. They use the same runtime
execution boundary as `shell`.

### `read_file`

Reads UTF-8 text from `path`. `offset` defaults to 0 and `limit` defaults to
65,536 bytes, with a maximum of 262,144. The result reports file size, bytes
read, truncation, and `nextOffset` when more data remains. Binary/non-UTF-8
content produces a neutral error.

### `write_file`

Writes the multiline `content` string to `path`. Normal line breaks are accepted
directly. With no `mode`, it uses `create`: a new file is created, but an
existing path is never replaced. Use `mode: append` to add content. Replacing an
entire existing file is deliberately explicit and requires both
`mode: overwrite` and `force: true`. Missing parent directories are not created
automatically. For a small exact change to an existing file, prefer `edit_file`;
for larger or multi-region changes, prefer `apply_patch`.

### `edit_file`

Replaces the exact `oldText` with `newText`. Both accept normal multiline text;
an empty `newText` deletes the match. `oldText` and `newText` are each limited
to 8,192 characters. By default there must be exactly one match. Zero matches
and ambiguous multiple matches fail. Set `replaceAll: true` to replace every
exact match. Files larger than 4 MiB and binary files are rejected.

### `apply_patch`

Applies the multiline `patch` string as a unified diff using `git apply`. Paths
are resolved from the optional `cwd`, or the agent's configured working
directory when omitted. Inside a Git worktree it uses normal repository-aware
`git apply`; elsewhere it falls back to `git apply --no-index`. The patch is
checked before it is applied and the result summarizes changed files.

### `list_directory`

Lists only immediate entries in `path`, or the configured cwd when omitted.
Results include name, type, and size. It does not recurse.

### `search_files`

Searches beneath `path`, or the configured cwd when omitted. Optional filters
are:

- `name` — a filename glob.
- `text` — exact text to find; may be combined with `name`.

With neither filter, `name` defaults to `*` for bounded recursive discovery.
`maxResults` defaults to 50 and is capped at 200. Text results include paths,
line numbers, and bounded snippets. The result reports truncation.

## Optional `http` feature

Add `http` explicitly:

```yaml
features: [shell, filesystem, http]
```

It exposes `http_request`, a raw HTTP/HTTPS request tool. Inputs include URL,
method, headers, and body. It follows at most five redirects and enforces a
120-second request limit. The model receives selected response headers and at
most 65,536 bytes of body content, with truncation indicated. Durable telemetry
retains up to 1 MiB of response body.

The feature does not add search, browser automation, or research behavior.

## Optional `vision` feature

Add `vision` explicitly:

```yaml
features: [shell, filesystem, vision]
```

It exposes `view_image`, which lets the model view an image file from the
computer. `path` selects the image as an absolute path or a path relative to the
current working directory; an optional `cwd` sets the directory the path is
resolved from and defaults to the current working directory. The complete image
is read and returned to the model. The image type is detected from the file's
magic bytes (PNG, JPEG, GIF, WebP, BMP, and JPEG 2000); a file that is not a
recognized image produces an error.

When the agent configures `captioningModel`, `view_image` delegates captioning
to that model instead of the agent's own model. Otherwise it uses the agent's
own model.

## Features are interfaces, not capability sandboxes

Removing `filesystem` removes its structured helpers, not the ability to use
ordinary filesystem commands through `shell`. Likewise, the tool list is part of
the model-facing environment: configure it deliberately.
