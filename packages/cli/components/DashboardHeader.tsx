/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Spinner, Text } from "@deno-ink/core";
import type { ZooState } from "@agent-zoo/core";

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
        <Box flexShrink={0}>
          <Text color="cyan" bold>AgentZoo </Text>
          {state === "running" && <Spinner type="dots" color="green" />}
        </Box>

        <Box flexGrow={1} flexShrink={1} marginLeft={2}>
          <Text dimColor wrap="truncate">
            config: {configPath}
          </Text>
        </Box>

        <Box flexShrink={0} marginLeft={2}>
          <Text color="cyan">Run: {formatRunElapsed(elapsedMs)}</Text>
        </Box>
      </Box>

      {objective && (
        <Text wrap="truncate">
          <Text color="cyan" bold>Objective:</Text>
          {" "}
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
