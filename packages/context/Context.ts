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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AgentZoo. If not, see <https://www.gnu.org/licenses/>.
 */

import type { ContextView } from "./types.ts";

export class ContextRegistry {
  readonly #values = new Map<string, unknown>();

  /**
   * Returns whether a value exists in the context.
   */
  has(key: string): boolean {
    return this.#values.has(key);
  }

  /**
   * Gets a value from the context.
   *
   * Throws if the key is not registered.
   */
  get<T = unknown>(key: string): T {
    if (!this.#values.has(key)) {
      throw new Error(`Context value "${key}" is not registered`);
    }

    return this.#values.get(key) as T;
  }

  /**
   * Gets a value from the context if it exists.
   */
  tryGet<T = unknown>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  /**
   * Sets a value in the context.
   *
   * Returns whether the value was accepted.
   */
  set<T>(key: string, value: T): boolean {
    this.#values.set(key, value);
    return true;
  }

  /**
   * Removes a value from the context.
   */
  delete(key: string): boolean {
    return this.#values.delete(key);
  }

  /**
   * Returns a typed view over this context.
   *
   * The view does not create or copy context state. It only constrains
   * access to the supplied context shape at the type level.
   */
  view<T extends object>(): ContextView<T> {
    return this as unknown as ContextView<T>;
  }
}

const Context = new ContextRegistry();

export default Context;
