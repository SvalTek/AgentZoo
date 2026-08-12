/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Spinner, Text } from "@deno-ink/core";
import type { ZooState } from "@agent-zoo/core";
import { activityLogName } from "../ActivityLog.ts";

export interface DashboardHeaderProps {
  state: ZooState;
  configPath: string;
  logPath: string;
  elapsedMs: number;
  objective?: string;
}

export function DashboardHeader({
  state,
  configPath,
  logPath,
  elapsedMs,
  objective,
}: DashboardHeaderProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color="cyan" bold>AgentZoo</Text>
          <Text>{state.toUpperCase()}</Text>
          {state === "running" && <Spinner type="dots" color="green" />}
          <Text dimColor wrap="truncate">
            config: {configPath} · log: {activityLogName(logPath)}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color="cyan">Run {formatRunElapsed(elapsedMs)}</Text>
        </Box>
      </Box>
      {objective && (
        <Text wrap="truncate">
          <Text color="cyan" bold>Objective:</Text>
          {objective}
        </Text>
      )}
    </Box>
  );
}

export function formatRunElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}
