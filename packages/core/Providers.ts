/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { LanguageModel } from "npm:ai@^6";
import type { ModelRegistry } from "./ModelRegistry.ts";
import type {
  ModelConfig,
  ModelRuntimeConfig,
  ModelSamplingConfig,
} from "./types.ts";

function assignDefined(
  target: Record<string, unknown>,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) target[key] = value;
  }
}

function reasoningValue(config: ModelConfig): boolean | string | undefined {
  if (config.reasoning === false) return false;
  if (config.reasoningEffort === "auto") {
    return config.provider === "ollama" && config.reasoning === true
      ? true
      : undefined;
  }
  return config.reasoningEffort ??
    (config.reasoning === true ? "medium" : undefined);
}

function mergeRuntimeConfig(
  config: ModelConfig,
  overrides?: ModelRuntimeConfig,
): ModelConfig {
  return {
    ...config,
    context: config.context || overrides?.context
      ? { ...config.context, ...overrides?.context }
      : undefined,
    sampling: config.sampling || overrides?.sampling
      ? { ...config.sampling, ...overrides?.sampling }
      : undefined,
  } as ModelConfig;
}

function openAISamplingFields(
  context: ModelRuntimeConfig["context"],
  sampling: ModelSamplingConfig | undefined,
): Record<string, unknown> {
  return {
    max_tokens: context?.maxOutputTokens,
    temperature: sampling?.temperature,
    top_p: sampling?.topP,
    top_k: sampling?.topK,
    min_p: sampling?.minP,
    typical_p: sampling?.typicalP,
    repetition_penalty: sampling?.repeatPenalty,
    repeat_last_n: sampling?.repeatLastN,
    frequency_penalty: sampling?.frequencyPenalty,
    presence_penalty: sampling?.presencePenalty,
    seed: sampling?.seed,
    stop: sampling?.stopSequences,
  };
}

function ollamaSamplingFields(
  context: ModelRuntimeConfig["context"],
  sampling: ModelSamplingConfig | undefined,
): Record<string, unknown> {
  return {
    num_ctx: context?.window,
    num_predict: context?.maxOutputTokens,
    temperature: sampling?.temperature,
    top_p: sampling?.topP,
    top_k: sampling?.topK,
    min_p: sampling?.minP,
    typical_p: sampling?.typicalP,
    repeat_penalty: sampling?.repeatPenalty,
    repeat_last_n: sampling?.repeatLastN,
    frequency_penalty: sampling?.frequencyPenalty,
    presence_penalty: sampling?.presencePenalty,
    seed: sampling?.seed,
    stop: sampling?.stopSequences,
  };
}

/** Map normalized settings to the selected provider's request dialect. */
export function configureModelRequest(
  body: Record<string, unknown>,
  config: ModelConfig,
  overrides?: ModelRuntimeConfig,
): Record<string, unknown> {
  const effective = mergeRuntimeConfig(config, overrides);
  const reasoning = reasoningValue(effective);

  if (effective.provider === "ollama") {
    // The native Ollama API keeps generation controls under `options`.
    const {
      max_output_tokens: _maxOutputTokens,
      temperature: _temperature,
      top_p: _topP,
      ...request
    } = body;
    const options = body.options !== null && typeof body.options === "object"
      ? { ...(body.options as Record<string, unknown>) }
      : {};
    assignDefined(
      options,
      ollamaSamplingFields(effective.context, effective.sampling),
    );
    if (Object.keys(options).length) request.options = options;
    else delete request.options;
    if (reasoning === undefined) delete request.think;
    else request.think = reasoning;
    return request;
  }

  const request = { ...body };
  assignDefined(
    request,
    openAISamplingFields(effective.context, effective.sampling),
  );
  if (reasoning !== undefined) {
    request.reasoning_effort = reasoning === false ? "none" : reasoning;
  }
  return request;
}

function ollamaApiBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "http://127.0.0.1:11434")
    .replace(/\/(?:api|v1)\/?$/, "") + "/api";
}

function ollamaRequestFetch(config: ModelConfig): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return await fetch(input, init);
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return await fetch(input, init);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return await fetch(input, init);
    }
    return await fetch(input, {
      ...init,
      body: JSON.stringify(
        configureModelRequest(body as Record<string, unknown>, config),
      ),
    });
  };
}

/** Creates an AI SDK model for currently supported AgentZoo configurations. */
export async function createLanguageModel(
  name: string,
  registry: ModelRegistry,
  overrides?: ModelRuntimeConfig,
): Promise<LanguageModel> {
  const config = mergeRuntimeConfig(registry.get(name), overrides);
  if (config.provider === "ollama") {
    const { createOllama } = await import("ollama-ai-provider-v2");
    const headers = config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : undefined;
    const provider = createOllama({
      baseURL: ollamaApiBaseUrl(config.baseUrl),
      headers,
      fetch: ollamaRequestFetch(config),
    });
    return provider.chat(config.model) as LanguageModel;
  }
  if (config.provider === "openai-compatible") {
    const { createOpenAICompatible } = await import(
      "@ai-sdk/openai-compatible"
    );
    const provider = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: config.baseUrl,
      apiKey: config.apiKey ?? "",
      headers: config.headers,
      transformRequestBody: (body) => configureModelRequest(body, config),
    });
    return provider.chatModel(config.model);
  }
  throw new Error(
    "No language-model provider is installed for this configuration",
  );
}
