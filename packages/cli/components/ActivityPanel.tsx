/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Text, useInput } from "@deno-ink/core";
import type { ZooSnapshot } from "@agent-zoo/core";
import { useEffect, useMemo, useState } from "react";
import {
  type ActivityDisplay,
  projectActivity,
  type ToolActivityDisplay,
} from "../activity_format.ts";
import {
  activityDisplayKey,
  type ActivityViewportFragment,
  buildActivityFragments,
  formatTime,
  selectViewportWindow,
  tailViewportStart,
  toolCardWidth,
} from "../activity_viewport.ts";

export interface ActivityPanelProps {
  events: ZooSnapshot["recentActivity"];
  height: number;
  detailWidth: number;
}

/** The fixed frame around the independently scrolling activity timeline. */
export function ActivityPanel(
  { events, height, detailWidth }: ActivityPanelProps,
) {
  const displays = projectActivity(events, detailWidth);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
      height={height}
    >
      <ScrollView
        displays={displays}
        height={Math.max(2, height - 2)}
        detailWidth={detailWidth}
      />
    </Box>
  );
}

/**
 * A ScrollView composed from Ink primitives.
 *
 * Ink 0.2.1 offers layout but no clipping or scroll primitive. This component
 * owns the virtual scroll position and mounts only the measured event fragments
 * that fit into its fixed body height; the surrounding ActivityPanel is only a
 * frame, not a pretend clipping boundary.
 */
function ScrollView(
  { displays, height, detailWidth }: {
    displays: readonly ActivityDisplay[];
    height: number;
    detailWidth: number;
  },
) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [scrollStartKey, setScrollStartKey] = useState<string>();
  const [followTail, setFollowTail] = useState(true);
  const bodyHeight = Math.max(1, height - 1);
  const fragments = useMemo(
    () => buildActivityFragments(displays, detailWidth, bodyHeight, expanded),
    [displays, detailWidth, bodyHeight, expanded],
  );
  const keys = fragments.map((fragment) => fragment.key);
  const tailStart = tailViewportStart(fragments, bodyHeight);
  const startIndex = followTail ? tailStart : Math.max(
    0,
    scrollStartKey === undefined ? 0 : keys.indexOf(scrollStartKey),
  );
  const visible = selectViewportWindow(fragments, bodyHeight, startIndex);
  // The first mounted event is the keyboard focus. It moves with normal
  // terminal scrolling, while every message as well as every tool is reachable.
  const active = visible[0];

  useEffect(() => {
    if (
      !fragments.length || followTail || !scrollStartKey ||
      keys.includes(scrollStartKey)
    ) return;
    // Bounded runner history removed the selected fragment. Remain at the
    // retained oldest item rather than jumping to new activity.
    setScrollStartKey(keys[0]);
  }, [fragments.length, followTail, keys, scrollStartKey]);

  useInput((input, key) => {
    if (!fragments.length) return;
    if (key.end || input.includes("\u001b[F") || input.includes("\u001b[4~")) {
      setFollowTail(true);
      return;
    }
    if (key.home || input.includes("\u001b[H") || input.includes("\u001b[1~")) {
      setFollowTail(false);
      setScrollStartKey(keys[0]);
      return;
    }
    if (key.upArrow || input.includes("\u001b[A")) {
      const next = Math.max(0, startIndex - 1);
      setFollowTail(false);
      setScrollStartKey(keys[next]);
      return;
    }
    if (key.downArrow || input.includes("\u001b[B")) {
      const next = Math.min(tailStart, startIndex + 1);
      setFollowTail(next === tailStart);
      setScrollStartKey(keys[next]);
      return;
    }
    if (
      (key.return || input.includes("\r") || input.includes("\n")) &&
      active?.display.type === "tool"
    ) {
      const tool = active.display;
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(tool.key)) next.delete(tool.key);
        else next.add(tool.key);
        return next;
      });
      // Expansion changes fragment boundaries, but this source event remains.
      setFollowTail(false);
      setScrollStartKey(`${activityDisplayKey(tool)}:0`);
    }
  });

  return (
    <Box flexDirection="column" height={height}>
      <ScrollHeader
        fragments={fragments}
        visible={visible}
        followTail={followTail}
      />
      <Box flexDirection="column" height={bodyHeight}>
        {!visible.length
          ? <Text dimColor>Waiting for lifecycle events...</Text>
          : visible.map((fragment) => (
            <TimelineFragment
              key={fragment.key}
              fragment={fragment}
              detailWidth={detailWidth}
              selected={fragment.key === active?.key}
            />
          ))}
      </Box>
    </Box>
  );
}

