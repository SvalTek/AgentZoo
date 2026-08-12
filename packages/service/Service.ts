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

// packages/service/src/Service.ts

import Context from "@agent-zoo/context";
import type { ContextView } from "@agent-zoo/context/types";
import type {
  ServiceContext,
  ServiceErrorDetail,
  ServiceState,
  ServiceStateChangeDetail,
} from "./types.ts";

export abstract class Service<
  TContext extends ServiceContext = ServiceContext,
> extends EventTarget {
  protected readonly context: ContextView<TContext>;

  private currentState: ServiceState = "created";

  private initializePromise?: Promise<void>;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  private abortController?: AbortController;

  protected constructor() {
    super();

    this.context = Context.view<TContext>();
  }

  get state(): ServiceState {
    return this.currentState;
  }

  get initialized(): boolean {
    return (
      this.currentState === "initialized" ||
      this.currentState === "starting" ||
      this.currentState === "started" ||
      this.currentState === "stopping" ||
      this.currentState === "stopped"
    );
  }

  get started(): boolean {
    return this.currentState === "started";
  }

  protected get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.runInitialize();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = undefined;
    }
  }

  async start(): Promise<void> {
    if (this.currentState === "started") {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.stopPromise) {
      await this.stopPromise;
    }

    this.startPromise = this.runStart();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    if (this.startPromise) {
      await this.startPromise;
    }

    if (this.currentState !== "started") {
      return;
    }

    this.stopPromise = this.runStop();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  private runInitialize(): Promise<void> {
    this.setState("initializing");
    this.dispatchEvent(new Event("initialize"));

    try {
      this.setState("initialized");
      this.dispatchEvent(new Event("initialized"));
      return Promise.resolve();
    } catch (error) {
      this.fail("initialize", error);
      throw error;
    }
  }

  private async runStart(): Promise<void> {
    await this.initialize();

    this.setState("starting");
    this.dispatchEvent(new Event("start"));

    try {
      this.abortController = new AbortController();

      this.setState("started");
      this.dispatchEvent(new Event("started"));
    } catch (error) {
      this.abortController?.abort(error);
      this.abortController = undefined;

      this.fail("start", error);
      throw error;
    }
  }

  private runStop(): Promise<void> {
    this.setState("stopping");
    this.dispatchEvent(new Event("stop"));

    try {
      this.abortController?.abort();
      this.abortController = undefined;

      this.setState("stopped");
      this.dispatchEvent(new Event("stopped"));
      return Promise.resolve();
    } catch (error) {
      this.fail("stop", error);
      throw error;
    }
  }

  private setState(state: ServiceState): void {
    if (state === this.currentState) {
      return;
    }

    const previous = this.currentState;
    this.currentState = state;

    this.dispatchEvent(
      new CustomEvent<ServiceStateChangeDetail>("statechange", {
        detail: {
          previous,
          current: state,
        },
      }),
    );
  }

  private fail(
    phase: ServiceErrorDetail["phase"],
    error: unknown,
  ): void {
    this.setState("failed");

    this.dispatchEvent(
      new CustomEvent<ServiceErrorDetail>("error", {
        detail: {
          phase,
          error,
        },
      }),
    );
  }
}
