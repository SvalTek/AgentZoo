/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  FilteredToolset,
  type MCPClient,
  type MCPReadResourceResult,
  type MCPResource,
  type MCPResourceTemplate,
  type MCPTool,
  PrefixedToolset,
  type Toolset,
} from "@vibesjs/sdk";
import { z } from "zod";
import {
  type AgentRunDeps,
  AgentZoo,
  createMCPListToolsTool,
  createMCPResourceTools,
  MCPPool,
  MCPServerUnavailableError,
  mcpToolPrefix,
  ObservedToolset,
  OptionalMCPToolset,
  parseConfig,
  substituteSharedPathTokens,
} from "../mod.ts";
import { MCPNamedToolset } from "../mcp/NamedToolset.ts";
import type { ZooActor } from "../Zoo.ts";
import type { AgentActivationResult, AgentConfig } from "../types.ts";

class FakeMCPClient implements MCPClient {
  connects = 0;
  disconnects = 0;
  readonly readUris: string[] = [];

  constructor(
    readonly tools: MCPTool[] = [{
      name: "search",
      description: "Search the server.",
      inputSchema: { type: "object" },
    }],
    readonly connectError?: Error,
    readonly resourcesEnabled = true,
  ) {}

  connect(): Promise<void> {
    this.connects++;
    return this.connectError
      ? Promise.reject(this.connectError)
      : Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnects++;
    return Promise.resolve();
  }

  listTools(): Promise<MCPTool[]> {
    return Promise.resolve(this.tools);
  }

  listResources(): Promise<MCPResource[]> {
    return Promise.resolve([{
      uri: "agent-chat://inbox",
      name: "Inbox",
      description: "Messages delivered to this agent.",
      mimeType: "text/markdown",
    }]);
  }

  listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    return Promise.resolve([{
      uriTemplate: "agent-chat://thread/{threadId}",
      name: "Thread",
      description: "Read a messageboard thread.",
    }]);
  }

  readResource(uri: string): Promise<MCPReadResourceResult> {
    this.readUris.push(uri);
    return Promise.resolve({
      contents: [{
        uri,
        mimeType: "text/markdown",
        text: `Contents for ${uri}.`,
      }],
    });
  }

  supportsResources(): boolean {
    return this.resourcesEnabled;
  }

  callTool(name: string, args: Record<string, unknown>) {
    return Promise.resolve({
      content: [{ type: "text" as const, text: `${name}:${args["query"]}` }],
    });
  }

  getServerInstructions(): string | undefined {
    return undefined;
  }
}

class CompletingActor extends EventTarget implements ZooActor {
  readonly config: Readonly<AgentConfig> = { id: "agent", model: "test" };
  readonly id = "agent";

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  activate(): Promise<AgentActivationResult> {
    return Promise.resolve({ outcome: "complete" });
  }