function ScrollHeader(
  { fragments, visible, followTail }: {
    fragments: readonly ActivityViewportFragment[];
    visible: readonly ActivityViewportFragment[];
    followTail: boolean;
  },
) {
  const first = visible.length ? fragments.indexOf(visible[0]) : -1;
  const last = visible.length ? fragments.indexOf(visible.at(-1)!) : -1;
  const position = first < 0 || last < 0
    ? undefined
    : `${first + 1}–${last + 1} / ${fragments.length} · ${
      followTail ? "latest" : `${fragments.length - last - 1} newer`
    }`;
  return (
    <Box>
      <Text bold>Recent activity</Text>
      <Box flexGrow={1} />
      {position && <Text dimColor>{position}</Text>}
    </Box>
  );
}

function TimelineFragment(
  { fragment, detailWidth, selected }: {
    fragment: ActivityViewportFragment;
    detailWidth: number;
    selected: boolean;
  },
) {
  const tool = fragment.display.type === "tool" ? fragment.display : undefined;
  const color = tool
    ? toolColor(tool)
    : messageColor(fragment.display.headline);
  return (
    <Box>
      <TimelineRail tool={tool} color={color} />
      <Box flexDirection="column" width={detailWidth}>
        <Text color={color} inverse={selected} wrap="wrap">
          <Text dimColor>{formatTime(fragment.display.at)}</Text>{" "}
          {fragment.headline}
        </Text>
        {tool
          ? (
            <ToolFragmentCard
              fragment={fragment}
              tool={tool}
              detailWidth={detailWidth}
              selected={selected}
            />
          )
          : <MessageFragmentBody fragment={fragment} />}
      </Box>
    </Box>
  );
}

function TimelineRail(
  { tool, color }: { tool?: ToolActivityDisplay; color: string },
) {
  return (
    <Box width={5} flexDirection="column" alignItems="center">
      <Text color={color}>{tool ? "▣" : "●"}</Text>
      <Text dimColor>│</Text>
    </Box>
  );
}

function MessageFragmentBody(
  { fragment }: { fragment: ActivityViewportFragment },
) {
  return (
    <Box flexDirection="column">
      {fragment.body.map((line, index) => <Text key={index}>{line}</Text>)}
    </Box>
  );
}

function ToolFragmentCard(
  { fragment, tool, detailWidth, selected }: {
    fragment: ActivityViewportFragment;
    tool: ToolActivityDisplay;
    detailWidth: number;
    selected: boolean;
  },
) {
  const width = toolCardWidth(tool.details, detailWidth);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={selected ? "white" : toolColor(tool)}
      paddingX={1}
      width={width}
    >
      <Box flexDirection="column" width={Math.max(1, width - 4)}>
        {fragment.body.map((line, index) => (
          <Text
            key={index}
            color={index === 0 && fragment.continuation === "none"
              ? toolStatusColor(tool)
              : undefined}
          >
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function toolStatusColor(display: ToolActivityDisplay): string {
  return display.status === "success"
    ? "green"
    : display.status === "error"
    ? "red"
    : "yellow";
}

function toolColor(display: ToolActivityDisplay): string {
  return display.status === "error"
    ? "red"
    : display.status === "running"
    ? "yellow"
    : "magenta";
}

function messageColor(headline: string): string {
  return headline.endsWith("— reasoning")
    ? "green"
    : headline.endsWith("— error")
    ? "red"
    : "white";
}
