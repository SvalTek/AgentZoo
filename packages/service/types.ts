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

// packages/service/src/types.ts

import type { ContextShape } from "@agent-zoo/context/types";

export interface ServiceContext extends ContextShape {}

/**
 * Current lifecycle state of a service.
 */
export type ServiceState =
  | "created"
  | "initializing"
  | "initialized"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "failed";

export interface ServiceStateChangeDetail {
  previous: ServiceState;
  current: ServiceState;
}

export interface ServiceErrorDetail {
  phase: "initialize" | "start" | "stop";
  error: unknown;
}
