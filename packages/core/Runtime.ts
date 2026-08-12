/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { fromFileUrl, resolve } from "@std/path";
import type {
  CommandOptions,
  CommandResult,
  RuntimeEnv,
  RuntimeManager,
} from "./types.ts";

export function assertAgentId(agentId: string): void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(agentId)) {
    throw new TypeError(
      "Agent id must use lowercase letters, digits, and hyphens",
    );
  }
}

/** Safe adapter around a runtime-specific structured command launcher. */
export class WslRuntimeManager implements RuntimeManager {
  readonly #envs = new Map<string, RuntimeEnv>();

  constructor(readonly distribution: string) {
    if (!distribution) throw new TypeError("WSL distribution is required");
  }

  async prepare(): Promise<void> {
    const command = new Deno.Command("wsl.exe", {
      args: ["--distribution", this.distribution, "--exec", "true"],
    });
    const result = await command.output();
    if (!result.success) {
      throw new Error(`WSL backend "${this.distribution}" is unavailable`);
    }
  }

  createEnv(agentId: string): Promise<RuntimeEnv> {
    assertAgentId(agentId);
    const existing = this.#envs.get(agentId);
    if (existing) return Promise.resolve(existing);
    // Environment construction/mount policy is intentionally supplied by the
    // configured WSL deployment. This class never falls back to host execution.
    const env = new WslEnvironment(this.distribution, agentId);
    this.#envs.set(agentId, env);
    return Promise.resolve(env);
  }

  getEnv(agentId: string): RuntimeEnv | undefined {
    return this.#envs.get(agentId);
  }
  async destroyEnv(agentId: string): Promise<void> {
    const env = this.#envs.get(agentId);
    if (env) await env.destroy();
    this.#envs.delete(agentId);
  }
}

/**
 * Current implementation of the single privileged AgentZoo runtime host.
 * One container owns many native OverlayFS + chroot agent roots. The public
 * RuntimeManager contract deliberately does not reveal Docker, so a future
 * WSLC backend can provide the identical semantics without changing agents.
 */
export class DockerRuntimeManager implements RuntimeManager {
  readonly #envs = new Map<string, RuntimeEnv>();
  readonly #dataVolumeName: string;
  #prepared = false;
  readonly runId: string;
  readonly createdAt: string;
  readonly project: string;

  constructor(
    readonly sharedWorkspace: string,
    readonly image = "agent-runtime:dev",
    readonly hostName = `agent-runtime-${crypto.randomUUID()}`,
    metadata: DockerRuntimeMetadata = {},
  ) {
    this.#dataVolumeName = `${hostName}-data`;
    this.runId = metadata.runId ?? crypto.randomUUID();
    this.createdAt = metadata.createdAt ?? new Date().toISOString();
    this.project = metadata.project ?? resolve(sharedWorkspace);
  }

  async prepare(): Promise<void> {
    if (this.#prepared) return;
    await runDocker([
      "build",
      "--file",
      fromFileUrl(new URL("./runtime/Containerfile", import.meta.url)),
      "--tag",
      this.image,
      "--label",
      `${DOCKER_MANAGED_LABEL}=true`,
      "--label",
      `${DOCKER_RESOURCE_LABEL}=image`,
      fromFileUrl(new URL("./runtime/", import.meta.url)),
    ]);
    await runDocker([
      "volume",
      "create",
      ...this.#resourceLabelArgs("data"),
      this.#dataVolumeName,
    ]);
    await runDocker([
      "run",
      "--detach",
      "--rm",
      "--privileged",
      "--name",
      this.hostName,
      ...this.#resourceLabelArgs("runtime"),
      "--volume",
      `${resolve(this.sharedWorkspace)}:/shared`,
      "--mount",
      `source=${this.#dataVolumeName},target=/var/lib/runtime`,
      this.image,
    ]);
    this.#prepared = true;
  }

  #resourceLabelArgs(resource: "runtime" | "data"): string[] {
    return [
      "--label",
      `${DOCKER_MANAGED_LABEL}=true`,
      "--label",
      `${DOCKER_RESOURCE_LABEL}=${resource}`,
      "--label",
      `${DOCKER_RUN_LABEL}=${this.runId}`,
      "--label",
      `${DOCKER_CREATED_LABEL}=${this.createdAt}`,
      "--label",
      `${DOCKER_PROJECT_LABEL}=${this.project}`,
    ];
  }

