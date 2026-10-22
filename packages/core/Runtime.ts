/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { fromFileUrl, resolve } from "@std/path";
import type {
  CommandOptions,
  CommandResult,
  RuntimeEnv,
  RuntimeFiles,
  RuntimeManager,
} from "./types.ts";
import { RuntimeHostFiles } from "./RuntimeHostFiles.ts";

export function assertAgentId(agentId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(agentId)) {
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
 * Current implementation of one privileged runtime host per AgentZoo config.
 * One Docker container owns many native OverlayFS + chroot agent roots. The
 * container may stop between CLI runs, while its labelled data volume keeps
 * each agent's private upperdir persistent by stable agent id.
 */
const RUNTIME_HOST_PORT = 8787;
const RUNTIME_HOST_TOKEN_PATH = "/var/lib/runtime/runtime-host.token";

export class DockerRuntimeManager implements RuntimeManager {
  readonly #envs = new Map<string, RuntimeEnv>();
  #runtimeHostToken: string | undefined;
  #runtimeHostPort: number | undefined;
  readonly #dataVolumeName: string;
  #prepared = false;
  readonly runId: string;
  readonly createdAt: string;
  readonly project: string;
  readonly workspace: string;
  readonly hostName: string;

  constructor(
    readonly sharedWorkspace: string,
    readonly image = "agent-runtime:dev",
    hostName?: string,
    metadata: DockerRuntimeMetadata = {},
  ) {
    this.project = metadata.project
      ? resolve(metadata.project)
      : resolve(sharedWorkspace);
    this.workspace = resolve(sharedWorkspace);
    this.runId = metadata.runId ?? dockerRuntimeIdForProject(this.project);
    this.createdAt = metadata.createdAt ?? new Date().toISOString();
    this.hostName = hostName ?? `agent-runtime-${this.runId}`;
    this.#dataVolumeName = `${this.hostName}-data`;
  }

  get dataVolumeName(): string {
    return this.#dataVolumeName;
  }

  async prepare(): Promise<void> {
    if (this.#prepared) return;

    await this.#ensureRuntimeImage();

    await this.#ensureDataVolume();
    const desiredImageId = await dockerImageId(this.image);
    let container = await tryInspectDockerContainer(this.hostName);

    if (container) {
      this.#assertOwnedResource(
        container.Config.Labels,
        "runtime",
        `container "${this.hostName}"`,
      );
      const labels = container.Config.Labels ?? {};
      const labelledWorkspace = labels[DOCKER_WORKSPACE_LABEL];
      const mustRecreate = container.Image !== desiredImageId ||
        labelledWorkspace === undefined ||
        dockerPathIdentity(labelledWorkspace) !==
          dockerPathIdentity(this.workspace);
      if (mustRecreate) {
        if (container.State.Running) {
          throw new Error(
            `Managed runtime "${this.hostName}" is already running with a ` +
              "different image or workspace; stop it before restarting " +
              "this config",
          );
        }
        await runDocker(["rm", this.hostName]);
        container = undefined;
      }
    }

    if (!container) {
      await this.#createHostContainer();
    } else if (!container.State.Running) {
      await runDocker(["start", this.hostName]);
    }

    await this.#waitForRuntimeHost();
    this.#prepared = true;
  }

  /** WebSocket endpoint of the resident runtime-host service, when present. */
  runtimeHostEndpoint(): { url: string; token: string } | undefined {
    if (!this.#runtimeHostToken || this.#runtimeHostPort === undefined) {
      return undefined;
    }
    return {
      url: `ws://127.0.0.1:${this.#runtimeHostPort}`,
      token: this.#runtimeHostToken,
    };
  }

  /**
   * The entrypoint creates the token and starts the service moments after the
   * container starts, so a single read races a fresh volume. Retry briefly;
   * the endpoint stays optional and tools fall back to exec.
   */
  async #waitForRuntimeHost(): Promise<void> {
    const deadline = Date.now() + 5_000;
    do {
      this.#runtimeHostToken = await this.#readRuntimeHostToken();
      this.#runtimeHostPort = await this.#resolveRuntimeHostPort();
      if (this.#runtimeHostToken && this.#runtimeHostPort !== undefined) {
        return;
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 100);
      await promise;
    } while (Date.now() < deadline);
  }

  async #readRuntimeHostToken(): Promise<string | undefined> {
    try {
      const result = await runDockerResult([
        "exec",
        this.hostName,
        "cat",
        RUNTIME_HOST_TOKEN_PATH,
      ]);
      const token = result.stdout.trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  }

  async #resolveRuntimeHostPort(): Promise<number | undefined> {
    try {
      const result = await runDockerResult([
        "port",
        this.hostName,
        `${RUNTIME_HOST_PORT}/tcp`,
      ]);
      const match = /:(\d+)\s*$/m.exec(result.stdout);
      return match ? Number(match[1]) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Ensure the runtime image exists locally, building from source when the
   * Containerfile is present or pulling the published image otherwise. */
  async #ensureRuntimeImage(): Promise<void> {
    const containerfile = fromFileUrl(
      new URL("./runtime/Containerfile", import.meta.url),
    );
    await ensureRuntimeImage(this.image, containerfile, {
      tryDockerImageId,
      pathExists,
      buildRuntimeImage,
      runDocker,
    });
  }

  async #ensureDataVolume(): Promise<void> {
    const existing = await tryInspectDockerVolume(this.#dataVolumeName);
    if (existing) {
      this.#assertOwnedResource(
        existing.Labels,
        "data",
        `volume "${this.#dataVolumeName}"`,
      );
      return;
    }
    await runDocker([
      "volume",
      "create",
      ...this.#resourceLabelArgs("data"),
      this.#dataVolumeName,
    ]);
  }

  async #createHostContainer(): Promise<void> {
    await runDocker([
      "run",
      "--detach",
      "--privileged",
      "--name",
      this.hostName,
      ...this.#resourceLabelArgs("runtime"),
      "--volume",
      `${this.workspace}:/shared`,
      "--mount",
      `source=${this.#dataVolumeName},target=/var/lib/runtime`,
      "--publish",
      `127.0.0.1::${RUNTIME_HOST_PORT}`,
      this.image,
    ]);
  }

  #assertOwnedResource(
    labels: Record<string, string> | undefined,
    resource: "runtime" | "data",
    description: string,
  ): void {
    const runtimeId = labels?.[DOCKER_RUNTIME_LABEL] ??
      labels?.[DOCKER_RUN_LABEL];
    if (
      labels?.[DOCKER_MANAGED_LABEL] !== "true" ||
      labels?.[DOCKER_RESOURCE_LABEL] !== resource ||
      labels?.[DOCKER_PROJECT_LABEL] === undefined ||
      dockerPathIdentity(labels[DOCKER_PROJECT_LABEL]) !==
        dockerPathIdentity(this.project) ||
      runtimeId !== this.runId
    ) {
      throw new Error(
        `Refusing to reuse ${description}: it is not owned by this config`,
      );
    }
  }

  #resourceLabelArgs(resource: "runtime" | "data"): string[] {
    return [
      "--label",
      `${DOCKER_MANAGED_LABEL}=true`,
      "--label",
      `${DOCKER_RESOURCE_LABEL}=${resource}`,
      "--label",
      `${DOCKER_RUNTIME_LABEL}=${this.runId}`,
      // Legacy label retained so older cleanup/list tooling can still group it.
      "--label",
      `${DOCKER_RUN_LABEL}=${this.runId}`,
      "--label",
      `${DOCKER_CREATED_LABEL}=${this.createdAt}`,
      "--label",
      `${DOCKER_PROJECT_LABEL}=${this.project}`,
      "--label",
      `${DOCKER_WORKSPACE_LABEL}=${this.workspace}`,
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
    const endpoint = this.runtimeHostEndpoint();
    const environment = new DockerChrootEnvironment(
      this.hostName,
      agentId,
      endpoint ? () => this.runtimeHostEndpoint() : undefined,
    );
    this.#envs.set(agentId, environment);
    return environment;
  }

  getEnv(agentId: string): RuntimeEnv | undefined {
    return this.#envs.get(agentId);
  }

  /** Stop one active chroot without deleting its persistent upperdir. */
  async destroyEnv(agentId: string): Promise<void> {
    const environment = this.#envs.get(agentId);
    if (environment) await environment.destroy();
    this.#envs.delete(agentId);
  }

  /** Explicitly delete one agent's persisted chroot state. */
  async purgeEnv(agentId: string): Promise<void> {
    assertAgentId(agentId);
    await this.prepare();
    const current = this.#envs.get(agentId);
    if (current) await current.destroy();
    try {
      await runDocker([
        "exec",
        this.hostName,
        "runtime-host",
        "purge-agent",
        agentId,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/agent environment does not exist/.test(message)) {
        throw new Error(`no chroot exists for "${agentId}" in this config`);
      }
      throw error;
    }
    this.#envs.delete(agentId);
  }

  /** Stop the config's runtime host while preserving its container and volume. */
  async stop(): Promise<void> {
    if (!this.#prepared) {
      this.#envs.clear();
      return;
    }
    const container = await tryInspectDockerContainer(this.hostName);
    if (container) {
      this.#assertOwnedResource(
        container.Config.Labels,
        "runtime",
        `container "${this.hostName}"`,
      );
    }
    // Release each active environment while the container is still running so
    // that retained references fail through the controlled "not running" path
    // instead of surfacing a raw Docker error.
    for (const environment of this.#envs.values()) {
      await environment.destroy();
    }
    if (container?.State.Running) await runDocker(["stop", this.hostName]);
    this.#envs.clear();
    this.#prepared = false;
  }

  /**
   * @deprecated Lifecycle semantics changed in the persistence release: this
   * method now only stops the runtime host and preserves the container and data
   * volume. It is retained as a backward-compatible alias for {@link stop}.
   * Call {@link stop} to halt while keeping persistent state, or {@link purge}
   * to remove the container and data volume entirely.
   */
  destroy(): Promise<void> {
    return this.stop();
  }

  /** Explicitly remove this config's host container and persistent data volume. */
  async purge(): Promise<void> {
    const container = await tryInspectDockerContainer(this.hostName);
    if (container) {
      this.#assertOwnedResource(
        container.Config.Labels,
        "runtime",
        `container "${this.hostName}"`,
      );
      await runDocker(["rm", "--force", this.hostName]);
    }
    const volume = await tryInspectDockerVolume(this.#dataVolumeName);
    if (volume) {
      this.#assertOwnedResource(
        volume.Labels,
        "data",
        `volume "${this.#dataVolumeName}"`,
      );
      await runDocker(["volume", "rm", this.#dataVolumeName]);
    }
    this.#envs.clear();
    this.#prepared = false;
  }
}

