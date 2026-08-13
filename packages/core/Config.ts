/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of AgentZoo.
 *
 * AgentZoo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * AgentZoo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AgentZoo.  If not, see <https://www.gnu.org/licenses/>.
 */

import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { z } from "zod";
import { TextTemplate } from "@agent-zoo/shared";

const NonEmptyString = z.string().min(1);
const Identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const ReasoningEffort = z.enum(["auto", "low", "medium", "high", "max"]);
const ReasoningConfigShape = {
  reasoning: z.boolean().optional(),
  reasoningEffort: ReasoningEffort.optional(),
};
const CredentialConfigShape = {
  apiKey: NonEmptyString.optional(),
};
const Probability = z.number().min(0).max(1);
const ContextConfigSchema = z.object({
  window: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
}).refine(
  ({ window, maxOutputTokens }) =>
    window === undefined || maxOutputTokens === undefined ||
    maxOutputTokens < window,
  { message: "maxOutputTokens must be smaller than window" },
);
const SamplingConfigSchema = z.object({
  temperature: z.number().nonnegative().optional(),
  topP: Probability.optional(),
  topK: z.number().int().nonnegative().optional(),
  minP: Probability.optional(),
  typicalP: Probability.optional(),
  repeatPenalty: z.number().positive().optional(),
  repeatLastN: z.number().int().min(-1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  seed: z.number().int().optional(),
  stopSequences: z.array(NonEmptyString).min(1).optional(),
});
const ModelRuntimeConfigShape = {
  context: ContextConfigSchema.optional(),
  sampling: SamplingConfigSchema.optional(),
};

const OllamaModelConfigSchema = z.object({
  provider: z.literal("ollama"),
  model: NonEmptyString,
  name: NonEmptyString.optional(),
  baseUrl: NonEmptyString.optional(),
  ...CredentialConfigShape,
  ...ReasoningConfigShape,
  ...ModelRuntimeConfigShape,
});

const OpenAICompatibleModelConfigSchema = z.object({
  provider: z.literal("openai-compatible"),
  model: NonEmptyString,
  name: NonEmptyString.optional(),
  baseUrl: NonEmptyString,
  ...CredentialConfigShape,
  headers: z.record(NonEmptyString, NonEmptyString).optional(),
  ...ReasoningConfigShape,
  ...ModelRuntimeConfigShape,
});

const ModelConfigSchema = z.discriminatedUnion("provider", [
  OllamaModelConfigSchema,
  OpenAICompatibleModelConfigSchema,
]);

const RuntimeConfigSchema = z.object({
  backend: z.literal("docker").default("docker"),
  sharedWorkspace: NonEmptyString.default(".shared"),
});

const AgentPopulationConfigSchema = z.object({
  type: Identifier,
  name: NonEmptyString.optional(),
  names: z.array(NonEmptyString).min(1).max(100).optional(),
  count: z.number().int().positive().max(100).optional(),
  model: NonEmptyString,
  captioningModel: NonEmptyString.optional(),
  system: NonEmptyString.optional(),
  systemPrompt: NonEmptyString.optional(),
  prompt: NonEmptyString.optional(),
  features: z.array(Identifier).default(["shell", "filesystem"]),
  cwd: NonEmptyString.default("/root"),
  maxTurns: z.number().int().positive().default(100),
  ...ModelRuntimeConfigShape,
}).superRefine((value, context) => {
  if (value.system && value.systemPrompt) {
    context.addIssue({
      code: "custom",
      message: "Use either system or systemPrompt, not both",
    });
  }
  if (value.name && value.names) {
    context.addIssue({
      code: "custom",
      message: "Use either name or names, not both",
    });
  }
  if (value.names && value.count !== undefined) {
    context.addIssue({
      code: "custom",
      message:
        "Do not use count with names; the list defines the population size",
    });
  }
}).transform((value) => ({
  ...value,
  count: value.names?.length ?? value.count ?? 1,
}));

const CompletionConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

/** Runtime Zod schema for the user-facing AgentZoo YAML configuration. */
export const ZooConfigSchema = z.object({
  taskPrompt: NonEmptyString.optional(),
  models: z.record(NonEmptyString, ModelConfigSchema).default({}),
  services: z.array(Identifier).default([]),
  templates: z.record(NonEmptyString, z.string()).default({}),
  runtime: RuntimeConfigSchema.default({
    backend: "docker",
    sharedWorkspace: ".shared",
  }),
  agents: z.array(AgentPopulationConfigSchema).min(1),
  completion: CompletionConfigSchema.default({ enabled: true }),
});

export type ZooConfig = z.infer<typeof ZooConfigSchema>;

/** Thrown when a YAML document is not a valid AgentZoo configuration. */
export class ConfigValidationError extends TypeError {
  constructor(errors: readonly string[]) {
    super(`Invalid AgentZoo configuration:\n${errors.join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Compiled named templates from a validated YAML configuration.
 *
 * The YAML file intentionally holds source text, while all rendering uses the
 * shared TextTemplate implementation rather than an ad-hoc interpolation path.
 */
export class TemplateRegistry {
  readonly #templates = new Map<string, TextTemplate>();

  constructor(sources: Readonly<Record<string, string>> = {}) {
    for (const [name, source] of Object.entries(sources)) {
      this.#templates.set(name, new TextTemplate(source));
    }
  }

  has(name: string): boolean {
    return this.#templates.has(name);
  }

  get(name: string): TextTemplate {
    const template = this.#templates.get(name);
    if (!template) throw new Error(`Unknown AgentZoo template: "${name}"`);
    return template;
  }

  list(): string[] {
    return [...this.#templates.keys()];
  }
}

/** Parse, validate, and resolve environment references in YAML source. */
export function parseConfig(
  source: string,
  getEnvironment = (name: string) => Deno.env.get(name),
): ZooConfig {
  const parsed = parseYaml(source) as unknown;

  const document = parsed === null || parsed === undefined ? {} : parsed;

  if (typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError(
      `AgentZoo config must be a YAML mapping, got ${typeof parsed}`,
    );
  }

  const result = ZooConfigSchema.safeParse(document);
  if (!result.success) {
    const errors = result.error.issues.map((error) =>
      `/${error.path.join("/")}: ${error.message}`
    );
    throw new ConfigValidationError(errors);
  }

  return resolveConfigEnvironment(result.data, getEnvironment);
}

/**
 * Load a user-facing AgentZoo configuration from a YAML file.
 *
 * The on-disk format is YAML (not JSON) for human editing ergonomics. The
 * parsed shape is checked against the Zod {@link ZooConfigSchema} before it reaches
 * AgentZoo. This is the single user-facing configuration boundary.
 */
export async function loadConfig(path: string | URL): Promise<ZooConfig> {
  if (!(await exists(path))) {
    throw new Error(`AgentZoo config not found: ${path}`);
  }

  return parseConfig(await Deno.readTextFile(path));
}

/** Resolve environment references in validated application configuration. */
export function resolveConfigEnvironment(
  config: ZooConfig,
  getEnvironment = (name: string) => Deno.env.get(name),
): ZooConfig {
  const models = Object.fromEntries(
    Object.entries(config.models).map(([modelName, model]) => {
      const reference = model.apiKey?.match(/^ENV\[([^\]\r\n]+)\]$/);
      if (!reference) return [modelName, model];
      const environmentName = reference[1];
      const apiKey = getEnvironment(environmentName);
      if (!apiKey) {
        throw new ConfigValidationError([
          `/models/${modelName}/apiKey: Environment variable "${environmentName}" is not set or is empty`,
        ]);
      }
      return [modelName, { ...model, apiKey }];
    }),
  );
  return { ...config, models };
}
