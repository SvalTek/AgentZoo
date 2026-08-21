/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Text, useInput, useTerminalSize } from "@deno-ink/core";
import type { AgentZoo } from "@agent-zoo/core";
import { useZooSnapshot } from "../hooks/useZooSnapshot.ts";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { AgentPanel } from "./AgentPanel.tsx";
import { DashboardHeader } from "./DashboardHeader.tsx";

export interface ZooDashboardProps {
  zoo: AgentZoo;
  configPath: string;
  logPath: string;
  objective?: string;
}

export function ZooDashboard({
  zoo,
  configPath,
  logPath,
  objective,
}: ZooDashboardProps) {
  const { snapshot, runStartedAt } = useZooSnapshot(zoo);
  const terminal = useTerminalSize();
  useInput((input) => {
    if (input.toLowerCase() === "q") void zoo.stop("dashboard quit");
  });

  const activityHeight = Math.max(
    10,
    terminal.rows - snapshot.agents.length * 3 - (objective ? 9 : 8),
  );
  return (
    <Box
      flexDirection="column"
      width={terminal.columns}
      height={terminal.rows}
      paddingX={1}
    >
      <DashboardHeader
        state={snapshot.state}
        configPath={configPath}
        logPath={logPath}
        objective={objective}
        elapsedMs={runStartedAt === undefined ? 0 : Date.now() - runStartedAt}
      />
      <AgentPanel agents={snapshot.agents} />
      <ActivityPanel
        events={snapshot.recentActivity}
        height={activityHeight}
        // Root padding (2), activity-panel border/padding (4), and the timeline rail (5)
        // leave this exact width for normal text and tool cards.
        detailWidth={Math.max(30, terminal.columns - 11)}
      />
      <Text dimColor>↑↓ select and scroll · Home/End oldest/latest · Enter expand/collapse a tool · q / Ctrl+C stop gracefully</Text>
    </Box>
  );
}
