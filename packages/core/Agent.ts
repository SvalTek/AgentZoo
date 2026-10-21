/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type {
  Agent as VibesAgent,
  AgentStreamEvent,
  ToolDefinition,
} from "@vibesjs/sdk";
import { tokenTrimHistoryProcessor } from "@vibesjs/sdk";
import { FilteredToolset, type Toolset } from "@vibesjs/sdk";
import type { LanguageModel, ModelMessage } from "npm:ai@^6";
import { TextTemplate } from "@agent-zoo/shared";
import type {
  AgentActivationOptions,
  AgentActivationResult,
  AgentConfig,
  ModelRuntimeConfig,
  RuntimeEnv,
} from "./types.ts";
import type { ModelRegistry } from "./ModelRegistry.ts";
import { buildFeaturePrompt } from "./Feature.ts";
import { ToolExecutionError, unwrapObservedToolResult } from "./ToolSupport.ts";
import {
  ObservedToolset,
  type ObserveToolCall,
  OptionalMCPToolset,
} from "./mcp/ObservedToolset.ts";
import { type MCPServerEntry } from "./mcp/MCPPool.ts";
import { MCPNamedToolset } from "./mcp/NamedToolset.ts";
import { createMCPListToolsTool } from "./mcp/ListToolsTool.ts";
import { createMCPResourceTools } from "./mcp/ResourceTools.ts";

/** The per-run environment AgentZoo exposes to Vibes tools. */
export interface AgentRunDeps {
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly captioningModel?: string;
  readonly runtime: RuntimeEnv;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly control: AgentActivationControl;
}

export interface AgentActivationControl {
  requested?: "yield" | "complete";
  enabledMcpServers?: Set<string>;
}

export interface ModelExchange {
  readonly callId: string;
  readonly startedAt: number;
  endedAt?: number;
  readonly request: unknown;
  response?: unknown;
  error?: unknown;
}

export interface FailedActivationRecord {
  readonly prompt: string;
  readonly promptRole: "user" | "system" | "none";
  readonly systemPrompt?: string;
  readonly messages: readonly unknown[];
  readonly modelExchanges: readonly ModelExchange[];
}

const MalformedToolCallCorrection =
  "Automated correction: The previous tool call was malformed and could not be processed. Retry the intended tool call using the tool's parameter schema exactly.";
const UndirectedActivationPrompt = "Begin.";

/** Error carrying the provider transcript Vibes does not include on failure. */
export class AgentActivationError extends Error {
  readonly activation: FailedActivationRecord;

  constructor(cause: unknown, activation: FailedActivationRecord) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : "AgentActivationError";
    this.activation = activation;
  }
}

type ModelBoundaryEvent =
  | { kind: "request"; callId: string; at: number; request: unknown }
  | { kind: "response"; callId: string; at: number; response: unknown }
  | { kind: "error"; callId: string; at: number; error: unknown };

/** Creates the actual AI-SDK model object from a named AgentZoo model config. */
export type LanguageModelFactory = (
  name: string,
  models: ModelRegistry,
  settings?: ModelRuntimeConfig,
) => LanguageModel | Promise<LanguageModel>;

/** Input-history budget after reserving the configured generation allowance. */
export function modelInputTokenBudget(
  context: AgentConfig["context"],
): number | undefined {
  if (context?.window === undefined) return undefined;
  return context.window - (context.maxOutputTokens ?? 0);
}

/** Keep a positive history budget after reserving measured prompt-envelope cost. */
export function adjustedHistoryTokenBudget(
  baseBudget: number,
  promptEnvelopeReserve: number,
): number {
  return Math.max(1, baseBudget - promptEnvelopeReserve);
}

function estimatedEnvelopeTokens(characters: number): number {
  return Math.ceil(characters / 3);
}

/** Stable facts about every Docker-backed agent environment. */
export const RuntimeEnvironmentContract = `## Environment

You are operating in a Linux filesystem. The directory \`/shared\` is persistent
shared storage. Other filesystem locations are private to this environment.`;

const AgentZooSystemTemplate = new TextTemplate(`${RuntimeEnvironmentContract}

{#IF hasFeatures}
{featurePrompt}
{#END}

{#IF hasMcpTools}
{mcpTools}
{#END}`);