function dockerPathIdentity(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return Deno.build.os === "windows" ? normalized.toLowerCase() : normalized;
}

/** Stable Docker-safe identifier derived from the config/project path. */
export function dockerRuntimeIdForProject(project: string): string {
  const canonical = dockerPathIdentity(project);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export interface DockerRuntimeMetadata {
  /** Stable runtime identifier. Defaults to a hash of the config/project path. */
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
const DOCKER_RUNTIME_LABEL = "agent-zoo.runtime";
const DOCKER_RUN_LABEL = "agent-zoo.run";
const DOCKER_CREATED_LABEL = "agent-zoo.created";
const DOCKER_PROJECT_LABEL = "agent-zoo.project";
const DOCKER_WORKSPACE_LABEL = "agent-zoo.workspace";

/** Build the managed runtime image tagged for AgentZoo, carrying the same
 * ownership labels that the CLI uses to recognise its resources. */
async function compileRuntimeHost(): Promise<void> {
  const source = fromFileUrl(
    new URL("../runtime-host/main.ts", import.meta.url),
  );
  const output = fromFileUrl(
    new URL("./runtime/agentzoo-runtime-host", import.meta.url),
  );
  // The target runtime archive is unpacked through the system temp directory.
  // Keep that under the repository's tmp/ directory so a constrained system
  // drive does not break the build with a misleading "not enough space" error.
  const tempDir = fromFileUrl(
    new URL("../../tmp/deno-compile", import.meta.url),
  );
  await Deno.mkdir(tempDir, { recursive: true });
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "-A",
      "--bundle",
      "--minify",
      "--target",
      "x86_64-unknown-linux-gnu",
      "--output",
      output,
      source,
    ],
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      TEMP: tempDir,
      TMP: tempDir,
      TMPDIR: tempDir,
    },
  }).output();
  if (!result.success) {
    throw new Error(
      `runtime host binary could not be compiled: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
}

export async function buildRuntimeImage(
  image = "agent-runtime:dev",
): Promise<void> {
  await compileRuntimeHost();
  await runDocker([
    "build",
    "--file",
    fromFileUrl(new URL("./runtime/Containerfile", import.meta.url)),
    "--tag",
    image,
    "--label",
    `${DOCKER_MANAGED_LABEL}=true`,
    "--label",
    `${DOCKER_RESOURCE_LABEL}=image`,
    fromFileUrl(new URL("./runtime/", import.meta.url)),
  ]);
}

export interface RuntimeImageDeps {
  tryDockerImageId(image: string): Promise<string | undefined>;
  pathExists(path: string): Promise<boolean>;
  buildRuntimeImage(image: string): Promise<void>;
  runDocker(args: string[]): Promise<void>;
}

/**
 * Ensure the runtime image exists locally, building from source when the
 * Containerfile is present or pulling the published image otherwise.
 * Extracted for unit testing; {@link DockerRuntimeManager.#ensureRuntimeImage}
 * delegates here with the real module-level functions.
 */
export async function ensureRuntimeImage(
  image: string,
  containerfilePath: string,
  deps: RuntimeImageDeps,
): Promise<void> {
  if (await deps.tryDockerImageId(image)) return;
  if (await deps.pathExists(containerfilePath)) {
    await deps.buildRuntimeImage(image);
    return;
  }
  try {
    await deps.runDocker(["pull", image]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Runtime image "${image}" is not available locally, its ` +
        "Containerfile is not present in this installation, and pulling " +
        `it failed: ${detail}\n` +
        "Build it once from a source checkout with `deno task docker:build`.",
    );
  }
}

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
    const runId = labels?.[DOCKER_RUNTIME_LABEL] ?? labels?.[DOCKER_RUN_LABEL];
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

