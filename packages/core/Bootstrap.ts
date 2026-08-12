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
import { ShellFeature } from "./ShellFeature.ts";
import { FilesystemFeature } from "./FilesystemFeature.ts";
import { VisionFeature } from "./VisionFeature.ts";
import { HttpFeature } from "./HttpFeature.ts";
import { FeatureRegistry } from "./Feature.ts";
import { createCompletionTool, createYieldTool } from "./LifecycleTools.ts";
import type { RuntimeManager } from "./types.ts";
import type { ModelRuntimeConfig } from "./types.ts";

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

  const population = expandPopulation(config);
  const featureRegistry = new FeatureRegistry<AgentRunDeps>();
  featureRegistry.register(new ShellFeature());
  featureRegistry.register(new FilesystemFeature());
  featureRegistry.register(new VisionFeature());
  featureRegistry.register(new HttpFeature());
  const initialPrompts: Record<string, string | undefined> = {};
  const builtAgents: ZooAgent[] = [];
  for (const member of population) {
    if (!models.has(member.model)) {
      throw new Error(
        `Agent "${member.id}" references unknown model "${member.model}"`,
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
      ? await templates.get(member.system)({
        agent: member.id,
        name: member.name,
        id: member.id,
        type: member.type,
        model: member.model,
      })
      : member.systemPrompt;
    const tools: ToolDefinition<AgentRunDeps>[] = [];
    for (const feature of member.features) {
      let registered;
      try {
        registered = featureRegistry.get(feature);
      } catch {
        throw new Error(
          `Agent "${member.id}" references unknown feature "${feature}"`,
        );
      }
      tools.push(...await registered.createTools?.() ?? []);
    }
    const orderedTools = orderAgentTools(tools);
    orderedTools.push(createYieldTool());
    if (config.completion.enabled) orderedTools.push(createCompletionTool());
    const env = await runtime.createEnv(member.id);
    builtAgents.push(
      new ZooAgent(
        {
          id: member.id,
          name: member.name,
          type: member.type,
          model: member.model,
          systemPrompt,
          features: member.features,
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
      ),
    );
    initialPrompts[member.id] = composeInitialPrompt(
      member.prompt,
      options.taskPrompt ?? config.taskPrompt,
    );
  }

  const disposable = runtime as RuntimeManager & {
    destroy?: () => Promise<void>;
  };
  const dispose = async () => {
    await disposable.destroy?.();
    if (Context.tryGet("agentZoo") === zoo) Context.delete("agentZoo");
    if (Context.tryGet("models") === models) Context.delete("models");
    if (Context.tryGet("templates") === templates) Context.delete("templates");
    if (Context.tryGet("runtime") === runtime) Context.delete("runtime");
    if (Context.tryGet("workspace") === workspace) Context.delete("workspace");
  };
  const zoo = new AgentZoo({
    completionEnabled: config.completion.enabled,
    initialPrompts,
    clock: options.clock,
    random: options.random,
    dispose,
  });
  for (const [name, factory] of Object.entries(options.services ?? {})) {
    if (config.services.includes(name)) zoo.use(name, await factory());
  }
  for (const name of config.services) {
    if (!options.services?.[name]) {
      throw new Error(`Configured service "${name}" has no registered factory`);
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
  system?: string;
  systemPrompt?: string;
  prompt?: string;
  features: string[];
  cwd: string;
  maxTurns: number;
  context?: ModelRuntimeConfig["context"];
  sampling?: ModelRuntimeConfig["sampling"];
}

function expandPopulation(config: ZooConfig): PopulationMember[] {
  const members: PopulationMember[] = [];
  const ids = new Set<string>();
  const typeCounts = new Map<string, number>();
  for (const group of config.agents) {
    const previousCount = typeCounts.get(group.type) ?? 0;
    for (let offset = 1; offset <= group.count; offset++) {
      const index = previousCount + offset;
      const id = `${group.type}-${index}`;
      if (ids.has(id)) throw new Error(`Duplicate configured agent id "${id}"`);
      ids.add(id);
      members.push({
        id,
        name: group.names?.[offset - 1] ?? group.name,
        type: group.type,
        model: group.model,
        system: group.system,
        systemPrompt: group.systemPrompt,
        prompt: group.prompt,
        features: [...group.features],
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
