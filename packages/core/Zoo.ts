/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Router } from "@agent-zoo/api";
import { Service } from "@agent-zoo/service";
import { AgentActivationError } from "./Agent.ts";
import type { AgentConfig } from "./types.ts";
import type {
  AgentActivationOptions,
  AgentActivationResult,
  ZooActivityEvent,
  ZooAgentSnapshot,
  ZooAgentState,
  ZooSnapshot,
  ZooState,
} from "./types.ts";

export type RouterService = Service & { readonly router?: Router };

/** Structural actor boundary used by the real ZooAgent and deterministic tests. */
export interface ZooActor extends EventTarget {
  readonly id: string;
  readonly config: Readonly<AgentConfig>;
  prepare(): Promise<void>;
  activate(
    prompt: string,
    signal?: AbortSignal,
    options?: AgentActivationOptions,
  ): Promise<AgentActivationResult>;
  observeEnvironment(cwd?: string): Promise<string>;
  stop(): Promise<void>;
}

interface AgentRecord {
  actor: ZooActor;
  state: ZooAgentState;
  stateSince: number;
  currentActivity: string;
  activations: number;
  initialPrompt?: string;
  initialPending: boolean;
  recentActivity: ZooActivityEvent[];
  error?: string;
}

export interface AgentZooOptions {
  completionEnabled?: boolean;
  initialPrompts?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  random?: () => number;
  recentActivityLimit?: number;
  dispose?: () => Promise<void>;
}

/**
 * Persistent population runner, service host, scheduler, and observable state.
 * The standalone CLI is one consumer of this exported lifecycle API.
 */
export class AgentZoo extends EventTarget {
  readonly router = new Router();
  readonly #services = new Map<string, RouterService>();
  readonly #agents = new Map<string, AgentRecord>();
  readonly #clock: () => number;
  readonly #random: () => number;
  readonly #completionEnabled: boolean;
  readonly #initialPrompts: Readonly<Record<string, string | undefined>>;
  readonly #recentLimit: number;
  readonly #dispose?: () => Promise<void>;
  readonly #recentActivity: ZooActivityEvent[] = [];
  #state: ZooState = "created";
  #stateSince: number;
  #sequence = 0;
  #activeAgentId?: string;
  #lastAgentId?: string;
  #stopReason?: string;
  #abort?: AbortController;
  #loop?: Promise<void>;
  #shutdown = false;

  constructor(options: AgentZooOptions = {}) {
    super();
    this.#clock = options.clock ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#completionEnabled = options.completionEnabled ?? true;
    this.#initialPrompts = options.initialPrompts ?? {};
    this.#recentLimit = options.recentActivityLimit ?? 50;
    this.#dispose = options.dispose;
    this.#stateSince = this.#clock();
  }

