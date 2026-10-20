---
name: interactive-work
description: Choose correctly between shell commands, background processes, and persistent interactive terminals.
---

# Work with commands, processes, and terminals

Use the right interface for the kind of program you are running. These tools
all execute inside this agent's isolated Linux computer, but they have
different lifetimes and interaction models.

## Choose the right tool

| Need | Use | Why |
| --- | --- | --- |
| Run a command and receive its final output | `shell` | It runs one Bash command, waits for it to finish, and returns stdout, stderr, and exit status. |
| Start work that should continue without a screen or later typed input | `start_background` | It owns a named background process that can later be inspected, sent text, or stopped. |
| Use a REPL, TUI, debugger, SSH session, editor, game, or any program needing a screen or keys across turns | `terminal_create` | It creates a persistent interactive terminal whose screen can be read and controlled later. |

If `view_image` is available, use it to inspect image files when visual evidence
matters.

## One-shot shell commands

Call `shell` with Bash code in `command`, not in `cwd`. `cwd` is only an
optional directory path. The command runs through a login Bash shell, waits for
completion, and is the normal choice for inspection, builds, tests, and other
bounded work.

```json
{"command":"deno task test","cwd":"/root/project"}
```

The default timeout is two minutes. Use `timeoutMs` only when the command is
expected to take longer; it has an upper limit. A shell call is not interactive:
once it starts, you cannot type into it or inspect its live screen.

## Unattended background processes

Use `start_background` when a process should outlive the current tool call but
does not need a terminal-style conversation. Give it a stable, descriptive
name and an explicit command:

```json
{"name":"local-server","command":"deno task dev","cwd":"/root/project"}
```

Then use the matching background tools:

1. `get_background` reads captured output and reports whether the process is
   still alive. Call it before assuming startup succeeded.
2. `send_background` sends text; it presses Enter by default. Set `enter` to
   `false` only when the program expects raw partial input.
3. `stop_background` terminates the named process when it is no longer needed.

Background process names belong to the `start_background` family. Do not use
`terminal_read`, `terminal_send`, or `terminal_kill` to manage them.

## Persistent interactive terminals

Use `terminal_create` when you need to see a changing screen or make several
input decisions over time. A terminal is named, survives later turns, and is
owned only by this agent.

To start an interactive Python session:

```json
{"name":"python","command":"python3","cwd":"/root/project"}
```

`command` starts one program directly; `args` supplies its separate arguments.
For shell syntax such as pipes or redirects, use `shell`, or intentionally
start Bash as the terminal program with explicit arguments.

### Interactive loop

1. Use `terminal_list` before creating or reusing a name. Creating an existing
   terminal returns `exists`; it does not replace the running program.
2. Create it with `terminal_create`.
3. Call `terminal_read` before deciding what to type. Its `output` contains the
   current screen and retained scrollback. Use `start` and `end` only when you
   need a specific part of that history.
4. Use `terminal_send` for literal text. It presses Enter by default.
5. Use `terminal_keys` for keys and control sequences: `Up`, `Down`, `Tab`,
   `Escape`, `Enter`, or `C-c`. Do not send the characters `C-c` as ordinary
   text when you mean interrupt.
6. Read the terminal again after sending input; do not guess what the program
   displayed or whether it accepted the input.
7. Use `terminal_kill` to stop the terminal and the process it owns when the
   task is done. Use `terminal_clear` only to discard retained scrollback.

Terminal names are separate from background-process names. `terminal_list`
shows only terminals created with `terminal_create`; it intentionally does not
list processes started by `start_background`.

## Report the real state

Keep process and terminal names explicit in your work. Before reporting that a
server, REPL, or interactive program is ready, inspect its current output. If
it cannot be reached or controlled with the exposed tools, state that boundary
instead of inferring success.
