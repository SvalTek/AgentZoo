import { assertEquals } from "@std/assert";
import { decodeBinaryFrame } from "../protocol.ts";
import { createRuntimeHostServer } from "../server.ts";

const TOKEN = "test-token";

async function fixture() {
  const base = await Deno.makeTempDir({ prefix: "runtime-host-server-" });
  const root = `${base}/alpha/merged`;
  await Deno.mkdir(root, { recursive: true });
  await Deno.writeTextFile(`${root}/numbers.txt`, "0123456789");
  return { base, agentsRoot: base };
}

function opened(socket: WebSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("socket error")), {
    once: true,
  });
  return promise;
}

function closed(socket: WebSocket): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (socket.readyState === WebSocket.CLOSED) {
    resolve();
    return promise;
  }
  socket.addEventListener("close", () => resolve(), { once: true });
  return promise;
}

function nextMessage(socket: WebSocket): Promise<string | Uint8Array> {
  const { promise, resolve, reject } = Promise.withResolvers<
    string | Uint8Array
  >();
  socket.addEventListener("message", (event) => {
    resolve(
      typeof event.data === "string"
        ? event.data
        : new Uint8Array(event.data as ArrayBuffer),
    );
  }, { once: true });
  socket.addEventListener("error", () => reject(new Error("socket error")), {
    once: true,
  });
  return promise;
}

Deno.test({
  name: "runtime host handshakes and reads a byte window",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, agentsRoot } = await fixture();
    const server = createRuntimeHostServer({
      agentsRoot,
      token: TOKEN,
      port: 0,
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    socket.binaryType = "arraybuffer";
    try {
      await opened(socket);
      socket.send(JSON.stringify({
        op: "hello",
        protocol: 1,
        token: TOKEN,
      }));
      assertEquals(JSON.parse(await nextMessage(socket) as string), {
        ok: true,
        result: { protocol: 1, helperVersion: "0.1.0" },
      });

      socket.send(JSON.stringify({ id: "1", op: "ping" }));
      const ping = JSON.parse(await nextMessage(socket) as string);
      assertEquals(ping.ok, true);
      assertEquals(ping.result.protocol, 1);

      socket.send(JSON.stringify({
        id: "2",
        op: "fs.read",
        agent: "alpha",
        params: {
          path: "/numbers.txt",
          unit: "bytes",
          offset: 2,
          limit: 3,
        },
      }));
      const payload = await nextMessage(socket);
      const response = JSON.parse(await nextMessage(socket) as string);
      if (!(payload instanceof Uint8Array)) {
        throw new Error("expected a binary payload");
      }
      const frame = decodeBinaryFrame(payload);
      assertEquals(response.seq, frame.sequence);
      assertEquals(new TextDecoder().decode(frame.payload), "234");
      assertEquals(response.result.bytesRead, 3);
    } finally {
      socket.close();
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "runtime host rejects an unauthenticated or bad-token client",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, agentsRoot } = await fixture();
    const server = createRuntimeHostServer({
      agentsRoot,
      token: TOKEN,
      port: 0,
    });
    try {
      const unauthenticated = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await opened(unauthenticated);
      unauthenticated.send(JSON.stringify({ id: "1", op: "ping" }));
      const rejection = JSON.parse(
        await nextMessage(unauthenticated) as string,
      );
      assertEquals(rejection.ok, false);
      assertEquals(rejection.error.code, "unauthorized");
      await closed(unauthenticated);

      const badToken = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await opened(badToken);
      badToken.send(JSON.stringify({
        op: "hello",
        protocol: 1,
        token: "wrong",
      }));
      const tokenRejection = JSON.parse(await nextMessage(badToken) as string);
      assertEquals(tokenRejection.error.code, "unauthorized");
      await closed(badToken);
    } finally {
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`${label} timed out`)),
    5_000,
  );
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

Deno.test({
  name: "runtime host delivers coalesced fs.watch events",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, agentsRoot } = await fixture();
    const server = createRuntimeHostServer({
      agentsRoot,
      token: TOKEN,
      port: 0,
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    try {
      await opened(socket);
      socket.send(JSON.stringify({ op: "hello", protocol: 1, token: TOKEN }));
      await nextMessage(socket);

      socket.send(JSON.stringify({
        op: "subscribe",
        sub: "1",
        channel: "fs.watch",
        agent: "alpha",
        params: { path: "/", depth: 2, debounceMs: 50 },
      }));
      const acknowledgement = JSON.parse(
        await withTimeout(nextMessage(socket), "subscription") as string,
      );
      assertEquals(acknowledgement.ok, true);
      assertEquals(acknowledgement.sub, "1");

      await Deno.writeTextFile(`${agentsRoot}/alpha/merged/watched.txt`, "x");
      let paths: string[] = [];
      for (let attempt = 0; attempt < 20 && paths.length === 0; attempt++) {
        const message = JSON.parse(
          await withTimeout(nextMessage(socket), "watch event") as string,
        );
        if (message.event?.paths) paths = message.event.paths as string[];
      }
      assertEquals(paths.includes("/watched.txt"), true);

      socket.send(JSON.stringify({ op: "unsubscribe", sub: "1" }));
      const removed = JSON.parse(
        await withTimeout(nextMessage(socket), "unsubscribe") as string,
      );
      assertEquals(removed.ok, true);
    } finally {
      socket.close();
      await server.close();
      await Deno.remove(base, { recursive: true });
    }
  },
});
