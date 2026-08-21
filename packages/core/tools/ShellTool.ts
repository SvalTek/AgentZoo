/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { TextTemplate } from "@agent-zoo/shared";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import type { Feature } from "../Feature.ts";
import type { ShellToolConfig } from "../Config.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
} from "../ToolSupport.ts";

const ShellParameters = z.object({
  command: z.string().optional().describe(
    "The Bash command to execute. Required for execution. It may contain multiple lines. The result reports the exit code, stdout, stderr, timeout, abort status, and truncation flags.",
  ),
  cwd: z.string().optional().describe(
    "Optional directory path only, such as '/root' or '/shared/project'. Do not put commands, operators, redirects, or scripts here. Put all shell code in command. Omit cwd to use the current working directory.",
  ),
  timeoutMs: z.number().int().positive().max(1_800_000).optional().describe(
    "The maximum execution time in milliseconds. Defaults to 120000 and cannot exceed 1800000. Use a longer timeout for operations such as installing software. When reached, the command and processes it started are terminated.",
  ),
});

const SessionName = z.string().regex(
  /^[a-zA-Z0-9_-]{1,64}$/,
  "Use 1-64 characters of letters, digits, hyphen, or underscore.",
);

const StartBackgroundParams = z.object({
  name: SessionName.describe(
    "A unique name for the background session. Reuse the same name to manage the same process later.",
  ),
  command: z.string().describe(
    "The shell command to run inside the background session.",
  ),
  cwd: z.string().optional().describe(
    "Optional working directory for the session. Omit to use the current working directory.",
  ),
});

const StopBackgroundParams = z.object({
  name: SessionName.describe(
    "The name of the background session to stop.",
  ),
});

const GetBackgroundParams = z.object({
  name: SessionName.describe(
    "The name of the background session to inspect.",
  ),
  last: z.number().int().positive().max(100_000).optional().describe(
    "Optional maximum number of trailing lines to return. Omit to capture all available history.",
  ),
});

const SendBackgroundParams = z.object({
  name: SessionName.describe(
    "The name of the background session to send input to.",
  ),
  input: z.string().describe(
    "The text to send to the session, as if typed at its terminal.",
  ),
  enter: z.boolean().optional().describe(
    "Whether to press Enter after the input. Defaults to true.",
  ),
});

/**
 * Deliberately scoped shell access. It never invokes Windows or the runtime
 * host shell: the command enters the calling agent's isolated root first.
 *
 * When constructed with configured tools, those are exposed alongside the
 * raw shell tool whenever this feature is active.
 */
export class ShellFeature implements Feature<AgentRunDeps> {
  readonly id = "shell";
  readonly description =
    "Execute a Bash command. Prefer dedicated command tools when one directly matches the operation; use the shell for shell syntax, pipelines, composition, and operations with no dedicated tool. When filesystem tools are available, use them for ordinary text-file edits.";
  readonly systemPrompt = new TextTemplate(`## Shell

{shellEnvironment}

Use dedicated command tools when one directly matches the operation. Use the shell for commands that need shell syntax, pipelines, or composition, and for operations with no dedicated tool. When filesystem tools are available, use them for ordinary text-file edits.`);

  readonly #configuredTools: Readonly<Record<string, ShellToolConfig>>;

  constructor(
    configuredTools: Readonly<Record<string, ShellToolConfig>> = {},
  ) {
    this.#configuredTools = configuredTools;
  }

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const builtIn = await this.createTool();
    const configured: ToolDefinition<AgentRunDeps>[] = [];
    for (const [name, config] of Object.entries(this.#configuredTools)) {
      configured.push(await this.createConfiguredTool(name, config));
    }
    const background = await this.createBackgroundTools();
    return [builtIn, ...configured, ...background];
  }

  async createTool(): Promise<ToolDefinition<AgentRunDeps>> {
    const { tool } = await import("@vibesjs/sdk");
    return tool<AgentRunDeps, typeof ShellParameters>({
      name: "shell",
      description: this.description,
      parameters: ShellParameters,
      argsValidator: validateShellArguments,
      execute: async (context, parameters) => {
        const command = parameters.command!;
        return executeCommand(
          context.deps,
          command,
          parameters.cwd ?? context.deps.cwd,
          parameters.timeoutMs ?? 120_000,
          { command, cwd: parameters.cwd ?? context.deps.cwd },
        );
      },
    });
  }

