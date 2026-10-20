/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { TextTemplate } from "@agent-zoo/shared";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import type { Feature } from "../Feature.ts";
import { observedToolResult } from "../ToolSupport.ts";

const SessionName = z.string().regex(
  /^[a-zA-Z0-9_-]{1,64}$/,
  "Use 1-64 characters of letters, digits, hyphen, or underscore.",
);
const CreateParameters = z.object({
  name: SessionName.describe("A stable name for this interactive terminal."),
  command: z.string().min(1).optional().describe(
    "Program to start directly, for example python3, node, ssh, or vim. Omit for an interactive Bash shell.",
  ),
  args: z.array(z.string()).optional().describe(
    "Arguments passed directly to command. Only use when command is provided.",
  ),
  cwd: z.string().min(1).optional().describe(
    "Working directory inside this computer. Omit to use the current directory.",
  ),
  historyLimit: z.number().int().positive().max(100_000).optional().describe(
    "Maximum scrollback lines retained. Defaults to 50000.",
  ),
});
const NamedParameters = z.object({ name: SessionName });
const EmptyParameters = z.object({});
const ReadParameters = NamedParameters.extend({
  start: z.number().int().optional().describe(
    "First line to capture. Negative values address scrollback; omit for all retained history.",
  ),
  end: z.number().int().optional().describe(
    "Last line to capture. Omit for the current screen.",
  ),
});
const SendParameters = NamedParameters.extend({
  text: z.string().describe("Literal text to type into the terminal."),
  enter: z.boolean().optional().describe(
    "Press Enter after typing. Defaults to true.",
  ),
});
const KeysParameters = NamedParameters.extend({
  keys: z.array(z.string().min(1)).min(1).describe(
    "Terminal key names, for example Up, Down, Enter, Tab, Escape, or C-c.",
  ),
});

