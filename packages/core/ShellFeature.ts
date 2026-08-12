/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "./Agent.ts";
import type { Feature } from "./Feature.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
} from "./ToolSupport.ts";

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

/**
 * Deliberately scoped shell access. It never invokes Windows or the runtime
 * host shell: the command enters the calling agent's isolated root first.
 */
export class ShellFeature implements Feature<AgentRunDeps> {
  readonly id = "shell";
  readonly description = "Execute a shell command.";

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    return [await this.createTool()];
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
        let result;
        try {
          result = await context.deps.runtime.exec(
            ["/bin/bash", "--login", "-c", command],
            {
              cwd: parameters.cwd ?? context.deps.cwd,
              timeoutMs: parameters.timeoutMs ?? 120_000,
              signal: context.deps.signal,
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
            ? {
              message: shellTimeoutMessage(
                command,
                parameters.timeoutMs ?? 120_000,
              ),
            }
            : {}),
        };
        return observedToolResult(modelResult, {
          command,
          cwd: parameters.cwd ?? context.deps.cwd,
          result,
        });
      },
    });
  }
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
        "No command was provided, and cwd appears to contain shell commands.",
        'Put the shell code in command. cwd accepts only an optional directory path. Example: {"command":"python3 verify.py","cwd":"/shared/calculator"}',
        { command: parameters.command, cwd: parameters.cwd },
      );
    }
    throw actionableToolError(
      "No shell command was provided.",
      "Provide the command to execute in command.",
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  if (parameters.cwd !== undefined && !parameters.cwd.trim()) {
    throw actionableToolError(
      "cwd is empty.",
      "Provide a directory path in cwd, or omit cwd to use the current working directory.",
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  if (parameters.cwd && containsShellSyntax(parameters.cwd)) {
    throw actionableToolError(
      "cwd accepts only a directory path.",
      "Put all shell commands in command, or omit cwd to use the current working directory.",
      { command: parameters.command, cwd: parameters.cwd },
    );
  }
  const effectiveTimeoutMs = parameters.timeoutMs ?? 120_000;
  if (
    invokesPackageManager(parameters.command) &&
    effectiveTimeoutMs <= 180_000
  ) {
    throw actionableToolError(
      "The command runs a package manager with a timeout of 3 minutes or less.",
      "Package operations can take longer, especially while downloading or installing dependencies. Set timeoutMs to at least 300000 and retry.",
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
