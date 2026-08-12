/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Text } from "@deno-ink/core";
import type { ZooSnapshot } from "@agent-zoo/core";
import { formatActivity } from "../activity_format.ts";

export interface ActivityPanelProps {
  events: ZooSnapshot["recentActivity"];
  height: number;
  detailWidth: number;
}

export function ActivityPanel({
  events,
  height,
  detailWidth,
}: ActivityPanelProps) {
  const activity = selectActivity(events, height - 3, detailWidth);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
      height={height}
    >
      <Text bold>Recent activity</Text>
      {activity.length === 0
        ? <Text dimColor>Waiting for lifecycle events...</Text>
        : activity.map(({ event, display }) => (
          <Box key={event.sequence} flexDirection="column">
            <Text wrap="truncate">
              <Text dimColor>{new Date(event.at).toLocaleTimeString()}</Text>
              {" "}
              <Text color={event.kind.includes("error") ? "red" : "white"}>
                {display.headline}
              </Text>
            </Text>
            {display.details.map((line, index) => (
              <Text key={index} dimColor wrap="truncate">{`  ${line}`}</Text>
            ))}
          </Box>
        ))}
    </Box>
  );
}

function selectActivity(
  events: ZooSnapshot["recentActivity"],
  rowBudget: number,
  width: number,
) {
  const selected: Array<{
    event: ZooSnapshot["recentActivity"][number];
    display: ReturnType<typeof formatActivity>;
  }> = [];
  let rows = 0;
  for (const event of events.toReversed()) {
    const display = formatActivity(event, width);
    const needed = 1 + display.details.length;
    if (selected.length && rows + needed > rowBudget) break;
    selected.push({ event, display });
    rows += needed;
  }
  return selected;
}