  private async createConfiguredTool(
    name: string,
    config: ShellToolConfig,
  ): Promise<ToolDefinition<AgentRunDeps>> {
    const { tool } = await import("@vibesjs/sdk");
    const parameters = compileParamSchema(config.params);
    const commandTemplate = new TextTemplate(config.command);

    return tool<AgentRunDeps, typeof parameters>({
      name,
      description: config.description,
      parameters,
      execute: async (context, params) => {
        const escaped = shellEscapeParams(config.params, params);
        const command = await commandTemplate.render(escaped);
        return executeCommand(
          context.deps,
          command,
          context.deps.cwd,
          120_000,
          { command, params },
        );
      },
    });
  }

  /**
   * Background process management via named tmux sessions. Each session is a
   * real, inspectable, signalable process that survives the tool call that
   * started it. tmux is the source of truth for session existence and liveness.
   */
  private async createBackgroundTools(): Promise<
    ToolDefinition<AgentRunDeps>[]
  > {
    const { tool } = await import("@vibesjs/sdk");

    const startBackground = tool<AgentRunDeps, typeof StartBackgroundParams>({
      name: "start_background",
      description:
        "Start a named background process in its own tmux session. The process keeps running after the tool returns and can be inspected with get_background, sent input with send_background, and stopped with stop_background. Returns the session name.",
      parameters: StartBackgroundParams,
      execute: async (context, params) => {
        const effectiveCwd = params.cwd ?? context.deps.cwd;
        const tmuxArgs = [
          "new-session",
          "-d",
          "-s", shellQuote(params.name),
          "-c", shellQuote(effectiveCwd),
          "bash", "-c", shellQuote(params.command),
        ].join(" ");
        const result = await context.deps.runtime.exec(`tmux ${tmuxArgs}`, {
          cwd: context.deps.cwd,
        });
        if (result.exitCode !== 0) {
          return observedToolResult({
            name: params.name,
            status: "error",
            command: params.command,
            error: result.stderr.trim() ||
              `tmux exited with code ${result.exitCode}`,
          }, { telemetry: { tmuxArgs } });
        }
        return observedToolResult({
          name: params.name,
          status: "started",
          command: params.command,
          cwd: effectiveCwd,
        }, { telemetry: { tmuxArgs } });
      },
    });

    const stopBackground = tool<AgentRunDeps, typeof StopBackgroundParams>({
      name: "stop_background",
      description:
        "Stop a named background session previously started with start_background. Kills the process and removes the session.",
      parameters: StopBackgroundParams,
      execute: async (context, params) => {
        const result = await context.deps.runtime.exec(
          `tmux kill-session -t ${shellQuote(params.name)}`,
          { cwd: context.deps.cwd },
        );
        if (result.exitCode !== 0) {
          const message = result.stderr.trim();
          if (/session not found/i.test(message)) {
            return observedToolResult({
              name: params.name,
              status: "not_found",
            }, { telemetry: { name: params.name } });
          }
          return observedToolResult({
            name: params.name,
            status: "error",
            error: message || `tmux exited with code ${result.exitCode}`,
          }, { telemetry: { name: params.name } });
        }
        return observedToolResult({
          name: params.name,
          status: "stopped",
        }, { telemetry: { name: params.name } });
      },
    });

    const getBackground = tool<AgentRunDeps, typeof GetBackgroundParams>({
      name: "get_background",
      description:
        "Retrieve the captured terminal output of a named background session started with start_background, and report whether the process is still running.",
      parameters: GetBackgroundParams,
      execute: async (context, params) => {
        const has = await context.deps.runtime.exec(
          `tmux has-session -t ${shellQuote(params.name)}`,
          { cwd: context.deps.cwd },
        );
        if (has.exitCode !== 0) {
          return observedToolResult({
            name: params.name,
            found: false,
            alive: false,
            output: "",
          }, { telemetry: { name: params.name } });
        }
        const capture = await context.deps.runtime.exec(
          `tmux capture-pane -t ${shellQuote(params.name)} -p -S ${
            params.last ? `-${params.last}` : "-"
          }`,
          { cwd: context.deps.cwd },
        );
        const dead = await context.deps.runtime.exec(
          `tmux list-panes -t ${shellQuote(params.name)} -F '#{pane_dead}'`,
          { cwd: context.deps.cwd },
        );
        const alive = dead.exitCode === 0 && dead.stdout.trim() !== "1";
        return observedToolResult({
          name: params.name,
          found: true,
          alive,
          output: capture.stdout,
        }, { telemetry: { name: params.name } });
      },
    });

    const sendBackground = tool<AgentRunDeps, typeof SendBackgroundParams>({
      name: "send_background",
      description:
        "Send keystrokes to a named background session, as if typed at its terminal. By default a newline (Enter) is appended after the input.",
      parameters: SendBackgroundParams,
      execute: async (context, params) => {
        const keys = params.enter === false
          ? shellQuote(params.input)
          : `${shellQuote(params.input)} Enter`;
        const result = await context.deps.runtime.exec(
          `tmux send-keys -t ${shellQuote(params.name)} ${keys}`,
          { cwd: context.deps.cwd },
        );
        if (result.exitCode !== 0) {
          const message = result.stderr.trim();
          if (/session not found/i.test(message)) {
            return observedToolResult({
              name: params.name,
              status: "not_found",
            }, { telemetry: { name: params.name, input: params.input } });
          }
          return observedToolResult({
            name: params.name,
            status: "error",
            error: message || `tmux exited with code ${result.exitCode}`,
          }, { telemetry: { name: params.name, input: params.input } });
        }
        return observedToolResult({
          name: params.name,
          status: "sent",
          input: params.input,
        }, { telemetry: { name: params.name, input: params.input } });
      },
    });

    return [startBackground, stopBackground, getBackground, sendBackground];
  }
}

