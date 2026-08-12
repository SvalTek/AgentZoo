/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Command } from "@cliffy/command";
import { resolve } from "@std/path";
import { exists } from "@std/fs";
import {
  cleanupManagedDockerResources,
  listManagedDockerImages,
  listManagedDockerRuns,
  type ManagedDockerImage,
  type ManagedDockerRun,
} from "@agent-zoo/core";

export interface DockerCliActions {
  listRuns(): Promise<ManagedDockerRun[]>;
  listImages(): Promise<ManagedDockerImage[]>;
  cleanup(
    runId: string | undefined,
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
    .description("Inspect or clean up labelled AgentZoo Docker resources.");
  docker.command(
    "list",
    new Command()
      .description("List managed Docker runs, volumes, and images.")
      .action(async () => {
        const [runs, images] = await Promise.all([
          dockerActions.listRuns(),
          dockerActions.listImages(),
        ]);
        console.log(formatManagedDockerResources(runs, images));
      }),
  );
  docker.command(
    "cleanup",
    new Command()
      .description("Remove explicitly selected managed Docker resources.")
      .option("--run <id:string>", "Remove one managed run")
      .option("--all", "Remove every managed run")
      .option(
        "--prune-images",
        "Also remove unused managed runtime images",
      )
      .action(async (options) => {
        if (Boolean(options.run) === Boolean(options.all)) {
          throw new Error("Specify exactly one of --run or --all");
        }
        const result = await dockerActions.cleanup(
          options.all ? undefined : options.run,
          options.pruneImages ?? false,
        );
        console.log(
          `Removed ${result.containers.length} container(s) and ${result.volumes.length} volume(s).`,
        );
        if (result.imagesPruned) console.log("Pruned unused managed images.");
      }),
  );
  root.command("docker", docker);
  return root;
}

export function formatManagedDockerResources(
  runs: readonly ManagedDockerRun[],
  images: readonly ManagedDockerImage[],
): string {
  const lines: string[] = [];
  if (!runs.length) {
    lines.push("Managed runs: none");
  } else {
    lines.push(`Managed runs: ${runs.length}`);
    for (const run of runs) {
      lines.push(`  ${run.runId}`);
      if (run.createdAt) lines.push(`    created: ${run.createdAt}`);
      if (run.project) lines.push(`    project: ${run.project}`);
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
