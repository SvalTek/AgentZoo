/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { basename, dirname, join } from "@std/path";
import type {
  AgentZoo,
  ModelRegistry,
  ZooActivityEvent,
} from "@agent-zoo/core";

/** Append-only, full-fidelity JSONL telemetry for one standalone run. */
export class ActivityLog {
  readonly path: string;
  readonly #zoo: AgentZoo;
  readonly #models: ModelRegistry;
  readonly #file: Deno.FsFile;
  readonly #listener: EventListener;
  #pending = Promise.resolve();
  #failure?: unknown;
  #closed = false;

  private constructor(
    path: string,
    zoo: AgentZoo,
    models: ModelRegistry,
    file: Deno.FsFile,
    configPath: string,
  ) {
    this.path = path;
    this.#zoo = zoo;
    this.#models = models;
    this.#file = file;
    this.#listener = ((rawEvent: Event) => {
      this.record((rawEvent as CustomEvent<ZooActivityEvent>).detail);
    }) as EventListener;
    zoo.addEventListener("activity", this.#listener);
    this.append({
      timestamp: new Date().toISOString(),
      kind: "session:start",
      configPath,
      logPath: path,
    });
  }

  static async create(
    zoo: AgentZoo,
    models: ModelRegistry,
    configPath: string,
    now = new Date(),
  ): Promise<ActivityLog> {
    const timestamp = now.toISOString().replaceAll(/[-:]/g, "");
    const path = join(
      dirname(configPath),
      `agent-zoo-${timestamp}.jsonl`,
    );
    const file = await Deno.open(path, {
      createNew: true,
      write: true,
    });
    return new ActivityLog(path, zoo, models, file, configPath);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#zoo.removeEventListener("activity", this.#listener);
    const snapshot = this.#zoo.state();
    this.append({
      timestamp: new Date().toISOString(),
      kind: "session:end",
      state: snapshot.state,
      stopReason: snapshot.stopReason,
      agents: snapshot.agents.map((agent) => ({
        id: agent.id,
        name: agent.name === agent.id ? undefined : agent.name,
        modelKey: agent.model,
        state: agent.state,
        activations: agent.activations,
        error: agent.error,
      })),
    });
    await this.#pending;
    this.#file.close();
    if (this.#failure) {
      throw new Error(`Could not write activity log ${this.path}`, {
        cause: this.#failure,
      });
    }
  }

  private record(event: ZooActivityEvent): void {
    const actor = event.agentId ? this.#zoo.getAgent(event.agentId) : undefined;
    const modelKey = actor?.config.model;
    const model = modelKey ? this.#models.get(modelKey) : undefined;
    this.append({
      timestamp: new Date(event.at).toISOString(),
      sequence: event.sequence,
      kind: event.kind,
      agentId: event.agentId,
      agentName: event.agentName ?? actor?.config.name,
      modelKey,
      modelName: model?.model,
      provider: model?.provider,
      message: event.message,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      detail: event.detail,
    });
  }

  private append(record: unknown): void {
    const line = new TextEncoder().encode(`${safeStringify(record)}\n`);
    this.#pending = this.#pending.then(async () => {
      let offset = 0;
      while (offset < line.length) {
        const written = await this.#file.write(line.subarray(offset));
        if (written === 0) {
          throw new Error("Activity log write made no progress");
        }
        offset += written;
      }
    }).catch((error) => {
      this.#failure ??= error;
    });
  }
}

export function activityLogName(path: string): string {
  return basename(path);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Error) {
      return { name: item.name, message: item.message, stack: item.stack };
    }
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  });
}