/** A persistent interactive terminal inside the calling agent's runtime. */
export class TerminalFeature implements Feature<AgentRunDeps> {
  readonly id = "terminal";
  readonly description =
    "Create and interact with persistent terminals. Use this when a program needs ongoing keyboard input, a screen, or continuity across turns.";
  readonly systemPrompt = new TextTemplate(`## Interactive terminals

Use \`shell\` for normal one-shot commands. Use \`terminal_create\` when a program needs ongoing keyboard input, a persistent screen, or interaction across turns. Read the terminal before deciding what to send. Use \`terminal_send\` for literal text and \`terminal_keys\` for keys such as Up, Enter, Escape, or C-c. Terminals belong only to this computer and persist until you kill them or this computer stops.`);

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const { tool } = await import("@vibesjs/sdk");
    return [
      tool<AgentRunDeps, typeof CreateParameters>({
        name: "terminal_create",
        description:
          "Create a persistent interactive terminal. Use shell for ordinary commands; use this for REPLs, TUIs, games, debuggers, SSH, and programs requiring later input.",
        parameters: CreateParameters,
        argsValidator: ({ command, args }) => {
          if (!command && args?.length) {
            throw new Error(
              "args requires command; omit args when starting the default shell.",
            );
          }
        },
        execute: async (context, params) => {
          const target = terminalTarget(params.name);
          const exists = await hasTerminal(context.deps, target);
          if (exists) {
            return observedToolResult({ name: params.name, status: "exists" });
          }
          const cwd = params.cwd ?? context.deps.cwd;
          const command = [
            "tmux new-session -d",
            `-s ${shellQuote(target)}`,
            `-c ${shellQuote(cwd)}`,
            ...(params.command
              ? [
                shellQuote(params.command),
                ...(params.args ?? []).map(shellQuote),
              ]
              : []),
          ].join(" ");
          const created = await context.deps.runtime.exec(command, { cwd });
          if (created.exitCode !== 0) {
            return terminalFailure(params.name, created.stderr);
          }
          const historyLimit = params.historyLimit ?? 50_000;
          const configured = await context.deps.runtime.exec(
            `tmux set-option -t ${
              shellQuote(target)
            } history-limit ${historyLimit}`,
            { cwd },
          );
          if (configured.exitCode !== 0) {
            await context.deps.runtime.exec(
              `tmux kill-session -t ${shellQuote(target)}`,
              { cwd },
            );
            return terminalFailure(params.name, configured.stderr);
          }
          return observedToolResult({
            name: params.name,
            status: "created",
            cwd,
            command: params.command
              ? [params.command, ...(params.args ?? [])]
              : null,
            historyLimit,
          });
        },
      }),
      tool<AgentRunDeps, typeof EmptyParameters>({
        name: "terminal_list",
        description: "List this computer's active interactive terminals.",
        parameters: EmptyParameters,
        execute: async (context) => {
          const result = await context.deps.runtime.exec(
            "tmux list-sessions -F '#{session_name}'",
            { cwd: context.deps.cwd },
          );
          if (result.exitCode !== 0) {
            return observedToolResult({ terminals: [] });
          }
          return observedToolResult({
            terminals: result.stdout.split("\n")
              .map((target) => terminalName(target.trim()))
              .filter((name): name is string => name !== undefined),
          });
        },
      }),
      tool<AgentRunDeps, typeof ReadParameters>({
        name: "terminal_read",
        description:
          "Read the current screen and retained scrollback as plain text.",
        parameters: ReadParameters,
        execute: async (context, params) => {
          const target = terminalTarget(params.name);
          if (!(await hasTerminal(context.deps, target))) {
            return terminalNotFound(params.name);
          }
          const capture = [
            "tmux capture-pane -p",
            `-S ${params.start === undefined ? "-" : params.start}`,
            ...(params.end === undefined ? [] : [`-E ${params.end}`]),
            `-t ${shellQuote(target)}`,
          ].join(" ");
          const result = await context.deps.runtime.exec(capture, {
            cwd: context.deps.cwd,
          });
          if (result.exitCode !== 0) {
            return terminalFailure(params.name, result.stderr);
          }
          const output = boundText(result.stdout);
          return observedToolResult({
            name: params.name,
            found: true,
            output: output.text,
            truncated: output.truncated,
          });
        },
      }),
      tool<AgentRunDeps, typeof SendParameters>({
        name: "terminal_send",
        description:
          "Type literal text into an interactive terminal, optionally followed by Enter.",
        parameters: SendParameters,
        execute: async (context, params) => {
          const target = terminalTarget(params.name);
          if (!(await hasTerminal(context.deps, target))) {
            return terminalNotFound(params.name);
          }
          const sent = await context.deps.runtime.exec(
            `tmux send-keys -l -t ${shellQuote(target)} ${
              shellQuote(params.text)
            }`,
            { cwd: context.deps.cwd },
          );
          if (sent.exitCode !== 0) {
            return terminalFailure(params.name, sent.stderr);
          }
          if (params.enter !== false) {
            const entered = await context.deps.runtime.exec(
              `tmux send-keys -t ${shellQuote(target)} Enter`,
              { cwd: context.deps.cwd },
            );
            if (entered.exitCode !== 0) {
              return terminalFailure(params.name, entered.stderr);
            }
          }
          return observedToolResult({ name: params.name, status: "sent" });
        },
      }),
      tool<AgentRunDeps, typeof KeysParameters>({
        name: "terminal_keys",
        description:
          "Send symbolic terminal keys such as Up, Down, Enter, Tab, Escape, or C-c.",
        parameters: KeysParameters,
        execute: async (context, params) => {
          const target = terminalTarget(params.name);
          if (!(await hasTerminal(context.deps, target))) {
            return terminalNotFound(params.name);
          }
          const result = await context.deps.runtime.exec(
            `tmux send-keys -t ${shellQuote(target)} ${
              params.keys.map(shellQuote).join(" ")
            }`,
            { cwd: context.deps.cwd },
          );
          return result.exitCode === 0
            ? observedToolResult({ name: params.name, status: "sent" })
            : terminalFailure(params.name, result.stderr);
        },
      }),
      tool<AgentRunDeps, typeof NamedParameters>({
        name: "terminal_clear",
        description:
          "Clear an interactive terminal's retained scrollback history.",
        parameters: NamedParameters,
        execute: (context, params) =>
          terminalCommand(
            context.deps,
            params.name,
            "clear-history",
          ),
      }),
      tool<AgentRunDeps, typeof NamedParameters>({
        name: "terminal_kill",
        description:
          "Terminate an interactive terminal and the process it owns.",
        parameters: NamedParameters,
        execute: (context, params) =>
          terminalCommand(
            context.deps,
            params.name,
            "kill-session",
          ),
      }),
    ];
  }
}

async function terminalCommand(
  deps: AgentRunDeps,
  name: string,
  command: "clear-history" | "kill-session",
) {
  const target = terminalTarget(name);
  if (!(await hasTerminal(deps, target))) return terminalNotFound(name);
  const result = await deps.runtime.exec(
    `tmux ${command} -t ${shellQuote(target)}`,
    { cwd: deps.cwd },
  );
  return result.exitCode === 0
    ? observedToolResult({
      name,
      status: command === "kill-session" ? "killed" : "cleared",
    })
    : terminalFailure(name, result.stderr);
}

async function hasTerminal(
  deps: AgentRunDeps,
  target: string,
): Promise<boolean> {
  const result = await deps.runtime.exec(
    `tmux has-session -t ${shellQuote(target)}`,
    { cwd: deps.cwd },
  );
  return result.exitCode === 0;
}

function terminalNotFound(name: string) {
  return observedToolResult({ name, found: false, status: "not_found" });
}

function terminalFailure(name: string, stderr: string) {
  return observedToolResult({
    name,
    status: "error",
    error: stderr.trim() || "tmux could not complete the terminal operation.",
  });
}

function terminalTarget(name: string): string {
  return `agent-zoo-terminal-${name}`;
}

function terminalName(target: string): string | undefined {
  const prefix = "agent-zoo-terminal-";
  return target.startsWith(prefix) ? target.slice(prefix.length) : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function boundText(value: string, limit = 65_536) {
  return value.length > limit
    ? { text: value.slice(0, limit), truncated: true }
    : { text: value, truncated: false };
}