/** Shared bash execution path for both raw and configured shell tools. */
async function executeCommand(
  deps: AgentRunDeps,
  command: string,
  cwd: string,
  timeoutMs: number,
  telemetry: unknown,
): Promise<ReturnType<typeof observedToolResult>> {
  let result;
  try {
    result = await deps.runtime.exec(
      ["/bin/bash", "--login", "-c", command],
      {
        cwd,
        timeoutMs,
        signal: deps.signal,
      },
    );
  } catch (error) {
    throw new ToolExecutionError("The command could not be executed.", {
      error,
    });
  }
  const stdout = boundText(result.stdout);
  const stderr = boundText(result.stderr);
  const modelResult = {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    aborted: result.aborted,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    ...(result.timedOut
      ? { message: shellTimeoutMessage(command, timeoutMs) }
      : {}),
  };
  return observedToolResult(modelResult, { telemetry, result });
}

/** Compile a params config block into a runtime Zod object schema. */
function compileParamSchema(
  params: Readonly<Record<string, {
    type: "string" | "number" | "boolean";
    required: boolean;
    array: boolean;
    description: string;
  }>>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, def] of Object.entries(params)) {
    let base: z.ZodTypeAny;
    switch (def.type) {
      case "string":
        base = z.string();
        break;
      case "number":
        base = z.number();
        break;
      case "boolean":
        base = z.boolean();
        break;
    }
    base = base.describe(def.description);
    if (def.array) base = z.array(base);
    if (!def.required) base = base.optional();
    shape[name] = base;
  }
  return z.object(shape);
}

/**
 * Shell-escape string parameter values before TextTemplate rendering.
 *
 * Strings become individually quoted. Arrays of strings become arrays of
 * individually quoted strings (preserving the array for {#FOR}).
 * Booleans and numbers pass through unchanged ({#IF} needs real booleans).
 */
function shellEscapeParams(
  paramDefs: Readonly<Record<string, {
    type: "string" | "number" | "boolean";
    array: boolean;
  }>>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const escaped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const def = paramDefs[key];
    if (!def) {
      escaped[key] = value;
      continue;
    }
    if (def.type === "string" && def.array && Array.isArray(value)) {
      escaped[key] = value.map((v) => shellQuote(String(v)));
    } else if (def.type === "string" && typeof value === "string") {
      escaped[key] = shellQuote(value);
    } else {
      escaped[key] = value;
    }
  }
  return escaped;
}

