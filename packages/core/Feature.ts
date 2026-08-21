/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import Context from "@agent-zoo/context";
import type { TextTemplate } from "@agent-zoo/shared";

/** A reusable capability deliberately granted through configuration. */
export interface Feature<TAgent = unknown> {
  readonly id: string;
  readonly description: string;
  /** Model-facing guidance rendered into AgentZoo's system prompt when enabled. */
  readonly systemPrompt?: TextTemplate;
  prepare?(agent: TAgent): Promise<void>;
  dispose?(agent: TAgent): Promise<void>;
  createTools?(): Promise<readonly ToolDefinition<TAgent>[]>;
}

/** Render enabled feature guidance through the registry established by Bootstrap. */
export async function buildFeaturePrompt(
  featureIds: readonly string[],
  args: Record<string, unknown>,
): Promise<string> {
  const features = Context.get<FeatureRegistry>("features");
  const parts = await Promise.all(featureIds.map(async (id) => {
    const template = features.get(id).systemPrompt;
    return template ? await template.render(args) : undefined;
  }));
  return parts.filter((part): part is string => Boolean(part?.trim())).join("\n\n");
}

export class FeatureRegistry<TAgent = unknown> {
  readonly #features = new Map<string, Feature<TAgent>>();

  register(feature: Feature<TAgent>): void {
    if (!/^[a-z][a-z0-9-]*$/.test(feature.id)) {
      throw new TypeError("Invalid feature id");
    }
    if (this.#features.has(feature.id)) {
      throw new Error(`Feature already registered: ${feature.id}`);
    }
    this.#features.set(feature.id, feature);
  }

  get(id: string): Feature<TAgent> {
    const feature = this.#features.get(id);
    if (!feature) throw new Error(`Unknown feature: ${id}`);
    return feature;
  }
}
