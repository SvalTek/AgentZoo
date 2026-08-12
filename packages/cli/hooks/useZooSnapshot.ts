/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { useEffect, useState } from "react";
import type { AgentZoo, ZooSnapshot } from "@agent-zoo/core";

export function useZooSnapshot(zoo: AgentZoo) {
  const [snapshot, setSnapshot] = useState<ZooSnapshot>(() => zoo.state());
  const [runStartedAt, setRunStartedAt] = useState<number>();

  useEffect(() => {
    const refresh = () => {
      const next = zoo.state();
      setSnapshot(next);
      if (next.state === "running") {
        setRunStartedAt((current) => current ?? next.stateSince);
      }
    };
    refresh();
    zoo.addEventListener("statechange", refresh);
    zoo.addEventListener("activity", refresh);
    const timer = setInterval(refresh, 500);
    return () => {
      clearInterval(timer);
      zoo.removeEventListener("statechange", refresh);
      zoo.removeEventListener("activity", refresh);
    };
  }, [zoo]);

  return { snapshot, runStartedAt };
}
