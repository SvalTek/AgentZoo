/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";

const NoParameters = z.object({});
const CompletionParameters = z.object({
  reason: z.string().optional().describe(
    "An optional brief explanation of why no further action is needed. It is reported as the outcome.",
  ),
});

export function createYieldTool(): ToolDefinition<AgentRunDeps> {
  return {
    name: "yield",
    description: "Stop for now.",
    parameters: NoParameters,
    isOutput: true,
    execute: (context) => {
      context.deps.control.requested = "yield";
      return Promise.resolve("Stopped.");
    },
  };
}

export function createCompletionTool(): ToolDefinition<AgentRunDeps> {
  return {
    name: "complete",
    description: "Signal that you have nothing else to do.",
    parameters: CompletionParameters,
    isOutput: true,
    execute: (context, parameters) => {
      context.deps.control.requested = "complete";
      const { reason } = parameters as z.infer<typeof CompletionParameters>;
      return Promise.resolve(reason?.trim() || "Recorded.");
    },
  };
}