export async function buildAgentSystemPrompt(
  features: readonly string[] = [],
  featureArgs: Record<string, unknown> = {},
): Promise<string> {
  const args: Record<string, unknown> = {
    hasFeatures: features.length > 0,
    hasMcpTools: typeof featureArgs.mcpTools === "string" &&
      featureArgs.mcpTools.trim().length > 0,
  };
  if (features.length) {
    args.featurePrompt = () => buildFeaturePrompt(features, featureArgs);
  }
  if (args.hasMcpTools) args.mcpTools = featureArgs.mcpTools;
  return await AgentZooSystemTemplate.render(args);
}

function formatMcpTools(servers: readonly MCPServerEntry[]): string {
  if (!servers.length) return "";
  return `## MCP tools

These MCP servers are available to you:
${
    servers.map((server) => `- \`${server.name}\`: ${server.description}`).join(
      "\n",
    )
  }

Call \`list_tools\` with an MCP server name when you want to use that server. Its
tools will be available on your next turn. Use \`list_resources\` and
\`read_resource\` to discover and read its MCP resources.`;
}

/**
 * A real Vibes reasoning actor bound to one AgentZoo identity and runtime.
 * AgentZoo owns its environment; Vibes owns the model/tool loop.
 */
export class ZooAgent extends EventTarget {
  readonly id: string;
  readonly config: Readonly<AgentConfig>;
  readonly runtime: RuntimeEnv;
  readonly #createModel: LanguageModelFactory;
  readonly #models: ModelRegistry;
  readonly #tools: readonly ToolDefinition<AgentRunDeps>[];
  readonly #mcpServers: readonly MCPServerEntry[];
  #vibes?: VibesAgent<AgentRunDeps>;
  #baseSystemPrompt?: string;
  #initialSystemContext?: string;
  #systemPromptInHistory = false;
  #resolvedSystemPrompt?: string;
  #history: ModelMessage[] = [];
  #activeModelExchanges?: ModelExchange[];
  #toolSequence = 0;
  #promptEnvelopeReserve = 0;

