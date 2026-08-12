export type TodoStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Todo {
  id: string;
  title: string;
  status: TodoStatus;
  parentId?: string;
  dependsOn: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TodoStore {
  add(todo: Omit<Todo, "id" | "createdAt" | "updatedAt">): Promise<Todo>;
  list(filter?: { status?: TodoStatus }): Promise<Todo[]>;
  update(id: string, status: TodoStatus): Promise<Todo>;
  /** Remove all todos with status "done" or "cancelled". */
  clear(): Promise<void>;
}

// denoCacheMetadata={"headers":{"cf-ray":"a0a0fcb8680d31aa-LHR","x-content-type-options":"nosniff","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","access-control-allow-origin":"*","content-type":"text/typescript","access-control-expose-headers":"*","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","x-robots-tag":"noindex","alt-svc":"h3=\":443\"; ma=86400","vary":"Origin","content-length":"546","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=D40dv02Jvxx0ube0jle9OwjLq0IZ6oSlNonG1X%2FDK9NiaIq5sMt9nNmPlQGYZu%2BSgfGqwuSQOpc0ItXn0FRxeZ%2FFjFLfl%2FyuQDKVk81NsBipcF7luj86FQw%3D\"}]}","cross-origin-resource-policy":"cross-origin","etag":"\"33b41755bd48d5ab89ebef27a5fb92fd\"","server":"cloudflare","date":"Thu, 11 Jun 2026 13:33:23 GMT","cache-control":"public, max-age=31536000, immutable"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/todo/types.ts","time":1781184802}