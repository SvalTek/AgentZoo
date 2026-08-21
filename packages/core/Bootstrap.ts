/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { resolve } from "@std/path";
import Context from "@agent-zoo/context";
import type { ToolDefinition } from "@vibesjs/sdk";
import type { Service } from "@agent-zoo/service";
import {
  type AgentRunDeps,
  type LanguageModelFactory,
  ZooAgent,
} from "./Agent.ts";
import { AgentZoo, type AgentZooOptions, type RouterService } from "./Zoo.ts";
import { TemplateRegistry, type ZooConfig } from "./Config.ts";
import { ModelRegistry } from "./ModelRegistry.ts";
import { createLanguageModel } from "./Providers.ts";
import { DockerRuntimeManager } from "./Runtime.ts";
import { SharedWorkspace } from "./Workspace.ts";
import { ShellFeature } from "./tools/ShellTool.ts";
import { FilesystemFeature } from "./tools/FilesystemTools.ts";
import { VisionFeature } from "./tools/ViewImageTool.ts";
import { HttpFeature } from "./tools/HttpRequestTool.ts";
import { FeatureRegistry } from "./Feature.ts";
import {
  createCompletionTool,
  createYieldTool,
} from "./tools/LifecycleTools.ts";
import type { RuntimeEnv, RuntimeManager } from "./types.ts";
import type { ModelRuntimeConfig } from "./types.ts";
import { MCPPool } from "./mcp/MCPPool.ts";

export type ServiceFactory = () =>
  | Service
  | RouterService
  | Promise<Service | RouterService>;

export interface BuildAgentZooOptions {
  baseDir?: string;
  /** Host-facing identifier attached to managed runtime resources. */
  runtimeProject?: string;
  /** Override the config's run-wide objective. */
  taskPrompt?: string;
  modelFactory?: LanguageModelFactory;
  runtimeFactory?: (
    config: ZooConfig["runtime"],
    sharedWorkspace: string,
  ) => RuntimeManager | Promise<RuntimeManager>;
  workspaceFactory?: (root: string) => SharedWorkspace;
  services?: Readonly<Record<string, ServiceFactory>>;
  clock?: AgentZooOptions["clock"];
  random?: AgentZooOptions["random"];
}

export interface BuiltAgentZoo {
  readonly zoo: AgentZoo;
  readonly models: ModelRegistry;
  readonly templates: TemplateRegistry;
  readonly runtime: RuntimeManager;
  readonly workspace: SharedWorkspace;
}