  constructor(
    config: AgentConfig,
    runtime: RuntimeEnv,
    models: ModelRegistry,
    createModel: LanguageModelFactory,
    tools: readonly ToolDefinition<AgentRunDeps>[] = [],
    mcpServers: readonly MCPServerEntry[] = [],
  ) {
    super();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.id)) {
      throw new TypeError("Invalid agent id");
    }
    this.id = config.id;
    this.config = Object.freeze({
      ...config,
      features: config.features ? [...config.features] : undefined,
      context: config.context ? { ...config.context } : undefined,
      sampling: config.sampling
        ? {
          ...config.sampling,
          ...(config.sampling.stopSequences
            ? { stopSequences: [...config.sampling.stopSequences] }
            : {}),
        }
        : undefined,
    });
    this.runtime = runtime;
    this.#createModel = createModel;
    this.#models = models;
    this.#mcpServers = [...mcpServers];
    const mcpBuiltinNames = new Set([
      "list_tools",
      "list_resources",
      "read_resource",
    ]);
    if (
      this.#mcpServers.length &&
      tools.some((tool) => mcpBuiltinNames.has(tool.name))
    ) {
      const duplicate = tools.find((tool) => mcpBuiltinNames.has(tool.name))!;
      throw new Error(
        `Agent "${config.id}" has duplicate tool name "${duplicate.name}"`,
      );
    }
    const onMcpUnavailable = (serverName: string, error: Error) => {
      this.dispatchEvent(
        new CustomEvent("mcpunavailable", {
          detail: { serverName, error, message: error.message },
        }),
      );
    };
    const mcpBuiltins = this.#mcpServers.length
      ? [
        ...createMCPResourceTools(this.#mcpServers, onMcpUnavailable),
        createMCPListToolsTool(this.#mcpServers, onMcpUnavailable),
      ]
      : [];
    this.#tools = [...tools, ...mcpBuiltins];
  }

  async prepare(): Promise<void> {
    await this.runtime.prepare();
  }

  async run(prompt: string, signal?: AbortSignal): Promise<string> {
    return (await this.activate(prompt, signal)).output ?? "";
  }

  /** Run one activation and preserve its exact Vibes conversation history. */
  async activate(
    prompt: string,
    signal?: AbortSignal,
    options: AgentActivationOptions = {},
  ): Promise<AgentActivationResult> {
    const appendPrompt = options.appendPrompt ?? true;
    const undirectedStartup = !appendPrompt && !this.#history.length &&
      prompt.trim().length === 0;
    const effectivePrompt = undirectedStartup
      ? UndirectedActivationPrompt
      : prompt;
    const effectiveAppendPrompt = appendPrompt || undirectedStartup;
    const promptRole = effectiveAppendPrompt ? options.role ?? "user" : "none";
    if (options.initialSystemContext) {
      if (this.#vibes || this.#history.length) {
        throw new Error(
          "Initial system context must be set on the first activation",
        );
      }
      this.#initialSystemContext = options.initialSystemContext;
    }
    if (!appendPrompt && !this.#history.length) {
      this.#systemPromptInHistory = true;
    }
    this.#resolvedSystemPrompt = this.currentSystemPrompt();
    const control: AgentActivationControl = {};
    const exchanges: ModelExchange[] = [];
    this.#activeModelExchanges = exchanges;
    try {
      const result = await (await this.getVibes()).run(effectivePrompt, {
        deps: {
          agentId: this.id,
          provider: this.#models.get(this.config.model).provider,
          model: this.config.model,
          captioningModel: this.config.captioningModel,
          runtime: this.runtime,
          cwd: this.config.cwd ?? "/root",
          signal,
          control,
        },
        messageHistory: this.#history,
        messageRole: promptRole === "none" ? undefined : promptRole,
        appendPrompt: effectiveAppendPrompt,
        systemPromptAsMessage: this.#systemPromptInHistory,
      });
      this.#history = [...result.messages];
      const output = typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);
      return {
        outcome: control.requested ?? "response",
        output,
        messages: [...result.newMessages],
        systemPrompt: this.#resolvedSystemPrompt,
        metadata: {
          usage: result.usage,
          retryCount: result.retryCount,
          runId: result.runId,
          modelCallIds: exchanges.map((exchange) => exchange.callId),
        },
      };
    } catch (error) {
      throw new AgentActivationError(error, {
        prompt: effectivePrompt,
        promptRole,
        systemPrompt: this.#resolvedSystemPrompt,
        messages: providerTranscript(exchanges),
        modelExchanges: exchanges,
      });
    } finally {
      this.#activeModelExchanges = undefined;
    }
  }

  /** Build taskless startup input from an actual private-root observation. */
  async observeEnvironment(cwd = this.config.cwd ?? "/root"): Promise<string> {
    const result = await this.runtime.exec(
      [
        "/bin/bash",
        "--login",
        "-c",
        "printf '%s\\n' \"$PWD\"; id -un; find . -mindepth 1 -maxdepth 2 -printf '%y %p\\n' | sort | head -n 200",
      ],
      { cwd, timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not observe ${this.id}'s environment: ${result.stderr}`,
      );
    }
    const [actualCwd = cwd, user = "root", ...entries] = result.stdout
      .trimEnd().split("\n");
    const visibleEntries = entries.map((entry) => {
      const match = /^([fdl]) (.*)$/.exec(entry);
      if (!match) return entry;
      const type = match[1] === "f"
        ? "file"
        : match[1] === "d"
        ? "directory"
        : "symlink";
      return `${type} ${match[2]}`;
    });
    return `You are logged into the shell as ${user}.\n\nYour current working directory is ${actualCwd}.\nIts visible contents are:\n\n${
      visibleEntries.length ? visibleEntries.join("\n") : "(empty)"
    }`;
  }

  get historyLength(): number {
    return this.#history.length;
  }

  async *runStreamEvents(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    for await (
      const event of (await this.getVibes()).runStreamEvents(prompt, {
        deps: {
          agentId: this.id,
          provider: this.#models.get(this.config.model).provider,
          model: this.config.model,
          captioningModel: this.config.captioningModel,
          runtime: this.runtime,
          cwd: this.config.cwd ?? "/root",
          signal,
          control: {},
        },
      })
    ) yield event;
  }

  async stop(): Promise<void> {
    await this.runtime.destroy();
  }

  private async getVibes(): Promise<VibesAgent<AgentRunDeps>> {
    if (!this.#vibes) {
      const { Agent } = await import("@vibesjs/sdk");
      this.#baseSystemPrompt = await buildAgentSystemPrompt(
        this.config.features,
        {
          agent: this.id,
          name: this.config.name,
          id: this.id,
          type: this.config.type,
          model: this.config.model,
          shellEnvironment: this.#initialSystemContext ?? "",
          mcpTools: formatMcpTools(this.#mcpServers),
        },
      );
      this.#resolvedSystemPrompt = this.currentSystemPrompt();
      const inputBudget = modelInputTokenBudget(this.config.context);
      const historyBudget = inputBudget;
      this.#vibes = new Agent<AgentRunDeps>({
        name: this.config.name ?? this.id,
        model: observeLanguageModel(
          await this.#createModel(this.config.model, this.#models, {
            context: this.config.context,
            sampling: this.config.sampling,
          }),
          (event) => this.observeModelBoundary(event),
        ),
        systemPrompt: () => this.currentSystemPrompt(),
        instructions: this.config.systemPrompt,
        tools: this.#tools.map((definition) => this.observeTool(definition)),
        ...(this.#mcpServers.length
          ? {
            toolsets: [this.mcpToolset()],
          }
          : {}),
        maxConcurrency: 1,
        maxTurns: this.config.maxTurns ?? 100,
        historyProcessors: historyBudget === undefined ? [] : [
          (messages, context) =>
            tokenTrimHistoryProcessor<AgentRunDeps>(
              adjustedHistoryTokenBudget(
                historyBudget,
                this.#promptEnvelopeReserve +
                  estimatedEnvelopeTokens(context.toolSchemaChars ?? 0) +
                  (this.#systemPromptInHistory
                    ? 0
                    : estimatedEnvelopeTokens(context.systemPromptChars ?? 0)),
              ),
              (message) =>
                estimatedEnvelopeTokens(JSON.stringify(message).length),
            )(messages, context),
        ],
        modelSettings: {
          allowSystemInMessages: true,
          maxTokens: this.config.context?.maxOutputTokens,
          temperature: this.config.sampling?.temperature,
          topP: this.config.sampling?.topP,
          topK: this.config.sampling?.topK,
          frequencyPenalty: this.config.sampling?.frequencyPenalty,
          presencePenalty: this.config.sampling?.presencePenalty,
          stopSequences: this.config.sampling?.stopSequences,
          seed: this.config.sampling?.seed,
        },
      });
    }
    return this.#vibes;
  }

  private currentSystemPrompt(): string {
    return this.#baseSystemPrompt ?? RuntimeEnvironmentContract;
  }

  private observeTool(
    definition: ToolDefinition<AgentRunDeps>,
  ): ToolDefinition<AgentRunDeps> {
    return {
      ...definition,
      execute: async (context, args) => {
        return await this.observeToolCall(
          definition.name,
          args as Record<string, unknown>,
          () => definition.execute(context, args),
        ) as never;
      },
    };
  }

  private mcpToolset(): Toolset<AgentRunDeps> {
    const prefixed = this.#mcpServers.map((server) => ({
      name: server.name,
      toolset: new MCPNamedToolset(
        new FilteredToolset(
          server.toolset,
          (context) =>
            context.deps.control.enabledMcpServers?.has(
              server.name,
            ) ?? false,
        ),
        server.name,
      ),
    }));
    return new ObservedToolset(
      new OptionalMCPToolset(prefixed, (serverName, error) => {
        this.dispatchEvent(
          new CustomEvent("mcpunavailable", {
            detail: { serverName, error, message: error.message },
          }),
        );
      }),
      this.#tools.map((tool) => tool.name),
      this.observeToolCall.bind(this) as ObserveToolCall,
    );
  }

  private async observeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    execute: () => Promise<unknown>,
  ): Promise<unknown> {
    const toolCallId = `${this.id}:tool:${++this.#toolSequence}`;
    const startedAt = Date.now();
    this.dispatchEvent(
      new CustomEvent("toolstart", {
        detail: { toolCallId, toolName, startedAt, args },
      }),
    );
    try {
      const executed = await execute();
      const { result, telemetry } = unwrapObservedToolResult(executed);
      const endedAt = Date.now();
      this.dispatchEvent(
        new CustomEvent("toolend", {
          detail: {
            toolCallId,
            toolName,
            status: "success",
            result,
            telemetry,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          },
        }),
      );
      return result;
    } catch (error) {
      const endedAt = Date.now();
      const telemetry = error instanceof ToolExecutionError
        ? error.telemetry
        : undefined;
      this.dispatchEvent(
        new CustomEvent("toolerror", {
          detail: {
            toolCallId,
            toolName,
            error,
            telemetry,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          },
        }),
      );
      this.dispatchEvent(
        new CustomEvent("toolend", {
          detail: {
            toolCallId,
            toolName,
            status: "error",
            error,
            telemetry,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          },
        }),
      );
      throw error;
    }
  }

  get toolNames(): readonly string[] {
    return this.#tools.map((tool) => tool.name);
  }

  private observeModelBoundary(event: ModelBoundaryEvent): void {
    if (event.kind === "request") {
      this.#activeModelExchanges?.push({
        callId: event.callId,
        startedAt: event.at,
        request: event.request,
      });
      this.dispatchEvent(new CustomEvent("modelrequest", { detail: event }));
      return;
    }
    const exchange = this.#activeModelExchanges?.find((item) =>
      item.callId === event.callId
    );
    if (exchange) {
      exchange.endedAt = event.at;
      if (event.kind === "response") exchange.response = event.response;
      else exchange.error = event.error;
    }
    if (event.kind === "response") {
      this.updatePromptEnvelopeReserve(event.response);
    }
    this.dispatchEvent(
      new CustomEvent(
        event.kind === "response" ? "modelresponse" : "modelerror",
        { detail: event },
      ),
    );
  }

  private updatePromptEnvelopeReserve(response: unknown): void {
    const inputBudget = modelInputTokenBudget(this.config.context);
    if (inputBudget === undefined) return;
    const usage = asRecord(response)?.usage;
    const inputTokens = asRecord(usage)?.inputTokens;
    const total = asRecord(inputTokens)?.total;
    if (typeof total !== "number" || !Number.isFinite(total)) return;
    this.#promptEnvelopeReserve = Math.max(
      this.#promptEnvelopeReserve,
      Math.max(0, total - inputBudget),
    );
  }
}

