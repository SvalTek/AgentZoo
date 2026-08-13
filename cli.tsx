/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { dirname } from "@std/path";
import { render } from "@deno-ink/core";
import { type AgentZoo, buildAgentZoo, loadConfig } from "@agent-zoo/core";
import { StartupScreen } from "./packages/cli/components/StartupScreen.tsx";
import { ZooDashboard } from "./packages/cli/components/ZooDashboard.tsx";
import { formatActivity } from "./packages/cli/activity_format.ts";
import { ActivityLog } from "./packages/cli/ActivityLog.ts";
import { createCli } from "./cli_command.ts";

export async function runCli(args: string[]): Promise<void> {
  await createCli(runStandalone).parse(args);
}

export async function runStandalone(
  configPath: string,
  useUi = true,
  task?: string,
): Promise<void> {
  const interactive = useUi && Deno.stdout.isTerminal() &&
    Deno.stdin.isTerminal();
  let startup: Awaited<ReturnType<typeof render>> | undefined;
  let zoo: AgentZoo | undefined;
  let activityLog: ActivityLog | undefined;
  let signalHandled = false;
  const stop = () => {
    if (signalHandled) return;
    signalHandled = true;
    void zoo?.stop("SIGINT");
  };
  try {
    startup = interactive
      ? await render(
        <StartupScreen configPath={configPath} />,
        { fullScreen: true },
      )
      : undefined;
    Deno.addSignalListener("SIGINT", stop);
    const config = await loadConfig(configPath);
    const built = await buildAgentZoo(config, {
      baseDir: dirname(configPath),
      taskPrompt: task,
      runtimeProject: configPath,
    });
    zoo = built.zoo;
    activityLog = await ActivityLog.create(zoo, built.models, configPath);
    if (interactive && startup) {
      startup.rerender(
        <ZooDashboard
          zoo={zoo}
          configPath={configPath}
          logPath={activityLog.path}
          objective={task ?? config.taskPrompt}
        />,
      );
    } else {
      attachLineReporter(zoo, configPath, activityLog.path);
    }
    await zoo.run();
  } finally {
    try {
      Deno.removeSignalListener("SIGINT", stop);
    } catch {
      // The listener is registered after the first successful render.
    }
    try {
      await zoo?.stop("CLI shutdown");
    } finally {
      try {
        await activityLog?.close();
      } finally {
        startup?.unmount();
      }
    }
  }
}

function attachLineReporter(
  zoo: AgentZoo,
  configPath: string,
  logPath: string,
): void {
  console.log(`AgentZoo config: ${configPath}`);
  console.log(`Full activity log: ${logPath}`);
  zoo.addEventListener("activity", (event) => {
    const activity = (event as CustomEvent).detail;
    const display = formatActivity(activity, 120);
    console.log(
      `[${
        new Date(activity.at).toISOString()
      }] ${activity.kind} ${display.headline}`,
    );
    for (const line of display.details) console.log(`  ${line}`);
  });
}
