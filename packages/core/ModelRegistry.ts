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

import type { ModelConfig, ModelRegistrySource } from "./types.ts";

/**
 * Resolves named model configurations to provider + model descriptors.
 *
 * This layer owns provider-SELECTION and configuration handling. It does NOT
 * translate configs into a concrete inference client — that is the
 * responsibility of the Vibes SDK integration, which can ask the registry for
 * a config by agent-facing key. Keeping the resolution here means provider
 * specifics stay out of Services and Agents.
 */
export class ModelRegistry {
  readonly #configs = new Map<string, ModelConfig>();

  constructor(source?: ModelRegistrySource) {
    if (source) {
      for (const [name, config] of Object.entries(source)) {
        this.register(name, config);
      }
    }
  }

  /** Register or overwrite a named model configuration. */
  register(name: string, config: ModelConfig): void {
    if (
      !config || typeof config.provider !== "string" ||
      typeof config.model !== "string"
    ) {
      throw new TypeError(
        `Invalid model configuration for "${name}": expected { provider, model }`,
      );
    }

    this.#configs.set(name, { ...config });
  }

  has(name: string): boolean {
    return this.#configs.has(name);
  }

  /** Get a configuration, throwing if the name is unknown. */
  get(name: string): ModelConfig {
    const config = this.#configs.get(name);

    if (!config) {
      throw new Error(`Unknown model configuration: "${name}"`);
    }

    return config;
  }

  /** List registered configuration names. */
  list(): string[] {
    return [...this.#configs.keys()];
  }

  /** Snapshot of all configurations. */
  toObject(): ModelRegistrySource {
    return Object.fromEntries(this.#configs);
  }
}