/** Observe the real AI SDK provider boundary without changing model behavior. */
export function observeLanguageModel(
  model: LanguageModel,
  report: (event: ModelBoundaryEvent) => void,
): LanguageModel {
  if (typeof model === "string") return model;
  let sequence = 0;
  let previousPrompt: unknown[] = [];
  const promptsNeedingToolCallCorrection = new WeakSet<object>();
  return new Proxy(model, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "doGenerate" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (options: unknown) => {
        const promptIdentity = modelPromptIdentity(options);
        const correctedOptions = promptIdentity &&
            promptsNeedingToolCallCorrection.has(promptIdentity)
          ? addMalformedToolCallCorrection(options)
          : options;
        const effectiveOptions = normalizeProviderSystemMessages(
          correctedOptions,
        );
        const callId = `model:${++sequence}`;
        const observed = observableModelRequest(
          effectiveOptions,
          previousPrompt,
        );
        previousPrompt = observed.prompt;
        report({
          kind: "request",
          callId,
          at: Date.now(),
          request: observed.request,
        });
        try {
          const response = await Reflect.apply(value, target, [
            effectiveOptions,
          ]);
          if (promptIdentity) {
            promptsNeedingToolCallCorrection.delete(promptIdentity);
          }
          previousPrompt = appendModelResponse(previousPrompt, response);
          report({
            kind: "response",
            callId,
            at: Date.now(),
            response,
          });
          return response;
        } catch (error) {
          if (promptIdentity && isMalformedToolCallProviderError(error)) {
            promptsNeedingToolCallCorrection.add(promptIdentity);
          }
          report({ kind: "error", callId, at: Date.now(), error });
          throw error;
        }
      };
    },
  }) as LanguageModel;
}

