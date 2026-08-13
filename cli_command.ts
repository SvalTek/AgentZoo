/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Command } from "@cliffy/command";
import { dirname, resolve } from "@std/path";
import { exists } from "@std/fs";
import {
  cleanupManagedDockerProject,
  cleanupManagedDockerResources,
  dockerRuntimeIdForProject,
  DockerRuntimeManager,
  listManagedDockerImages,
  listManagedDockerRuns,
  loadConfig,
  type ManagedDockerImage,
  type ManagedDockerRun,
} from "@agent-zoo/core";

export interface DockerCliActions {
  listRuns(): Promise<ManagedDockerRun[]>;
  listImages(): Promise<ManagedDockerImage[]>;
  cleanup(
    runtimeId: string | undefined,
    pruneImages: boolean,
  ): Promise<{
    containers: readonly string[];
    volumes: readonly string[];
    imagesPruned: boolean;
  }>;
  cleanupProject(
    project: string,
    pruneImages: boolean,
  ): Promise<{
    containers: readonly string[];
    volumes: readonly string[];
    imagesPruned: boolean;
  }>;
}

const defaultDockerActions: DockerCliActions = {
  listRuns: listManagedDockerRuns,
  listImages: listManagedDockerImages,
  cleanup: cleanupManagedDockerResources,
  cleanupProject: cleanupManagedDockerProject,
};

export function createCli(
  run: (configPath: string, useUi: boolean, task?: string) => Promise<void>,
  dockerActions: DockerCliActions = defaultDockerActions,
) {
  const root = new Command()
    .name("agent-zoo")
    .version("0.0.1")
    .description("Run a configured population of persistent AI agents.")
    .option("-c, --config <path:string>", "AgentZoo YAML configuration path")
    .option("-t, --task <task:string>", "Run-wide objective")
    .option("--no-ui", "Use line-oriented output instead of the live dashboard")
    .action(async (options) => {
      const configPath = await resolveConfigPath(options.config);
      await run(configPath, options.ui !== false, options.task);
    });

  const docker = new Command()
    .description("Inspect or purge labelled AgentZoo Docker resources.");
  docker.command(
    "list",
    new Command()
      .description("List managed Docker runtimes, volumes, and images.")
      .action(async () => {
        const [runs, images] = await Promise.all([
          dockerActions.listRuns(),
          dockerActions.listImages(),
        ]);
        console.log(formatManagedDockerResources(runs, images));
      }),
  );
  docker.command(
    "purge",
    new Command()
      .description("Permanently remove selected managed Docker runtime state.")
      .option(
        "-c, --config <path:string>",
        "Purge every runtime owned by this config",
      )
      .option("--runtime <id:string>", "Purge one managed runtime id")
      .option("--all", "Purge every managed runtime")
      .option(
        "--prune-images",
        "Also remove unused managed runtime images",
      )
      .action(async (options) => {
        const selectors = [
          options.config !== undefined,
          options.runtime !== undefined,
          options.all === true,
        ].filter(Boolean).length;
        if (selectors !== 1) {
          throw new Error("Specify exactly one of --config, --runtime, or --all");
        }

        const pruneImages = options.pruneImages ?? false;
        const result = options.config
          ? await dockerActions.cleanupProject(
            resolve(options.config),
            pruneImages,
          )
          : await dockerActions.cleanup(
            options.all ? undefined : options.runtime,
            pruneImages,
          );
        console.log(
          `Purged ${result.containers.length} container(s) and ${result.volumes.length} volume(s).`,
        );
        if (result.imagesPruned) console.log("Pruned unused managed images.");
      }),
  );
  root.command("docker", docker);

  const agent = new Command()
    .description("Manage persistent per-agent chroot state.");
  agent.command(
    "purge",
    new Command()
      .description(
        "Permanently delete one agent chroot while keeping its config runtime.",
      )
      .arguments("<id:string>")
      .option("-c, --config <path:string>", "AgentZoo YAML configuration path")
      .action(async (options, id) => {
        const configPath = await resolveConfigPath(options.config);
        await purgeConfiguredAgent(configPath, id, dockerActions);
        console.log(`Purged persistent chroot for ${id}.`);
      }),
  );
  root.command("agent", agent);

  return root;
}

async function purgeConfiguredAgent(
  configPath: string,
  agentId: string,
  dockerActions: DockerCliActions,
): Promise<void> {
  const runtimeId = dockerRuntimeIdForProject(configPath);
  const runtimeState = (await dockerActions.listRuns()).find((run) =>
    run.runId === runtimeId
  );
  if (!runtimeState) {
    throw new Error(
      `No persistent runtime with id "${runtimeId}" exists for config "${configPath}"`,
    );
  }
  if (
    runtimeState.containers.some((container) => container.state === "running")
  ) {
    throw new Error(
      `Stop AgentZoo for config "${configPath}" before purging an agent chroot`,
    );
  }

  const config = await loadConfig(configPath);
  const workspaceRoot = resolve(
    dirname(configPath),
    config.runtime.sharedWorkspace,
  );
  const runtime = new DockerRuntimeManager(
    workspaceRoot,
    undefined,
    undefined,
    { project: configPath },
  );
  try {
    await runtime.purgeEnv(agentId);
  } finally {
    await runtime.stop();
  }
}

export function formatManagedDockerResources(
  runs: readonly ManagedDockerRun[],
  images: readonly ManagedDockerImage[],
): string {
  const lines: string[] = [];
  if (!runs.length) {
    lines.push("Managed runtimes: none");
  } else {
    lines.push(`Managed runtimes: ${runs.length}`);
    for (const run of runs) {
      lines.push(`  ${run.runId}`);
      if (run.createdAt) lines.push(`    created: ${run.createdAt}`);
      if (run.project) lines.push(`    config: ${run.project}`);
      for (const container of run.containers) {
        lines.push(
          `    container: ${container.name} (${container.state}, ${container.image})`,
        );
      }
      for (const volume of run.volumes) lines.push(`    volume: ${volume}`);
    }
  }
  lines.push(`Managed images: ${images.length}`);
  for (const image of images) {
    lines.push(`  ${image.tags.join(", ") || image.id}`);
  }
  return lines.join("\n");
}

export async function resolveConfigPath(requested?: string): Promise<string> {
  if (requested) return resolve(requested);
  const conventional = resolve("agent-zoo.yaml");
  if (await exists(conventional)) return conventional;
  return resolve("agent-zoo.example.yaml");
}