/** Compose a validated config into the same runner used by the standalone CLI. */
export async function buildAgentZoo(
  config: ZooConfig,
  options: BuildAgentZooOptions = {},
): Promise<BuiltAgentZoo> {
  const models = new ModelRegistry(config.models);
  const templates = new TemplateRegistry(config.templates);
  const baseDir = options.baseDir ?? Deno.cwd();
  const workspaceRoot = resolve(baseDir, config.runtime.sharedWorkspace);
  const workspace = options.workspaceFactory
    ? options.workspaceFactory(workspaceRoot)
    : new SharedWorkspace(workspaceRoot);
  await workspace.prepare();

  const runtime =
    await (options.runtimeFactory
      ? options.runtimeFactory(config.runtime, workspace.root)
      : new DockerRuntimeManager(workspace.root, undefined, undefined, {
        project: options.runtimeProject,
      }));
  const lifecycle = runtime as RuntimeManager & {
    stop?: () => Promise<void>;
    destroy?: () => Promise<void>;
  };
  let zoo: AgentZoo | undefined;
  let featureRegistry: FeatureRegistry<AgentRunDeps> | undefined;
  let mcpPool: MCPPool | undefined;

  const stopRuntime = async () => {
    if (lifecycle.stop) await lifecycle.stop();
    else await lifecycle.destroy?.();
  };

  const clearAmbientContext = () => {
    if (zoo && Context.tryGet("agentZoo") === zoo) Context.delete("agentZoo");
    if (Context.tryGet("models") === models) Context.delete("models");
    if (Context.tryGet("templates") === templates) Context.delete("templates");
    if (Context.tryGet("runtime") === runtime) Context.delete("runtime");
    if (Context.tryGet("workspace") === workspace) Context.delete("workspace");
    if (featureRegistry && Context.tryGet("features") === featureRegistry) {
      Context.delete("features");
    }
  };

  try {
    const population = await expandPopulation(config);
    mcpPool = new MCPPool(config.mcp, workspace.root);
    featureRegistry = new FeatureRegistry<AgentRunDeps>();
    featureRegistry.register(new ShellFeature(config.tools));
    featureRegistry.register(new FilesystemFeature());
    featureRegistry.register(new VisionFeature());
    featureRegistry.register(new HttpFeature());
    Context.set("features", featureRegistry);
    const initialPrompts: Record<string, string | undefined> = {};
    const builtAgents: ZooAgent[] = [];
    for (const member of population) {
      if (!models.has(member.model)) {
        throw new Error(
          `Agent "${member.id}" references unknown model "${member.model}"`,
        );
      }
      if (member.captioningModel && !models.has(member.captioningModel)) {
        throw new Error(
          `Agent "${member.id}" references unknown captioningModel "${member.captioningModel}"`,
        );
      }
      const modelConfig = models.get(member.model);
      const modelRuntime = mergeModelRuntimeConfig(modelConfig, member);
      if (
        modelRuntime.context?.window !== undefined &&
        modelRuntime.context.maxOutputTokens !== undefined &&
        modelRuntime.context.maxOutputTokens >= modelRuntime.context.window
      ) {
        throw new Error(
          `Agent "${member.id}" has maxOutputTokens greater than or equal to its context window`,
        );
      }
      const systemPrompt = member.system
        ? () =>
          templates.get(member.system!)({
            agent: member.id,
            name: member.name,
            id: member.id,
            type: member.type,
            model: member.model,
          })
        : member.systemPrompt;
      const featureTools: Array<{
        id: string;
        index: number;
        tools: readonly ToolDefinition<AgentRunDeps>[];
      }> = [];
      for (const [index, feature] of member.features.entries()) {
        let registered;
        try {
          registered = featureRegistry.get(feature);
        } catch {
          throw new Error(
            `Agent "${member.id}" references unknown feature "${feature}"`,
          );
        }
        featureTools.push({
          id: feature,
          index,
          tools: await registered.createTools?.() ?? [],
        });
      }
      const tools = featureTools.flatMap((group) => group.tools);
      assertUniqueToolNames(member.id, tools);
      const orderedTools = orderAgentTools(tools);
      const orderedFeatures = orderFeatureGroups(featureTools, orderedTools);
      orderedTools.push(createYieldTool());
      if (config.completion.enabled) orderedTools.push(createCompletionTool());

      const env = await runtime.createEnv(member.id);
      await configureGitIdentity(env, member);

      builtAgents.push(
        new ZooAgent(
          {
            id: member.id,
            name: member.name,
            type: member.type,
            model: member.model,
            captioningModel: member.captioningModel,
            systemPrompt,
            features: orderedFeatures,
            cwd: member.cwd,
            maxTurns: member.maxTurns,
            context: modelRuntime.context,
            sampling: modelRuntime.sampling,
            workspace: true,
          },
          env,
          models,
          options.modelFactory ?? createLanguageModel,
          orderedTools,
          mcpPool.select(member.id, member.mcp),
        ),
      );
      initialPrompts[member.id] = composeInitialPrompt(
        member.prompt,
        options.taskPrompt ?? config.taskPrompt,
      );
    }

    const dispose = async () => {
      try {
        await stopRuntime();
      } finally {
        clearAmbientContext();
      }
    };
    zoo = new AgentZoo({
      completionEnabled: config.completion.enabled,
      initialPrompts,
      clock: options.clock,
      random: options.random,
      mcpPool,
      dispose,
    });
    for (const [name, factory] of Object.entries(options.services ?? {})) {
      if (config.services.includes(name)) zoo.use(name, await factory());
    }
    for (const name of config.services) {
      if (!options.services?.[name]) {
        throw new Error(
          `Configured service "${name}" has no registered factory`,
        );
      }
    }
    for (const agent of builtAgents) zoo.registerAgent(agent);

    // Populate the established ambient registry for existing services/routers.
    Context.set("agentZoo", zoo);
    Context.set("models", models);
    Context.set("templates", templates);
    Context.set("runtime", runtime);
    Context.set("workspace", workspace);

    return { zoo, models, templates, runtime, workspace };
  } catch (error) {
    clearAmbientContext();
    try {
      await stopRuntime();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "AgentZoo startup failed and runtime cleanup also failed",
      );
    }
    throw error;
  }
}

function assertUniqueToolNames(
  agentId: string,
  tools: readonly ToolDefinition<AgentRunDeps>[],
): void {
  const seen = new Map<string, string>();
  for (const tool of tools) {
    const existing = seen.get(tool.name);
    if (existing) {
      throw new Error(
        `Agent "${agentId}" has duplicate tool name "${tool.name}"`,
      );
    }
    seen.set(tool.name, tool.name);
  }
}