  use(name: string, service: RouterService): this {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new TypeError(
        `Invalid service name "${name}"; use lowercase letters, digits, and hyphens`,
      );
    }
    if (this.#services.has(name)) {
      throw new Error(`A service named "${name}" is already registered`);
    }
    this.#services.set(name, service);
    if (service.router) this.router.use(`/services/${name}`, service.router);
    this.dispatchEvent(
      new CustomEvent("serviceadded", { detail: { name, service } }),
    );
    return this;
  }

  get(name: string): RouterService | undefined {
    return this.#services.get(name);
  }

  services(): readonly string[] {
    return [...this.#services.keys()];
  }

  registerAgent(actor: ZooActor): this {
    if (this.#state !== "created") {
      throw new Error("Cannot register agents after AgentZoo has started");
    }
    if (this.#agents.has(actor.id)) {
      throw new Error(`An agent named "${actor.id}" is already registered`);
    }
    const now = this.#clock();
    this.#agents.set(actor.id, {
      actor,
      state: "created",
      stateSince: now,
      currentActivity: "Awaiting startup",
      activations: 0,
      initialPrompt: this.#initialPrompts[actor.id],
      initialPending: true,
      recentActivity: [],
    });
    const label = actorLabel(actor);
    actor.addEventListener("toolstart", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const record = this.#agents.get(actor.id);
      if (record) record.currentActivity = `Using ${detail.toolName}`;
      this.record("agent:tool:start", `${label} called ${detail.toolName}`, {
        agentId: actor.id,
        toolName: detail.toolName,
        toolCallId: detail.toolCallId,
        detail: detail.args,
      });
    });
    actor.addEventListener("toolend", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const status = detail.status === "error" ? "failed" : "finished";
      this.record(
        "agent:tool:end",
        `${label} ${status} ${detail.toolName}`,
        {
          agentId: actor.id,
          toolName: detail.toolName,
          toolCallId: detail.toolCallId,
          detail,
        },
      );
    });
    actor.addEventListener("toolerror", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      this.record("agent:tool:error", `${label} ${detail.toolName} failed`, {
        agentId: actor.id,
        toolName: detail.toolName,
        toolCallId: detail.toolCallId,
        detail,
      });
    });
    actor.addEventListener("modelrequest", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const record = this.#agents.get(actor.id);
      if (record) record.currentActivity = "Requesting model turn";
      this.record("agent:model:request", `${label} requested a model turn`, {
        agentId: actor.id,
        detail,
      });
    });
    actor.addEventListener("modelresponse", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const record = this.#agents.get(actor.id);
      if (record) record.currentActivity = "Processing model response";
      this.record(
        "agent:model:response",
        `${label} received a model response`,
        {
          agentId: actor.id,
          detail,
        },
      );
    });
    actor.addEventListener("modelerror", (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      this.record("agent:model:error", `${label} model request failed`, {
        agentId: actor.id,
        detail,
      });
    });
    this.dispatchEvent(
      new CustomEvent("agentregistered", { detail: { agentId: actor.id } }),
    );
    return this;
  }

  getAgent(id: string): ZooActor | undefined {
    return this.#agents.get(id)?.actor;
  }

  agents(): readonly string[] {
    return [...this.#agents.keys()];
  }

  state(): ZooSnapshot {
    const now = this.#clock();
    return Object.freeze({
      state: this.#state,
      stateSince: this.#stateSince,
      activeAgentId: this.#activeAgentId,
      stopReason: this.#stopReason,
      agents: [...this.#agents.values()].map((record) =>
        this.snapshotAgent(record, now)
      ),
      recentActivity: [...this.#recentActivity],
    });
  }

  /** Prepare the population/services and launch the scheduling loop. */
  async start(): Promise<void> {
    if (this.#state === "running" || this.#state === "starting") return;
    if (this.#state !== "created") {
      throw new Error(`Cannot start AgentZoo from state ${this.#state}`);
    }
    if (!this.#agents.size) {
      throw new Error("AgentZoo has no configured agents");
    }
    this.setZooState("starting");
    this.#abort = new AbortController();
    try {
      for (const record of this.#agents.values()) {
        await record.actor.prepare();
        this.setAgentState(record, "ready", "Ready");
      }
      for (const service of this.#services.values()) await service.start();
      this.setZooState("running");
      this.record("zoo:start", `Zoo started with ${this.#agents.size} agents`);
      this.dispatchEvent(new Event("started"));
      this.#loop = this.runLoop();
    } catch (error) {
      this.setZooState("errored");
      this.dispatchEvent(
        new CustomEvent("error", { detail: { phase: "start", error } }),
      );
      await this.shutdown();
      throw error;
    }
  }

  /** Wait until completion, an external stop, or population exhaustion. */
  async wait(): Promise<void> {
    await this.#loop;
  }

  async run(): Promise<void> {
    await this.start();
    await this.wait();
  }

  /** Request a graceful public stop and wait for lifecycle cleanup. */
  async stop(reason = "external stop"): Promise<void> {
    if (this.#state === "stopped" || this.#state === "completed") return;
    this.#stopReason = reason;
    this.#abort?.abort(reason);
    if (this.#state === "created") {
      this.setZooState("stopping");
      await this.shutdown();
      this.setZooState("stopped");
      return;
    }
    if (this.#state !== "errored") this.setZooState("stopping");
    if (this.#loop) await this.#loop;
    else await this.shutdown();
  }

  private async runLoop(): Promise<void> {
    let completed = false;
    try {
      while (!this.#abort?.signal.aborted) {
        const record = this.selectAgent();
        if (!record) {
          if (this.isQuiescent()) {
            await this.waitForStop();
            continue;
          }
          const records = [...this.#agents.values()];
          completed = this.#completionEnabled && records.every((item) =>
            item.state === "completed" || item.state === "errored"
          ) && records.some((item) =>
            item.state === "completed"
          );
          this.#stopReason = completed
            ? "population completion"
            : "no runnable agents";
          break;
        }
        await this.activate(record);
      }
    } finally {
      this.#activeAgentId = undefined;
      await this.shutdown();
      if (completed) {
        this.setZooState("completed");
        this.record("zoo:complete", "All active agents agreed on completion");
      } else if (this.#state !== "errored") {
        this.setZooState("stopped");
        this.record(
          "zoo:stop",
          `Zoo stopped: ${this.#stopReason ?? "requested"}`,
        );
      }
      this.dispatchEvent(new Event("stopped"));
    }
  }

  private selectAgent(): AgentRecord | undefined {
    let candidates = [...this.#agents.values()].filter((record) =>
      record.state === "ready" || record.state === "idle"
    );
    if (this.#lastAgentId) {
      candidates = candidates.filter((record) =>
        record.actor.id !== this.#lastAgentId
      );
    }
    if (!candidates.length) return undefined;
    const sample = Math.min(Math.max(this.#random(), 0), 0.999999999);
    return candidates[Math.floor(sample * candidates.length)];
  }

  /** A yielded participant cannot wake itself without an intervening event. */
  private isQuiescent(): boolean {
    const runnable = [...this.#agents.values()].filter((record) =>
      record.state === "ready" || record.state === "idle"
    );
    return runnable.length === 1 &&
      runnable[0].actor.id === this.#lastAgentId;
  }

  private waitForStop(): Promise<void> {
    const signal = this.#abort?.signal;
    if (!signal || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  private async activate(record: AgentRecord): Promise<void> {
    const now = this.#clock();
    const idleMs = record.state === "idle"
      ? Math.max(0, now - record.stateSince)
      : 0;
    let prompt: string;
    let role: "user" | "system";
    let initialSystemContext: string | undefined;
    let appendPrompt = true;
    const label = actorLabel(record.actor);
    try {
      if (record.initialPending) {
        if (record.actor.config.features?.includes("shell")) {
          initialSystemContext = await record.actor.observeEnvironment(
            record.actor.config.cwd,
          );
        }
        prompt = record.initialPrompt ?? "";
        role = "user";
        appendPrompt = record.initialPrompt !== undefined;
        record.initialPending = false;
      } else {
        prompt = `Automated activity update: You have been idle for ${
          formatDuration(idleMs)
        }.`;
        role = "system";
      }
      record.activations++;
      this.#activeAgentId = record.actor.id;
      this.#lastAgentId = record.actor.id;
      this.setAgentState(record, "active", "Thinking");
      this.record(
        "agent:wake",
        `${label} woke after ${formatDuration(idleMs)}`,
        {
          agentId: record.actor.id,
          detail: {
            idleMs,
            prompt,
            role,
            initialSystemContext,
            appendPrompt,
          },
        },
      );
      const result = await record.actor.activate(prompt, this.#abort?.signal, {
        role,
        initialSystemContext,
        appendPrompt,
      });
      if (this.#abort?.signal.aborted) return;
      if (result.outcome === "complete" && this.#completionEnabled) {
        this.setAgentState(record, "completed", "Completion vote recorded");
        this.record("agent:complete", `${label} voted complete`, {
          agentId: record.actor.id,
          detail: {
            output: result.output,
            messages: result.messages,
            systemPrompt: result.systemPrompt,
            metadata: result.metadata,
          },
        });
      } else {
        this.setAgentState(
          record,
          "idle",
          result.outcome === "yield" ? "Yielded" : "Responded",
        );
        this.record(
          result.outcome === "yield" ? "agent:yield" : "agent:response",
          result.outcome === "yield"
            ? `${label} yielded`
            : `${label} ended its response without yielding`,
          {
            agentId: record.actor.id,
            detail: {
              output: result.output,
              messages: result.messages,
              systemPrompt: result.systemPrompt,
              metadata: result.metadata,
            },
          },
        );
      }
    } catch (error) {
      if (this.#abort?.signal.aborted) return;
      record.error = errorMessage(error);
      this.setAgentState(record, "errored", "Activation failed");
      this.record("agent:error", `${label}: ${record.error}`, {
        agentId: record.actor.id,
        detail: {
          error,
          activation: error instanceof AgentActivationError
            ? error.activation
            : undefined,
        },
      });
    } finally {
      this.#activeAgentId = undefined;
    }
  }

  private snapshotAgent(record: AgentRecord, now: number): ZooAgentSnapshot {
    const elapsed = Math.max(0, now - record.stateSince);
    return Object.freeze({
      id: record.actor.id,
      name: record.actor.config.name ?? record.actor.id,
      type: record.actor.config.type,
      model: record.actor.config.model,
      state: record.state,
      currentActivity: record.currentActivity,
      stateSince: record.stateSince,
      activeForMs: record.state === "active" ? elapsed : 0,
      idleForMs: record.state === "idle" ? elapsed : 0,
      activations: record.activations,
      recentActivity: [...record.recentActivity],
      error: record.error,
    });
  }

  private setAgentState(
    record: AgentRecord,
    state: ZooAgentState,
    activity: string,
  ): void {
    record.state = state;
    record.stateSince = this.#clock();
    record.currentActivity = activity;
    this.dispatchEvent(
      new CustomEvent("statechange", { detail: this.state() }),
    );
  }

  private setZooState(state: ZooState): void {
    this.#state = state;
    this.#stateSince = this.#clock();
    this.dispatchEvent(
      new CustomEvent("statechange", { detail: this.state() }),
    );
  }

  private record(
    kind: ZooActivityEvent["kind"],
    message: string,
    extra: Partial<
      Omit<ZooActivityEvent, "sequence" | "at" | "kind" | "message">
    > = {},
  ): void {
    const agentName = extra.agentId
      ? this.#agents.get(extra.agentId)?.actor.config.name
      : undefined;
    const event: ZooActivityEvent = Object.freeze({
      sequence: ++this.#sequence,
      at: this.#clock(),
      kind,
      message,
      ...extra,
      ...(agentName ? { agentName } : {}),
    });
    this.#recentActivity.push(event);
    if (this.#recentActivity.length > this.#recentLimit) {
      this.#recentActivity.shift();
    }
    if (event.agentId) {
      const activity = this.#agents.get(event.agentId)?.recentActivity;
      activity?.push(event);
      if (activity && activity.length > this.#recentLimit) activity.shift();
    }
    this.dispatchEvent(new CustomEvent("activity", { detail: event }));
    this.dispatchEvent(new CustomEvent(kind, { detail: event }));
  }

  private async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    const errors: unknown[] = [];
    for (const service of [...this.#services.values()].reverse()) {
      try {
        await service.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const record of [...this.#agents.values()].reverse()) {
      try {
        await record.actor.stop();
      } catch (error) {
        errors.push(error);
      } finally {
        if (record.state !== "completed" && record.state !== "errored") {
          this.setAgentState(record, "stopped", "Stopped");
        }
      }
    }
    try {
      await this.#dispose?.();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      throw new AggregateError(errors, "AgentZoo shutdown failed");
    }
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.floor(milliseconds)} milliseconds`;
  if (milliseconds < 60_000) {
    return `${Math.floor(milliseconds / 1_000)} seconds`;
  }
  if (milliseconds < 3_600_000) {
    return `${Math.floor(milliseconds / 60_000)} minutes`;
  }
  return `${Math.floor(milliseconds / 3_600_000)} hours`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function actorLabel(actor: ZooActor): string {
  return actor.config.name ? `${actor.config.name} (${actor.id})` : actor.id;
}