  observeEnvironment(): Promise<string> {
    return Promise.resolve("/root");
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

const configSource = `
mcp:
  - name: github
    description: Work with GitHub.
    type: stdio
    command: npx
    args: ["-y", "server", "{shared.host}"]
    env: { TOKEN: "\${GITHUB_TOKEN}" }
agents:
  - type: coder
    model: test
    mcp: [github]
`;

Deno.test("MCP config validates selection and resolves transport environment", () => {
  const config = parseConfig(
    configSource,
    (name) => name === "GITHUB_TOKEN" ? "secret" : undefined,
  );
  const server = config.mcp[0];
  assertEquals(server.type, "stdio");
  if (server.type !== "stdio") throw new Error("Expected stdio MCP config");
  assertEquals(server.env, { TOKEN: "secret" });
  assertEquals(server.description, "Work with GitHub.");
  assertEquals(config.agents[0].mcp, ["github"]);

  assertThrows(
    () =>
      parseConfig(configSource.replace("mcp: [github]", 'mcp: ["*", github]')),
    Error,
    'Use "*" alone',
  );
  assertThrows(
    () =>
      parseConfig(`
mcp:
  - name: github
    description: First server.
    type: stdio
    command: one
  - name: github
    description: Second server.
    type: stdio
    command: two
agents:
  - type: coder
    model: test
`),
    Error,
    "already configured",
  );
  assertThrows(
    () => parseConfig(configSource, () => undefined),
    Error,
    'Environment variable "GITHUB_TOKEN"',
  );
});

Deno.test("MCP http endpoints expand environment variables before validation", () => {
  const source = `
mcp:
  - name: docs
    description: Read documentation.
    type: http
    url: "\${MCP_ENDPOINT}"
agents:
  - type: coder
    model: test
`;
  const config = parseConfig(
    source,
    (name) =>
      name === "MCP_ENDPOINT" ? "https://mcp.example.test/stream" : undefined,
  );
  const server = config.mcp[0];
  if (server.type !== "http") throw new Error("Expected http MCP config");
  assertEquals(server.url, "https://mcp.example.test/stream");

  assertThrows(
    () =>
      parseConfig(
        source,
        (name) => name === "MCP_ENDPOINT" ? "not a URL" : undefined,
      ),
    Error,
    "/mcp/0/url: Invalid URL",
  );
  assertThrows(
    () => parseConfig(source, () => undefined),
    Error,
    'Environment variable "MCP_ENDPOINT"',
  );
});

Deno.test("MCP shared path tokens are explicit", () => {
  const resolved = substituteSharedPathTokens({
    name: "shared",
    description: "Use the shared workspace.",
    type: "stdio",
    command: "npx",
    args: ["{shared.host}", "{shared.agent}", "/shared"],
  }, "E:/shared");
  if (resolved.type !== "stdio") throw new Error("Expected stdio MCP config");
  assertEquals(resolved.args, ["E:/shared", "/shared", "/shared"]);
  assertEquals(mcpToolPrefix("issue-tracker"), "mcp_issue_tracker_");
});

Deno.test("MCP pool selects only configured names", () => {
  const pool = new MCPPool(
    [
      {
        name: "good",
        description: "A usable server.",
        type: "stdio",
        command: "good",
        args: [],
      },
      {
        name: "bad",
        description: "An unavailable server.",
        type: "stdio",
        command: "bad",
        args: [],
      },
    ],
    "E:/shared",
    {
      clientFactory: (config) => {
        return new FakeMCPClient(
          [],
          config.name === "bad" ? new Error("nope") : undefined,
        );
      },
    },
  );
  assertEquals(pool.select("agent", ["good"]).map((server) => server.name), [
    "good",
  ]);
  assertEquals(
    pool.select("agent", ["good"])[0].description,
    "A usable server.",
  );
  assertThrows(
    () => pool.select("agent", ["missing"]),
    Error,
    "unknown MCP server",
  );
});

Deno.test("MCP connection is lazy until selected tools are discovered", async () => {
  const client = new FakeMCPClient();
  const pool = new MCPPool(
    [{
      name: "docs",
      description: "Look up documentation.",
      type: "stdio",
      command: "docs",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  );
  const [server] = pool.select("agent", ["docs"]);
  assertEquals(client.connects, 0);
  assertEquals(
    (await server.toolset.tools({} as never)).map((tool) => tool.name),
    ["search"],
  );
  assertEquals(client.connects, 1);
});

Deno.test("list_tools loads one MCP toolset for the next model turn", async () => {
  const client = new FakeMCPClient();
  const [server] = new MCPPool(
    [{
      name: "chatroom",
      description: "Talk with other agents.",
      type: "stdio",
      command: "chatroom",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  ).select("agent", ["chatroom"]);
  const context = {
    deps: { control: {} },
  } as import("@vibesjs/sdk").RunContext<AgentRunDeps>;
  const gated = new PrefixedToolset(
    new FilteredToolset(
      server.toolset,
      (ctx) => ctx.deps.control.enabledMcpServers?.has(server.name) ?? false,
    ),
    mcpToolPrefix(server.name),
  );

  assertEquals(await gated.tools(context), []);
  assertEquals(client.connects, 0);

  const listTools = createMCPListToolsTool([server]);
  const result = await listTools.execute(context, {
    mcp_name: "chatroom",
  } as never);
  assertEquals(JSON.parse(String(result)), [{
    name: "mcp_chatroom_search",
    description: "Search the server.",
    inputSchema: { type: "object" },
  }]);
  assertEquals(client.connects, 1);
  assertEquals((await gated.tools(context)).map((tool) => tool.name), [
    "mcp_chatroom_search",
  ]);

  await assertRejects(
    () => listTools.execute(context, { mcp_name: "unassigned" } as never),
    Error,
    "not available to this agent",
  );
});

Deno.test("MCP resource builtins list resources and read exact URIs", async () => {
  const client = new FakeMCPClient();
  const [server] = new MCPPool(
    [{
      name: "chatroom",
      description: "Talk with other agents.",
      type: "stdio",
      command: "chatroom",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  ).select("agent", ["chatroom"]);
  const [listResources, readResource] = createMCPResourceTools([server]);
  const context = {
    deps: { control: {} },
  } as import("@vibesjs/sdk").RunContext<AgentRunDeps>;

  const listing = await listResources.execute(context, {
    mcp_name: "chatroom",
  } as never);
  assertEquals(JSON.parse(String(listing)), {
    resources: [{
      uri: "agent-chat://inbox",
      name: "Inbox",
      description: "Messages delivered to this agent.",
      mimeType: "text/markdown",
    }],
    resourceTemplates: [{
      uriTemplate: "agent-chat://thread/{threadId}",
      name: "Thread",
      description: "Read a messageboard thread.",
    }],
  });
  const contents = await readResource.execute(context, {
    mcp_name: "chatroom",
    uri: "agent-chat://inbox",
  } as never);
  assertEquals(JSON.parse(String(contents)), {
    contents: [{
      uri: "agent-chat://inbox",
      mimeType: "text/markdown",
      text: "Contents for agent-chat://inbox.",
    }],
  });
  const templatedContents = await readResource.execute(context, {
    mcp_name: "chatroom",
    uri: "agent-chat://feed?limit=10",
  } as never);
  assertEquals(JSON.parse(String(templatedContents)), {
    contents: [{
      uri: "agent-chat://feed?limit=10",
      mimeType: "text/markdown",
      text: "Contents for agent-chat://feed?limit=10.",
    }],
  });
  assertEquals(client.readUris, [
    "agent-chat://inbox",
    "agent-chat://feed?limit=10",
  ]);
  assertEquals(client.connects, 1);

  const unsupportedClient = new FakeMCPClient([], undefined, false);
  const [unsupportedServer] = new MCPPool(
    [{
      name: "no-resources",
      description: "Tools only.",
      type: "stdio",
      command: "no-resources",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => unsupportedClient },
  ).select("agent", ["no-resources"]);
  const [unsupportedList] = createMCPResourceTools([unsupportedServer]);
  await assertRejects(
    () =>
      unsupportedList.execute(context, {
        mcp_name: "no-resources",
      } as never),
    Error,
    "does not provide resources",
  );
});

Deno.test("prefixed MCP tools coexist and observed MCP calls retain telemetry", async () => {
  const inner: Toolset<AgentRunDeps> = {
    tools: () =>
      Promise.resolve([{
        name: "search",
        description: "Search.",
        parameters: z.object({ query: z.string() }),
        execute: () => Promise.resolve("answer"),
      }]),
  };
  const calls: string[] = [];
  const observed = new ObservedToolset(
    new PrefixedToolset(inner, "mcp_github_"),
    ["search"],
    async (name, args, execute) => {
      calls.push(`${name}:${args.query}`);
      return await execute();
    },
  );
  const tools = await observed.tools({} as never);
  assertEquals(tools.map((tool) => tool.name), ["mcp_github_search"]);
  assertEquals(
    await tools[0].execute({} as never, { query: "cats" }),
    "answer",
  );
  assertEquals(calls, ["mcp_github_search:cats"]);

  const collision = new ObservedToolset(
    inner,
    ["search"],
    async (_name, _args, execute) => await execute(),
  );
  await assertRejects(
    () => collision.tools({} as never),
    Error,
    "collides with an AgentZoo tool",
  );
});

Deno.test("optional MCP toolsets warn and omit only an unavailable server", async () => {
  const usable: Toolset<AgentRunDeps> = {
    tools: () =>
      Promise.resolve([{
        name: "mcp_docs_search",
        description: "Search.",
        parameters: z.object({}),
        execute: () => Promise.resolve("ok"),
      }]),
  };
  const warnings: string[] = [];
  const optional = new OptionalMCPToolset([
    {
      name: "offline",
      toolset: {
        tools: () =>
          Promise.reject(
            new MCPServerUnavailableError("offline", new Error("offline")),
          ),
      },
    },
    { name: "docs", toolset: usable },
  ], (name) => warnings.push(name));
  assertEquals((await optional.tools({} as never)).map((tool) => tool.name), [
    "mcp_docs_search",
  ]);
  assertEquals(warnings, ["offline"]);
});

Deno.test("Zoo does not pre-connect MCP servers and disconnects on shutdown", async () => {
  let disconnects = 0;
  const zoo = new AgentZoo({
    mcpPool: {
      disconnectAll: () => {
        disconnects++;
        return Promise.resolve();
      },
    },
  });
  zoo.registerAgent(new CompletingActor());
  await zoo.run();
  assertEquals(disconnects, 1);
});

Deno.test("MCP tool names are sanitized into unique provider-safe identifiers", async () => {
  const client = new FakeMCPClient([
    {
      name: "get.issue",
      description: "Fetch one issue.",
      inputSchema: { type: "object" },
    },
    {
      name: "get issue",
      description: "Fetch another issue.",
      inputSchema: { type: "object" },
    },
  ]);
  const [server] = new MCPPool(
    [{
      name: "issue-tracker",
      description: "Track issues.",
      type: "stdio",
      command: "tracker",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  ).select("agent", ["issue-tracker"]);
  const context = {
    deps: { control: {} },
  } as import("@vibesjs/sdk").RunContext<AgentRunDeps>;
  const listing = JSON.parse(
    String(await createMCPListToolsTool([server]).execute(context, {
      mcp_name: "issue-tracker",
    } as never)),
  ) as Array<{ name: string; inputSchema: unknown }>;
  const listedNames = listing.map((tool) => tool.name);
  assertEquals(new Set(listedNames).size, 2);
  for (const name of listedNames) {
    assert(/^mcp_issue_tracker_get_issue_[0-9a-f]{8}$/.test(name), name);
  }
  assertEquals(listing[0].inputSchema, { type: "object" });
  assertEquals(
    (await new MCPNamedToolset(server.toolset, "issue-tracker").tools(
      context,
    )).map((tool) => tool.name),
    listedNames,
  );
});

Deno.test("MCP resource rejection surfaces the server error, not an outage", async () => {
  const client = new FakeMCPClient();
  client.readResource = () =>
    Promise.reject(
      Object.assign(new Error("Resource not found"), { code: -32602 }),
    );
  const [server] = new MCPPool(
    [{
      name: "chatroom",
      description: "Talk with other agents.",
      type: "stdio",
      command: "chatroom",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  ).select("agent", ["chatroom"]);
  const context = {
    deps: { control: {} },
  } as import("@vibesjs/sdk").RunContext<AgentRunDeps>;
  const readResource = createMCPResourceTools([server]).find((tool) =>
    tool.name === "read_resource"
  )!;
  const failure = await assertRejects(
    () =>
      readResource.execute(context, {
        mcp_name: "chatroom",
        uri: "agent-chat://missing",
      } as never),
    Error,
    "rejected the resource request",
  );
  assert(failure.message.includes("Resource not found"));
  assertEquals(client.connects, 1);
  assertEquals(client.disconnects, 0);
});

Deno.test("MCP transport error codes still trigger reconnection", async () => {
  const client = new FakeMCPClient();
  client.readResource = () =>
    Promise.reject(
      Object.assign(new Error("Connection closed"), { code: -32000 }),
    );
  const [server] = new MCPPool(
    [{
      name: "chatroom",
      description: "Talk with other agents.",
      type: "stdio",
      command: "chatroom",
      args: [],
    }],
    "E:/shared",
    { clientFactory: () => client },
  ).select("agent", ["chatroom"]);
  const context = {
    deps: { control: {} },
  } as import("@vibesjs/sdk").RunContext<AgentRunDeps>;
  // Reach the ready state so recovery has a connection to reset.
  await server.resources.listResources();
  const readResource = createMCPResourceTools([server]).find((tool) =>
    tool.name === "read_resource"
  )!;
  await assertRejects(
    () =>
      readResource.execute(context, {
        mcp_name: "chatroom",
        uri: "agent-chat://inbox",
      } as never),
    Error,
    "currently unavailable",
  );
  assertEquals(client.connects, 2);
  assert(client.disconnects >= 1);
});