async function configureGitIdentity(
  env: RuntimeEnv,
  member: Pick<PopulationMember, "id" | "name">,
): Promise<void> {
  const name = member.name ?? member.id;
  const identity = [
    ["user.name", name],
    ["user.email", `${gitEmailLocalPart(name)}@${member.id}.local`],
  ] as const;

  for (const [key, value] of identity) {
    await env.exec(
      ["git", "config", "--global", key, value],
      { env: { HOME: "/root" } },
    ).catch(() => undefined);
  }
}

const BuiltinToolOrder = [
  "shell",
  "apply_patch",
  "write_file",
  "edit_file",
  "read_file",
  "list_directory",
  "search_files",
  "http_request",
] as const;

function orderAgentTools<TDeps>(
  tools: readonly ToolDefinition<TDeps>[],
): ToolDefinition<TDeps>[] {
  const priority = new Map<string, number>(
    BuiltinToolOrder.map((name, index) => [name, index]),
  );
  return tools.map((tool, index) => ({ tool, index })).sort((left, right) => {
    const leftPriority = priority.get(left.tool.name);
    const rightPriority = priority.get(right.tool.name);
    if (leftPriority === undefined && rightPriority === undefined) {
      return left.index - right.index;
    }
    if (leftPriority === undefined) return 1;
    if (rightPriority === undefined) return -1;
    return leftPriority - rightPriority;
  }).map(({ tool }) => tool);
}

function orderFeatureGroups<TDeps>(
  groups: readonly {
    id: string;
    index: number;
    tools: readonly ToolDefinition<TDeps>[];
  }[],
  orderedTools: readonly ToolDefinition<TDeps>[],
): string[] {
  const toolPositions = new Map<ToolDefinition<TDeps>, number>();
  orderedTools.forEach((tool, index) => toolPositions.set(tool, index));
  return [...groups].sort((left, right) => {
    const leftPosition = Math.min(
      ...left.tools.map((tool) => toolPositions.get(tool) ?? Infinity),
      Infinity,
    );
    const rightPosition = Math.min(
      ...right.tools.map((tool) => toolPositions.get(tool) ?? Infinity),
      Infinity,
    );
    return leftPosition - rightPosition || left.index - right.index;
  }).map((group) => group.id);
}

/** Compose agent-specific guidance and the run-wide objective as one user message. */
export function composeInitialPrompt(
  instructions?: string,
  objective?: string,
): string | undefined {
  const parts = [
    instructions ? `INSTRUCTIONS: ${instructions}` : undefined,
    objective ? `OBJECTIVE: ${objective}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n") : undefined;
}

interface PopulationMember {
  id: string;
  name?: string;
  type: string;
  model: string;
  captioningModel?: string;
  system?: string;
  systemPrompt?: string;
  prompt?: string;
  features: string[];
  mcp?: string[];
  cwd: string;
  maxTurns: number;
  context?: ModelRuntimeConfig["context"];
  sampling?: ModelRuntimeConfig["sampling"];
}

async function expandPopulation(
  config: ZooConfig,
): Promise<PopulationMember[]> {
  const members: PopulationMember[] = [];
  const ids = new Set<string>();
  const typeCounts = new Map<string, number>();
  for (const group of config.agents) {
    const previousCount = typeCounts.get(group.type) ?? 0;
    for (let offset = 1; offset <= group.count; offset++) {
      const index = previousCount + offset;
      const semanticId = `${group.type}-${index}`;
      const id = await opaqueAgentId(semanticId);
      if (ids.has(id)) throw new Error(`Duplicate configured agent id "${id}"`);
      ids.add(id);
      members.push({
        id,
        name: group.names?.[offset - 1] ?? group.name,
        type: group.type,
        model: group.model,
        captioningModel: group.captioningModel,
        system: group.system,
        systemPrompt: group.systemPrompt,
        prompt: group.prompt,
        features: [...group.features],
        mcp: group.mcp ? [...group.mcp] : undefined,
        cwd: group.cwd,
        maxTurns: group.maxTurns,
        context: group.context,
        sampling: group.sampling,
      });
    }
    typeCounts.set(group.type, previousCount + group.count);
  }
  return members;
}

/** Derive the stable, opaque identity used outside population expansion. */
async function opaqueAgentId(semanticId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(semanticId)),
  );
  return Array.from(
    digest.slice(0, 6),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function gitEmailLocalPart(name: string): string {
  const localPart = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return localPart || "user";
}

/** Merge named-model defaults with field-level overrides from an agent entry. */
export function mergeModelRuntimeConfig(
  model: ModelRuntimeConfig,
  overrides: ModelRuntimeConfig,
): ModelRuntimeConfig {
  const context = model.context || overrides.context
    ? { ...model.context, ...overrides.context }
    : undefined;
  const sampling = model.sampling || overrides.sampling
    ? { ...model.sampling, ...overrides.sampling }
    : undefined;
  return { context, sampling };
}
