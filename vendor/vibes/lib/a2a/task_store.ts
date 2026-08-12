import type { A2AArtifact, A2AMessage, A2ATask, A2ATaskStatus } from "./types.ts";

export interface TaskStore {
  create(id: string, contextId: string, message: A2AMessage): A2ATask;
  get(id: string): A2ATask | undefined;
  update(
    id: string,
    status: A2ATaskStatus,
    options?: {
      newMessages?: A2AMessage[];
      newArtifacts?: A2AArtifact[];
    },
  ): A2ATask;
  delete(id: string): void;
}

/** In-memory implementation of {@link TaskStore} for development and testing. */
export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, A2ATask>();

  create(id: string, contextId: string, message: A2AMessage): A2ATask {
    const task: A2ATask = {
      kind: "task",
      id,
      contextId,
      status: {
        state: "submitted",
        timestamp: new Date().toISOString(),
      },
      history: [message],
      artifacts: [],
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): A2ATask | undefined {
    return this.tasks.get(id);
  }

  update(
    id: string,
    status: A2ATaskStatus,
    options?: {
      newMessages?: A2AMessage[];
      newArtifacts?: A2AArtifact[];
    },
  ): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const updated: A2ATask = {
      ...task,
      status,
      history: options?.newMessages
        ? [...(task.history ?? []), ...options.newMessages]
        : task.history,
      artifacts: options?.newArtifacts
        ? [...(task.artifacts ?? []), ...options.newArtifacts]
        : task.artifacts,
    };
    this.tasks.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    this.tasks.delete(id);
  }
}

// denoCacheMetadata={"headers":{"server":"cloudflare","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","x-content-type-options":"nosniff","cache-control":"public, max-age=31536000, immutable","content-type":"text/typescript","etag":"\"be195cbd2bd5907d2de00e3224884f6a\"","vary":"Origin","x-jsr-backend":"modules","x-robots-tag":"noindex","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=PVD5UqYcd01GHjsHACqKvTpJTiBg6yBGX2u%2B2b3dP1jKVbrN%2FUH1FotgPN%2F9MvPskfefc3F9LKCP4EIxbBZ2in1K4CV29Jocvvm6OWBt0FFADOmBm%2B%2BnSS4%3D\"}]}","date":"Thu, 11 Jun 2026 13:33:22 GMT","cross-origin-resource-policy":"cross-origin","alt-svc":"h3=\":443\"; ma=86400","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cf-ray":"a0a0fcb86f9931aa-LHR","access-control-allow-origin":"*","content-length":"1723","content-encoding":"identity","access-control-expose-headers":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/a2a/task_store.ts","time":1781184802}