function modelPromptIdentity(value: unknown): object | undefined {
  const prompt = asRecord(value)?.prompt;
  return prompt !== null && typeof prompt === "object" ? prompt : undefined;
}

function isMalformedToolCallProviderError(error: unknown): boolean {
  const record = asRecord(error);
  const name = error instanceof Error ? error.name : record?.name;
  const message = error instanceof Error ? error.message : record?.message;
  return name === "AI_APICallError" && typeof message === "string" &&
    /XML syntax error/i.test(message) &&
    /<(?:function|parameter)>|<\/(?:function|parameter)>/i.test(message);
}

/** Append retry guidance at the current edge without stacking system roles. */
function addMalformedToolCallCorrection(value: unknown): unknown {
  const request = asRecord(value);
  if (!request || !Array.isArray(request.prompt)) return value;
  const prompt = [...request.prompt];
  const last = asRecord(prompt.at(-1));
  if (last?.role === "system" && typeof last.content === "string") {
    prompt[prompt.length - 1] = {
      ...last,
      content: `${last.content}\n\n${MalformedToolCallCorrection}`,
    };
  } else {
    prompt.push({ role: "system", content: MalformedToolCallCorrection });
  }
  return { ...request, prompt };
}
/** Keep provider-bound conversations valid while preserving all system text. */
function normalizeProviderSystemMessages(value: unknown): unknown {
  const request = asRecord(value);
  const messages = request?.prompt;
  if (!request || !Array.isArray(messages)) return value;
  const systemIndexes = messages.flatMap((message, index) =>
    asRecord(message)?.role === "system" ? [index] : []
  );
  if (systemIndexes.length <= 1) return value;
  const firstSystemIndex = systemIndexes[0];
  const firstSystem = asRecord(messages[firstSystemIndex]);
  if (!firstSystem) return value;
  const mergedContent = systemIndexes
    .slice(1)
    .reduce(
      (content, index) =>
        mergeMessageContent(
          content,
          asRecord(messages[index])?.content,
        ),
      firstSystem.content,
    );
  const prompt = messages.filter((_, index) =>
    !systemIndexes.includes(index) || index === firstSystemIndex
  );
  prompt[firstSystemIndex] = { ...firstSystem, content: mergedContent };
  if (firstSystemIndex !== 0) {
    const [leadingSystem] = prompt.splice(firstSystemIndex, 1);
    prompt.unshift(leadingSystem);
  }
  return { ...request, prompt };
}

