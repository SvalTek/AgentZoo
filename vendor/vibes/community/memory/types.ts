export interface Memory {
  key: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryStore {
  save(key: string, content: string, tags?: string[]): Promise<Memory>;
  recall(key: string): Promise<Memory | null>;
  search(query: string): Promise<Memory[]>;
  delete(key: string): Promise<boolean>;
  list(): Promise<Array<{ key: string; tags: string[] }>>;
}

// denoCacheMetadata={"headers":{"cache-control":"public, max-age=31536000, immutable","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","alt-svc":"h3=\":443\"; ma=86400","content-length":"415","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=vAZ3ZFiJEsYY0SneVYeciyXHU4eMNaKf7FOV%2FHvooUTX6%2BMc8V8ujS6PxrfFH%2FvSSshMUpfU9v7f6TK02g9gnIPyCTxefkMB02%2FbOLkPmfTKSg5TxHvTXCU%3D\"}]}","etag":"\"92fada10b6689922484770b00ea14389\"","content-type":"text/typescript","access-control-allow-origin":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","x-robots-tag":"noindex","cf-ray":"a0a0fcb8681e31aa-LHR","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-encoding":"identity","access-control-expose-headers":"*","cross-origin-resource-policy":"cross-origin","vary":"Origin","server":"cloudflare","x-content-type-options":"nosniff"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/memory/types.ts","time":1781184802}