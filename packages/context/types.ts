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

/**
 * Base shape for typed context contracts.
 *
 * This does not describe or restrict the ambient Context registry.
 * It exists as a common base for typed context views and services.
 */
export type ContextShape = object;

/**
 * String keys declared by a context shape.
 */
export type ContextKey<T extends object> = Extract<keyof T, string>;

/**
 * A typed view over the ambient Context registry.
 *
 * The view does not own or copy any values. It constrains access to
 * the keys and value types declared by T.
 */
export interface ContextView<T extends object> {
  /**
   * Returns whether a value exists for the given context key.
   */
  has<K extends ContextKey<T>>(key: K): boolean;

  /**
   * Gets a value from the context.
   *
   * Throws if the key is not registered.
   */
  get<K extends ContextKey<T>>(key: K): T[K];

  /**
   * Gets a value from the context if it exists.
   */
  tryGet<K extends ContextKey<T>>(key: K): T[K] | undefined;

  /**
   * Sets a value in the context.
   *
   * Returns whether the value was accepted.
   */
  set<K extends ContextKey<T>>(key: K, value: T[K]): boolean;

  /**
   * Removes a value from the context.
   */
  delete<K extends ContextKey<T>>(key: K): boolean;
}
