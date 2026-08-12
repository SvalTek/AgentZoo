import type { Todo, TodoStatus, TodoStore } from "./types.ts";

/**
 * In-memory TodoStore implementation. State is lost when the process exits.
 * Pass a custom `TodoStore` to `TodoToolset` for persistent storage.
 */
export class MemoryTodoStore implements TodoStore {
  private readonly todos: Map<string, Todo> = new Map();
  private nextId = 1;

  add(todo: Omit<Todo, "id" | "createdAt" | "updatedAt">): Promise<Todo> {
    const now = new Date();
    const newTodo: Todo = {
      ...todo,
      id: String(this.nextId++),
      createdAt: now,
      updatedAt: now,
    };
    this.todos.set(newTodo.id, newTodo);
    return Promise.resolve(newTodo);
  }

  list(filter?: { status?: TodoStatus }): Promise<Todo[]> {
    const all = Array.from(this.todos.values());
    if (!filter?.status) return Promise.resolve(all);
    return Promise.resolve(all.filter((t) => t.status === filter.status));
  }

  update(id: string, status: TodoStatus): Promise<Todo> {
    const todo = this.todos.get(id);
    if (!todo) return Promise.reject(new Error(`Todo not found: ${id}`));
    const updated: Todo = { ...todo, status, updatedAt: new Date() };
    this.todos.set(id, updated);
    return Promise.resolve(updated);
  }

  clear(): Promise<void> {
    for (const [id, todo] of this.todos) {
      if (todo.status === "done" || todo.status === "cancelled") {
        this.todos.delete(id);
      }
    }
    return Promise.resolve();
  }
}

// denoCacheMetadata={"headers":{"content-length":"1439","x-content-type-options":"nosniff","etag":"\"eeb72a4208d2339b49c716dd6e378c99\"","x-jsr-backend":"modules","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","date":"Thu, 11 Jun 2026 13:33:23 GMT","access-control-expose-headers":"*","access-control-allow-origin":"*","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=HBUVJD4DAuJNQFW7b6AcKp4jBn%2BOtJYe7jL2eIF1EEqdixhoQfCBWfAPsNhP0kFOlo5cI3jGh0zm2sOn0g27PvPow2I8Hysq0LS9CcmOecjwYr4NGoL9vc0%3D\"}]}","content-encoding":"identity","alt-svc":"h3=\":443\"; ma=86400","cache-control":"public, max-age=31536000, immutable","content-type":"text/typescript","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cross-origin-resource-policy":"cross-origin","vary":"Origin","x-robots-tag":"noindex","server":"cloudflare","cf-ray":"a0a0fcb8680b31aa-LHR"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/todo/memory_todo_store.ts","time":1781184802}