/** Quote a string for safe inclusion in a bash -c command. */
function shellQuote(value: string): string {
  // Replace each single quote with '\'' (end quote, escaped quote, start quote)
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellTimeoutMessage(command: string, timeoutMs: number): string {
  const elapsed = formatTimeout(timeoutMs);
  const stopped =
    `The command exceeded its ${elapsed} timeout and was stopped.`;
  if (!invokesDebianPackageManager(command)) {
    return `${stopped} Retry with a longer timeoutMs if the command is expected to take longer.`;
  }
  return `${stopped} A terminated package-manager operation may have left an interrupted transaction. Before another installation, run "dpkg --configure -a" if recovery is required. Package installations can take longer; retry with a longer timeoutMs or use smaller separate commands.`;
}

function invokesDebianPackageManager(command: string): boolean {
  return /(?:^|[\s;&|()])(?:sudo\s+)?(?:\/usr\/(?:s?bin)\/)?(?:apt(?:-get)?|dpkg)(?=\s|$)/m
    .test(command);
}

function formatTimeout(timeoutMs: number): string {
  if (timeoutMs % 60_000 === 0) {
    const minutes = timeoutMs / 60_000;
    return `${minutes}-minute`;
  }
  if (timeoutMs % 1_000 === 0) {
    const seconds = timeoutMs / 1_000;
    return `${seconds}-second`;
  }
  return `${timeoutMs}-millisecond`;
}

function validateShellArguments(
  parameters: z.infer<typeof ShellParameters>,
): void {
  if (!parameters.command?.trim()) {
    if (parameters.cwd && containsShellSyntax(parameters.cwd)) {
      throw actionableToolError(
        [
          "No command was provided, and cwd appears to contain shell commands.",
          'Put the shell code in command. cwd accepts only an optional directory path. Example: {"command":"python3 verify.py","cwd":"/shared/calculator"}',
        ],
        { command: parameters.command, cwd: parameters.cwd },
      );
    }
    throw actionableToolError(
      [
        "No shell command was provided.",
        "Provide the command to execute in command.",
      ],
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  if (parameters.cwd !== undefined && !parameters.cwd.trim()) {
    throw actionableToolError(
      [
        "cwd is empty.",
        "Provide a directory path in cwd, or omit cwd to use the current working directory.",
      ],
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  if (parameters.cwd && containsShellSyntax(parameters.cwd)) {
    throw actionableToolError(
      [
        "cwd accepts only a directory path.",
        "Put all shell commands in command, or omit cwd to use the current working directory.",
      ],
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  const effectiveTimeoutMs = parameters.timeoutMs ?? 120_000;
  if (
    invokesPackageManager(parameters.command) &&
    effectiveTimeoutMs <= 180_000
  ) {
    throw actionableToolError(
      [
        "The command runs a package manager with a timeout of 3 minutes or less.",
        "No command was started.",
        "Package operations can take longer, especially while downloading or installing dependencies.",
        "Set timeoutMs to at least 300000 and retry.",
      ],
      {
        command: parameters.command,
        cwd: parameters.cwd,
        timeoutMs: parameters.timeoutMs,
        effectiveTimeoutMs,
      },
    );
  }
}

function invokesPackageManager(command: string): boolean {
  return command.split(/&&|\|\||[;|()\r\n]/).some((part) => {
    const segment = part.trim()
      .replace(/^(?:(?:if|then|do|while|until|!|command|exec)\s+)+/, "")
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "")
      .replace(/^sudo(?:\s+-\S+)*\s+/, "")
      .replace(/^env(?:\s+(?:-\S+|[A-Za-z_][A-Za-z0-9_]*=\S+))*\s+/, "");
    const packageManager =
      /^(?:\/[^\s]+\/)?(?:apt(?:-get)?|dpkg|npm|yarn|pnpm|pip3?|brew)(?=\s|$)/
        .test(segment) ||
      /^(?:\/[^\s]+\/)?python3?\s+-m\s+pip(?=\s|$)/.test(segment);
    const readOnlyQuery = [
      /^(?:\/[^\s]+\/)?(?:apt(?:-get)?|npm|yarn|pnpm|brew)\s+(?:list|ls|search|show|info|policy|depends|rdepends|outdated|why|--help|--version|-h|-v)(?=\s|$)/,
      /^(?:\/[^\s]+\/)?dpkg\s+(?:-[lLsS]|--(?:list|status|listfiles|search|get-selections|print-architecture|print-foreign-architectures|audit|help|version))(?=\s|$)/,
      /^(?:\/[^\s]+\/)?pip3?\s+(?:list|show|freeze|check|debug|--help|--version|-h|-V)(?=\s|$)/,
      /^(?:\/[^\s]+\/)?python3?\s+-m\s+pip\s+(?:list|show|freeze|check|debug|--help|--version|-h|-V)(?=\s|$)/,
    ].some((pattern) => pattern.test(segment));
    return packageManager && !readOnlyQuery;
  });
}

function containsShellSyntax(value: string): boolean {
  return /[\r\n;&|<>`]/.test(value);
}

function boundText(value: string, limit = 65_536): {
  text: string;
  truncated: boolean;
} {
  return value.length > limit
    ? { text: value.slice(0, limit), truncated: true }
    : { text: value, truncated: false };
}