/** Remove one labelled runtime, or every labelled runtime when no id is supplied. */
export async function cleanupManagedDockerResources(
  runId?: string,
  pruneImages = false,
): Promise<DockerCleanupResult> {
  const runs = await listManagedDockerRuns();
  const selected = runId === undefined
    ? runs
    : runs.filter((run) => run.runId === runId);
  if (runId !== undefined && selected.length === 0) {
    throw new Error(`No managed Docker runtime found with id "${runId}"`);
  }
  return await cleanupSelectedDockerRuns(selected, pruneImages);
}

/** Remove every labelled runtime resource belonging to one config path. */
export async function cleanupManagedDockerProject(
  project: string,
  pruneImages = false,
): Promise<DockerCleanupResult> {
  const target = resolve(project);
  const runs = (await listManagedDockerRuns()).filter((run) =>
    run.project !== undefined &&
    dockerPathIdentity(run.project) === dockerPathIdentity(target)
  );
  if (!runs.length) {
    throw new Error(`No managed Docker runtime found for config "${target}"`);
  }
  return await cleanupSelectedDockerRuns(runs, pruneImages);
}

async function cleanupSelectedDockerRuns(
  selected: readonly ManagedDockerRun[],
  pruneImages: boolean,
): Promise<DockerCleanupResult> {
  const containers = [
    ...new Set(
      selected.flatMap((run) =>
        run.containers.map((container) => container.name)
      ),
    ),
  ];
  const volumes = [...new Set(selected.flatMap((run) => [...run.volumes]))];
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
  Image: string;
  Config: { Image: string; Labels?: Record<string, string> };
  State: { Status: string; Running: boolean };
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

async function dockerImageId(image: string): Promise<string> {
  const result = await runDockerResult([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  return result.stdout.trim();
}

async function tryDockerImageId(
  image: string,
): Promise<string | undefined> {
  const result = await runDockerRaw([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  if (!result.success) {
    if (/no such image/i.test(result.stderr)) return undefined;
    throw new Error(`Docker command failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function tryInspectDockerContainer(
  name: string,
): Promise<DockerContainerInspect | undefined> {
  const result = await runDockerRaw(["inspect", name]);
  if (!result.success) {
    if (/no such (object|container)/i.test(result.stderr)) return undefined;
    throw new Error(`Docker command failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as DockerContainerInspect[])[0];
}

async function tryInspectDockerVolume(
  name: string,
): Promise<DockerVolumeInspect | undefined> {
  const result = await runDockerRaw(["volume", "inspect", name]);
  if (!result.success) {
    if (/no such volume/i.test(result.stderr)) return undefined;
    throw new Error(`Docker command failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as DockerVolumeInspect[])[0];
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

async function runDockerRaw(
  args: string[],
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const result = await new Deno.Command("docker.exe", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: result.success,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function runDockerResult(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await runDockerRaw(args);
  if (!result.success) {
    throw new Error(`Docker command failed: ${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

class DockerChrootEnvironment implements RuntimeEnv {
  #prepared = true;
  readonly hostName: string;
  readonly agentId: string;
  readonly files?: RuntimeFiles;

  constructor(
    hostName: string,
    agentId: string,
    endpoint?: () => { url: string; token: string } | undefined,
  ) {
    this.hostName = hostName;
    this.agentId = agentId;
    if (endpoint) this.files = new RuntimeHostFiles(agentId, endpoint);
  }

  async prepare(): Promise<void> {
    if (this.#prepared) return;
    await runDocker([
      "exec",
      this.hostName,
      "runtime-host",
      "create-agent",
      this.agentId,
    ]);
    this.#prepared = true;
  }

  async exec(
    command: string | string[],
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    if (!this.#prepared) {
      throw new Error(`Agent environment "${this.agentId}" is not running`);
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

  /** Stop processes and mounts but keep the persistent OverlayFS upperdir. */
  async destroy(): Promise<void> {
    if (this.#prepared) {
      try {
        await runDocker([
          "exec",
          this.hostName,
          "runtime-host",
          "stop-agent",
          this.agentId,
        ]);
      } catch (error) {
        // The host container may already be stopped or removed (for example
        // during an interrupted startup or after a previous stop). There is
        // nothing to stop then, but the environment must still be released so
        // later exec() calls fail through the controlled "not running" path
        // instead of surfacing a raw Docker error.
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/(not running|no such container|stopped state|does not exist)/i
            .test(message)
        ) {
          throw error;
        }
      }
    }
    this.#prepared = false;
    this.files?.close?.();
  }

  /** Reset means explicitly discard the private chroot and recreate it. */
  async reset(): Promise<void> {
    await runDocker([
      "exec",
      this.hostName,
      "runtime-host",
      "purge-agent",
      this.agentId,
    ]);
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
