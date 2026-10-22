import { assert, assertEquals, assertRejects } from "@std/assert";
import { createRuntimeHostServer } from "@agent-zoo/runtime-host/server";
import { HostError } from "@agent-zoo/runtime-host/protocol";
import { RuntimeHostClient } from "../RuntimeHostClient.ts";

const token = "test-token";

async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

async function fixture() {
  const base = await Deno.makeTempDir({ prefix: "runtime-host-client-" });
  const root = `${base}/alpha/merged`;
  await Deno.mkdir(`${root}/root`, { recursive: true });
  await Deno.writeTextFile(`${root}/root/seed.txt`, "seed\n");
  const server = createRuntimeHostServer({
    agentsRoot: base,
    token,
    port: 0,
  });
  return { base, root, server };
}

Deno.test({
  name: "runtime host client writes, reads, and correlates payload frames",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, root, server } = await fixture();
    const client = await RuntimeHostClient.connect({
      url: `ws://127.0.0.1:${server.port}`,
      token,
    });
    try {
      const ping = await client.request("ping");
      assertEquals(ping.result.protocol, 1);

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const writes = await Promise.all([
        client.requestWithPayload(
          "fs.write",
          "alpha",
          { path: "/root/a.txt", mode: "create" },
          encoder.encode("alpha"),
        ),
        client.requestWithPayload(
          "fs.write",
          "alpha",
          { path: "/root/b.txt", mode: "create" },
          encoder.encode("beta"),
        ),
      ]);
      assertEquals(writes.map((write) => write.result.sizeBytes), [5, 4]);
      assertEquals(await Deno.readTextFile(`${root}/root/a.txt`), "alpha");
      assertEquals(await Deno.readTextFile(`${root}/root/b.txt`), "beta");

      const read = await client.request("fs.read", "alpha", {
        path: "/root/a.txt",
        unit: "bytes",
        offset: 0,
        limit: 10,
      });
      assertEquals(decoder.decode(read.payload), "alpha");
      assertEquals(read.result.sizeBytes, 5);

      await assertRejects(
        () =>
          client.request("fs.read", "alpha", {
            path: "/root/missing.txt",
            unit: "bytes",
          }),
        HostError,
        "does not exist",
      );

      const seen: string[][] = [];
      const subscription = await client.subscribe(
        "alpha",
        { path: "/root", depth: 1, debounceMs: 50 },
        (event) => {
          if (Array.isArray(event.paths)) seen.push(event.paths as string[]);
        },
      );
      try {
        await client.requestWithPayload(
          "fs.write",
          "alpha",
          { path: "/root/watched.txt", mode: "create" },
          encoder.encode("x"),
        );
        const deadline = Date.now() + 3_000;
        while (
          !seen.some((paths) => paths.includes("/root/watched.txt")) &&
          Date.now() < deadline
        ) {
          await delay(50);
        }
        assert(
          seen.some((paths) => paths.includes("/root/watched.txt")),
          JSON.stringify(seen),
        );
      } finally {
        subscription.close();
      }
    } finally {
      client.close();
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "concurrent appends do not lose bytes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, root, server } = await fixture();
    const client = await RuntimeHostClient.connect({
      url: `ws://127.0.0.1:${server.port}`,
      token,
    });
    try {
      const encoder = new TextEncoder();
      await Promise.all([
        client.requestWithPayload(
          "fs.write",
          "alpha",
          { path: "/root/log.txt", mode: "append" },
          encoder.encode("A"),
        ),
        client.requestWithPayload(
          "fs.write",
          "alpha",
          { path: "/root/log.txt", mode: "append" },
          encoder.encode("B"),
        ),
      ]);
      const content = await Deno.readTextFile(`${root}/root/log.txt`);
      assertEquals(content.length, 2);
      assert(content === "AB" || content === "BA");
    } finally {
      client.close();
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "runtime host reports a failed subscription and missing write payload",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, root, server } = await fixture();
    const client = await RuntimeHostClient.connect({
      url: `ws://127.0.0.1:${server.port}`,
      token,
    });
    try {
      await assertRejects(
        () =>
          client.subscribe(
            "alpha",
            { path: "/root/missing", depth: 1 },
            () => {},
          ),
        Error,
        "does not exist",
      );

      await assertRejects(
        () =>
          client.request("fs.write", "alpha", {
            path: "/root/no-payload.txt",
            mode: "create",
          }),
        HostError,
        "requires a payload",
      );
      await assertRejects(
        () => Deno.lstat(`${root}/root/no-payload.txt`),
        Deno.errors.NotFound,
      );

      const ping = await client.request("ping");
      assertEquals(ping.result.protocol, 1);
    } finally {
      client.close();
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "runtime host refuses a bad token",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, server } = await fixture();
    try {
      await assertRejects(
        () =>
          RuntimeHostClient.connect({
            url: `ws://127.0.0.1:${server.port}`,
            token: "wrong",
          }),
        Error,
        "token rejected",
      );
    } finally {
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});
