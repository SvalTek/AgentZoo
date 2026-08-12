/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Text } from "@deno-ink/core";
import type { ZooAgentSnapshot } from "@agent-zoo/core";

export function AgentPanel(
  { agents }: { agents: readonly ZooAgentSnapshot[] },
) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Agents</Text>
      {agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
    </Box>
  );
}

function AgentRow({ agent }: { agent: ZooAgentSnapshot }) {
  const elapsed = agent.state === "active"
    ? agent.activeForMs
    : agent.idleForMs;
  return (
    <Box
      borderStyle="single"
      borderColor={stateColor(agent.state)}
      paddingX={1}
    >
      <Box width={22}>
        <Text color={stateColor(agent.state)} bold wrap="truncate">
          {agent.name === agent.id ? agent.id : `${agent.name} (${agent.id})`}
        </Text>
      </Box>
      <Box width={13}>
        <Text>{agent.state}</Text>
      </Box>
      <Box width={18}>
        <Text dimColor>{agent.type ?? "agent"} · {agent.model}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="truncate">{agent.currentActivity}</Text>
      </Box>
      <Text dimColor>{formatElapsed(elapsed)}</Text>
    </Box>
  );
}

function stateColor(state: ZooAgentSnapshot["state"]): string {
  if (state === "active") return "green";
  if (state === "errored") return "red";
  if (state === "completed") return "cyan";
  if (state === "idle") return "yellow";
  return "gray";
}

function formatElapsed(ms: number): string {
  if (ms < 1_000) return `${Math.floor(ms)}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}
