/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";

/** A reusable capability deliberately granted through configuration. */
export interface Feature<TAgent = unknown> {
  readonly id: string;
  readonly description: string;
  prepare?(agent: TAgent): Promise<void>;
  dispose?(agent: TAgent): Promise<void>;
  createTools?(): Promise<readonly ToolDefinition<TAgent>[]>;
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