function mergeMessageContent(left: unknown, right: unknown): unknown {
  if (typeof left === "string" && typeof right === "string") {
    return `${left}\n\n${right}`;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return [...left, ...right];
  }
  if (typeof left === "string" && Array.isArray(right)) {
    return [{ type: "text", text: left }, ...right];
  }
  if (Array.isArray(left) && typeof right === "string") {
    return [...left, { type: "text", text: right }];
  }
  return `${String(left)}\n\n${String(right)}`;
}

function observableModelRequest(
  value: unknown,
  previousPrompt: readonly unknown[],
): { request: unknown; prompt: unknown[] } {
  if (!value || typeof value !== "object") {
    return { request: value, prompt: [] };
  }
  const { abortSignal: _abortSignal, headers, ...request } = value as Record<
    string,
    unknown
  >;
  return {
    prompt: Array.isArray(request.prompt) ? [...request.prompt] : [],
    request: deltaModelRequest(request, headers, previousPrompt),
  };
}

function deltaModelRequest(
  request: Record<string, unknown>,
  headers: unknown,
  previousPrompt: readonly unknown[],
): Record<string, unknown> {
  const prompt = Array.isArray(request.prompt) ? request.prompt : [];
  const omitSystem = previousPrompt.length > 0 &&
    isSystemMessage(prompt[0]) &&
    isSystemMessage(previousPrompt[0]) &&
    sameLoggedValue(prompt[0], previousPrompt[0]);
  const currentConversation = omitSystem && isSystemMessage(prompt[0])
    ? prompt.slice(1)
    : prompt;
  const previousConversation = omitSystem && isSystemMessage(previousPrompt[0])
    ? previousPrompt.slice(1)
    : previousPrompt;
  let promptOffset = 0;
  while (
    promptOffset < previousConversation.length &&
    promptOffset < currentConversation.length &&
    sameLoggedValue(
      previousConversation[promptOffset],
      currentConversation[promptOffset],
    )
  ) {
    promptOffset++;
  }
  return {
    ...request,
    prompt: currentConversation.slice(promptOffset),
    promptOffset,
    promptLength: prompt.length,
    promptMode: "delta",
    systemMode: omitSystem ? "omitted-after-initial" : "full",
    headerNames: headers && typeof headers === "object"
      ? Object.keys(headers)
      : undefined,
  };
}

function isSystemMessage(value: unknown): boolean {
  return asRecord(value)?.role === "system";
}

function providerTranscript(exchanges: readonly ModelExchange[]): unknown[] {
  const last = exchanges.at(-1);
  if (!last) return [];
  const prompt = exchanges.flatMap((exchange) => {
    const request = asRecord(exchange.request);
    return Array.isArray(request?.prompt) ? request.prompt : [];
  });
  const response = asRecord(last.response);
  if (response?.content !== undefined) {
    prompt.push({ role: "assistant", content: response.content });
  }
  if (last.error !== undefined) {
    prompt.push({ role: "error", content: last.error });
  }
  return prompt;
}

function sameLoggedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function appendModelResponse(
  prompt: readonly unknown[],
  response: unknown,
): unknown[] {
  const content = asRecord(response)?.content;
  return Array.isArray(content)
    ? [...prompt, { role: "assistant", content }]
    : [...prompt];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}
