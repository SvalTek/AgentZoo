import type { Memory, MemoryStore } from "./types.ts";

/**
 * In-memory MemoryStore implementation. State is lost when the process exits.
 * Pass a custom `MemoryStore` to `MemoryToolset` for persistent storage.
 */
export class InMemoryStore implements MemoryStore {
  private readonly memories: Map<string, Memory> = new Map();

  save(key: string, content: string, tags: string[] = []): Promise<Memory> {
    const existing = this.memories.get(key);
    const now = new Date();
    const memory: Memory = {
      key,
      content,
      tags,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.memories.set(key, memory);
    return Promise.resolve(memory);
  }

  recall(key: string): Promise<Memory | null> {
    return Promise.resolve(this.memories.get(key) ?? null);
  }

  search(query: string): Promise<Memory[]> {
    const lower = query.toLowerCase();
    const results = Array.from(this.memories.values()).filter((m) =>
      m.key.toLowerCase().includes(lower) ||
      m.content.toLowerCase().includes(lower) ||
      m.tags.some((t) => t.toLowerCase().includes(lower))
    );
    return Promise.resolve(results);
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.memories.delete(key));
  }

  list(): Promise<Array<{ key: string; tags: string[] }>> {
    const entries = Array.from(this.memories.values()).map(({ key, tags }) => ({ key, tags }));
    return Promise.resolve(entries);
  }
}

// denoCacheMetadata={"headers":{"x-content-type-options":"nosniff","alt-svc":"h3=\":443\"; ma=86400","date":"Thu, 11 Jun 2026 13:33:22 GMT","content-length":"1468","cf-ray":"a0a0fcb8681b31aa-LHR","cross-origin-resource-policy":"cross-origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","cache-control":"public, max-age=31536000, immutable","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=4elLwy8sVfXHgoDUE0gwjdzxU70H4UnX6A2KbVTgIPGfBeU1rIzPs86KUr7idYIrV44AxZp4QXnZOqiECPlQfKNPfP8V4xCLAAWAl1j%2BudJ2hxKZZObQuAc%3D\"}]}","etag":"\"4fb58f3de829bab33efde15c4b476de7\"","access-control-allow-origin":"*","vary":"Origin","access-control-expose-headers":"*","content-type":"text/typescript","content-encoding":"identity","x-jsr-backend":"modules","x-robots-tag":"noindex","server":"cloudflare"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/memory/in_memory_store.ts","time":1781184802}