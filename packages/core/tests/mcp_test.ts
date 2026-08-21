/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type MCPClient,
  type MCPTool,
  PrefixedToolset,
  type Toolset,
} from "@vibesjs/sdk";
import { z } from "zod";
import {
  type AgentRunDeps,
  AgentZoo,
  MCPPool,
  MCPServerUnavailableError,
  mcpToolPrefix,
  ObservedToolset,
  OptionalMCPToolset,
  parseConfig,
  substituteSharedPathTokens,
} from "../mod.ts";
import type { ZooActor } from "../Zoo.ts";
import type { AgentActivationResult, AgentConfig } from "../types.ts";

class FakeMCPClient implements MCPClient {
  connects = 0;
  disconnects = 0;

  constructor(
    readonly tools: MCPTool[] = [{
      name: "search",
      description: "Search the server.",
      inputSchema: { type: "object" },
    }],
    readonly connectError?: Error,
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
    type: stdio
    command: one
  - name: github
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

Deno.test("MCP shared path tokens are explicit", () => {
  const resolved = substituteSharedPathTokens({
    name: "shared",
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
      { name: "good", type: "stdio", command: "good", args: [] },
      { name: "bad", type: "stdio", command: "bad", args: [] },
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
  assertThrows(
    () => pool.select("agent", ["missing"]),
    Error,
    "unknown MCP server",
  );
});

Deno.test("MCP connection is lazy until selected tools are discovered", async () => {
  const client = new FakeMCPClient();
  const pool = new MCPPool(
    [{ name: "docs", type: "stdio", command: "docs", args: [] }],
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