  async createEnv(agentId: string): Promise<RuntimeEnv> {
    assertAgentId(agentId);
    const current = this.#envs.get(agentId);
    if (current) return current;
    await this.prepare();
    await runDocker([
      "exec",
      this.hostName,
      "runtime-host",
      "create-agent",
      agentId,
    ]);
    const environment = new DockerChrootEnvironment(this.hostName, agentId);
    this.#envs.set(agentId, environment);
    return environment;
  }

  getEnv(agentId: string): RuntimeEnv | undefined {
    return this.#envs.get(agentId);
  }
  async destroyEnv(agentId: string): Promise<void> {
    const environment = this.#envs.get(agentId);
    if (environment) await environment.destroy();
    this.#envs.delete(agentId);
  }
  async destroy(): Promise<void> {
    for (const id of [...this.#envs.keys()]) await this.destroyEnv(id);
    if (this.#prepared) {
      await runDocker(["rm", "--force", this.hostName]);
      await runDocker(["volume", "rm", this.#dataVolumeName]);
    }
    this.#prepared = false;
  }
}

export interface DockerRuntimeMetadata {
  /** Stable identifier used to group every Docker resource owned by one run. */
  runId?: string;
  /** Creation time recorded in Docker resource labels. */
  createdAt?: string;
  /** Host-facing project identifier, such as a resolved config path. */
  project?: string;
}

export interface ManagedDockerRun {
  readonly runId: string;
  readonly createdAt?: string;
  readonly project?: string;
  readonly containers: readonly ManagedDockerContainer[];
  readonly volumes: readonly string[];
}

export interface ManagedDockerContainer {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly image: string;
}

export interface ManagedDockerImage {
  readonly id: string;
  readonly tags: readonly string[];
  readonly createdAt?: string;
}

export interface DockerCleanupResult {
  readonly containers: readonly string[];
  readonly volumes: readonly string[];
  readonly imagesPruned: boolean;
}

const DOCKER_MANAGED_LABEL = "agent-zoo.managed";
const DOCKER_RESOURCE_LABEL = "agent-zoo.resource";
const DOCKER_RUN_LABEL = "agent-zoo.run";
const DOCKER_CREATED_LABEL = "agent-zoo.created";
const DOCKER_PROJECT_LABEL = "agent-zoo.project";

/** Inspect only Docker resources carrying AgentZoo's explicit ownership label. */
export async function listManagedDockerRuns(): Promise<ManagedDockerRun[]> {
  const containerIds = await dockerLines([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--filter",
    `label=${DOCKER_RESOURCE_LABEL}=runtime`,
  ]);
  const volumeNames = await dockerLines([
    "volume",
    "ls",
    "--quiet",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--filter",
    `label=${DOCKER_RESOURCE_LABEL}=data`,
  ]);
  const containers = containerIds.length
    ? await dockerInspect<DockerContainerInspect>(containerIds)
    : [];
  const volumes = volumeNames.length
    ? await dockerInspect<DockerVolumeInspect>(volumeNames, "volume")
    : [];
  const runs = new Map<string, {
    createdAt?: string;
    project?: string;
    containers: ManagedDockerContainer[];
    volumes: string[];
  }>();
  const getRun = (labels: Record<string, string> | undefined) => {
    const runId = labels?.[DOCKER_RUN_LABEL];
    if (!runId) return undefined;
    let run = runs.get(runId);
    if (!run) {
      run = {
        createdAt: labels?.[DOCKER_CREATED_LABEL],
        project: labels?.[DOCKER_PROJECT_LABEL],
        containers: [],
        volumes: [],
      };
      runs.set(runId, run);
    }
    return run;
  };
  for (const container of containers) {
    getRun(container.Config.Labels)?.containers.push({
      id: container.Id,
      name: container.Name.replace(/^\//, ""),
      state: container.State.Status,
      image: container.Config.Image,
    });
  }
  for (const volume of volumes) {
    getRun(volume.Labels)?.volumes.push(volume.Name);
  }
  return [...runs.entries()].map(([runId, run]) => ({ runId, ...run }))
    .sort((left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
    );
}

/** List runtime images explicitly labelled as managed build artifacts. */
export async function listManagedDockerImages(): Promise<ManagedDockerImage[]> {
  const ids = await dockerLines([
    "image",
    "ls",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--filter",
    `label=${DOCKER_RESOURCE_LABEL}=image`,
  ]);
  if (!ids.length) return [];
  const images = await dockerInspect<DockerImageInspect>([...new Set(ids)]);
  return images.map((image) => ({
    id: image.Id,
    tags: image.RepoTags ?? [],
    createdAt: image.Created,
  }));
}

/** Remove one labelled run, or every labelled run when no run ID is supplied. */
export async function cleanupManagedDockerResources(
  runId?: string,
  pruneImages = false,
): Promise<DockerCleanupResult> {
  const runs = await listManagedDockerRuns();
  const selected = runId === undefined
    ? runs
    : runs.filter((run) => run.runId === runId);
  if (runId !== undefined && selected.length === 0) {
    throw new Error(`No managed Docker run found with id "${runId}"`);
  }
  const containers = selected.flatMap((run) =>
    run.containers.map((container) => container.name)
  );
  const volumes = selected.flatMap((run) => [...run.volumes]);
  if (containers.length) await runDocker(["rm", "--force", ...containers]);
  if (volumes.length) await runDocker(["volume", "rm", ...volumes]);
  if (pruneImages) {
    await runDocker([
      "image",
      "prune",
      "--all",
      "--force",
      "--filter",
      `label=${DOCKER_MANAGED_LABEL}=true`,
      "--filter",
      `label=${DOCKER_RESOURCE_LABEL}=image`,
    ]);
  }
  return { containers, volumes, imagesPruned: pruneImages };
}

interface DockerContainerInspect {
  Id: string;
  Name: string;
  Config: { Image: string; Labels?: Record<string, string> };
  State: { Status: string };
}

interface DockerVolumeInspect {
  Name: string;
  Labels?: Record<string, string>;
}

interface DockerImageInspect {
  Id: string;
  RepoTags?: string[];
  Created?: string;
}

async function dockerLines(args: string[]): Promise<string[]> {
  const result = await runDockerResult(args);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(
    Boolean,
  );
}

async function dockerInspect<T>(
  identifiers: string[],
  kind?: "volume",
): Promise<T[]> {
  const args = kind === "volume"
    ? ["volume", "inspect", ...identifiers]
    : ["inspect", ...identifiers];
  return JSON.parse((await runDockerResult(args)).stdout) as T[];
}

async function runDockerResult(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await new Deno.Command("docker.exe", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (!result.success) throw new Error(`Docker command failed: ${stderr}`);
  return { stdout, stderr };
}

class DockerChrootEnvironment implements RuntimeEnv {
  #prepared = true;
  constructor(readonly hostName: string, readonly agentId: string) {}
  prepare(): Promise<void> {
    this.#prepared = true;
    return Promise.resolve();
  }
  async exec(
    command: string | string[],
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    if (!this.#prepared) {
      throw new Error(`Agent environment "${this.agentId}" has been destroyed`);
    }
    const commandArgs = Array.isArray(command)
      ? command
      : ["/bin/sh", "-lc", command];
    const cwd = normalizeRuntimePath(options.cwd);
    const commandId = crypto.randomUUID();
    const args = ["exec"];
    if (options.stdin !== undefined) args.push("--interactive");
    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }
    args.push(
      this.hostName,
      "runtime-host",
      "chroot-exec",
      this.agentId,
      "--command-id",
      commandId,
      "--cwd",
      cwd,
      "--",
      ...commandArgs,
    );
    return await runDockerWithResult(args, options, {
      hostName: this.hostName,
      agentId: this.agentId,
      commandId,
    });
  }
  async destroy(): Promise<void> {
    if (this.#prepared) {
      await runDocker([
        "exec",
        this.hostName,
        "runtime-host",
        "destroy-agent",
        this.agentId,
      ]);
    }
    this.#prepared = false;
  }
  async reset(): Promise<void> {
    await this.destroy();
    await runDocker([
      "exec",
      this.hostName,
      "runtime-host",
      "create-agent",
      this.agentId,
    ]);
    this.#prepared = true;
  }
}

async function runDocker(args: string[]): Promise<void> {
  const result = await new Deno.Command("docker.exe", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `Docker runtime command failed: ${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  }
}

async function runDockerWithResult(
  args: string[],
  options: CommandOptions,
  execution: {
    hostName: string;
    agentId: string;
    commandId: string;
  },
): Promise<CommandResult> {
  const child = new Deno.Command("docker.exe", {
    args,
    stdin: options.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (options.stdin !== undefined) {
    const bytes = typeof options.stdin === "string"
      ? new TextEncoder().encode(options.stdin)
      : options.stdin;
    const writer = child.stdin.getWriter();
    await writer.write(bytes);
    await writer.close();
  }
  type Interruption = "timeout" | "abort";
  let interrupt: (reason: Interruption) => void = () => {};
  const interrupted = new Promise<Interruption>((resolve) => {
    interrupt = resolve;
  });
  const timer = options.timeoutMs
    ? setTimeout(() => interrupt("timeout"), options.timeoutMs)
    : undefined;
  const abort = () => interrupt("abort");
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const output = child.output();
    const outcome = await Promise.race([
      output.then((result) => ({ kind: "output" as const, result })),
      interrupted.then((reason) => ({ kind: "interrupt" as const, reason })),
    ]);
    if (outcome.kind === "output") {
      return {
        exitCode: outcome.result.code,
        stdout: new TextDecoder().decode(outcome.result.stdout),
        stderr: new TextDecoder().decode(outcome.result.stderr),
        timedOut: false,
        aborted: false,
      };
    }

    await cancelDockerExecution(execution);
    const result = await output;
    return {
      exitCode: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      timedOut: outcome.reason === "timeout",
      aborted: outcome.reason === "abort",
    };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function cancelDockerExecution(execution: {
  hostName: string;
  agentId: string;
  commandId: string;
}): Promise<void> {
  const result = await new Deno.Command("docker.exe", {
    args: [
      "exec",
      execution.hostName,
      "runtime-host",
      "cancel-command",
      execution.agentId,
      execution.commandId,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `Docker runtime could not stop a timed-out command: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
}

function normalizeRuntimePath(path: string | undefined): string {
  const normalized = (path ?? "/").replaceAll("\\", "/");
  if (!normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new TypeError("Runtime working directory escapes its environment");
  }
  return normalized;
}

/** WSL execution boundary. A deployed bootstrap must provide /runtime/env/{id}. */
export class WslEnvironment implements RuntimeEnv {
  readonly #root: string;
  constructor(readonly distribution: string, readonly agentId: string) {
    assertAgentId(agentId);
    this.#root = `/runtime/env/${agentId}`;
  }
  async prepare(): Promise<void> {
    /* created by the administrator-managed bootstrap */
  }
  async exec(
    command: string | string[],
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const args = Array.isArray(command) ? command : ["/bin/sh", "-lc", command];
    const cwd = normalizeRuntimePath(options.cwd);
    const process = new Deno.Command("wsl.exe", {
      args: [
        "--distribution",
        this.distribution,
        "--exec",
        "chroot",
        this.#root,
        "/usr/bin/env",
        "-C",
        cwd,
        ...args,
      ],
      stdout: "piped",
      stderr: "piped",
      env: options.env,
      stdin: options.stdin === undefined ? "null" : "piped",
    });
    const child = process.spawn();
    if (options.stdin !== undefined) {
      const bytes = typeof options.stdin === "string"
        ? new TextEncoder().encode(options.stdin)
        : options.stdin;
      const writer = child.stdin.getWriter();
      await writer.write(bytes);
      await writer.close();
    }
    const timeout = options.timeoutMs
      ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs)
      : undefined;
    const abort = () => {
      try {
        child.kill("SIGTERM");
      } catch { /* already ended */ }
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await child.output();
      return {
        exitCode: result.code,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
        timedOut: false,
        aborted: options.signal?.aborted ?? false,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  async destroy(): Promise<void> {
    /* bootstrap-owned root; no broad deletion here */
  }
  async reset(): Promise<void> {
    await this.destroy();
    await this.prepare();
  }
}
