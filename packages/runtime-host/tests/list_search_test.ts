import { assertEquals, assertRejects } from "@std/assert";
import { HostError } from "../protocol.ts";
import { executeOperation, type OperationContext } from "../operations.ts";

const posixOnly = Deno.build.os === "windows";

async function fixture(extra?: (root: string) => Promise<void>) {
  const base = await Deno.makeTempDir({ prefix: "runtime-host-list-" });
  const root = `${base}/alpha/merged`;
  await Deno.mkdir(`${root}/sub/deep`, { recursive: true });
  await Deno.writeTextFile(`${root}/a.txt`, "alpha\nneedle here\n");
  await Deno.writeTextFile(`${root}/sub/b.py`, "needle too\n");
  await Deno.writeTextFile(`${root}/sub/deep/c.txt`, "nothing\n");
  await Deno.writeFile(
    `${root}/binary.bin`,
    new Uint8Array([0x61, 0x00, 0x62]),
  );
  if (extra) await extra(root);
  return { base, root, context: { agentsRoot: base } as OperationContext };
}

Deno.test("fs.list reports immediate entries with types and sizes", async () => {
  const { base, context } = await fixture();
  try {
    const listing = await executeOperation(context, "fs.list", "alpha", {
      path: "/",
    });
    const entries = listing.result.entries as Array<{
      name: string;
      type: string;
      sizeBytes: number | null;
    }>;
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    assertEquals(byName.get("a.txt")?.type, "file");
    assertEquals(byName.get("a.txt")?.sizeBytes, 18);
    assertEquals(byName.get("sub")?.type, "directory");
    assertEquals(byName.has("deep"), false);
    assertEquals(
      entries.map((entry) => entry.name),
      [...entries.map((entry) => entry.name)].sort(),
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.list bounds its result and refuses a file path", async () => {
  const { base, context } = await fixture();
  try {
    const limited = await executeOperation(context, "fs.list", "alpha", {
      path: "/",
      limit: 2,
    });
    assertEquals((limited.result.entries as unknown[]).length, 2);
    assertEquals(
      (limited.result.entries as Array<{ name: string }>).map((entry) =>
        entry.name
      ),
      ["a.txt", "binary.bin"],
    );
    assertEquals(limited.result.truncated, true);

    await assertRejects(
      () =>
        executeOperation(context, "fs.list", "alpha", {
          path: "/a.txt",
        }),
      HostError,
      "is not a directory",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.search finds files by name glob", async () => {
  const { base, context } = await fixture();
  try {
    const found = await executeOperation(context, "fs.search", "alpha", {
      path: "/",
      kind: "name",
      name: "*.txt",
    });
    const paths = (found.result.results as Array<{ path: string }>).map((
      result,
    ) => result.path);
    assertEquals(paths, ["/a.txt", "/sub/deep/c.txt"]);

    // Name searches report matching directories too, like find(1).
    const directories = await executeOperation(context, "fs.search", "alpha", {
      path: "/",
      kind: "name",
      name: "deep",
    });
    assertEquals(
      (directories.result.results as Array<{ path: string; type: string }>)
        .map((result) => [result.path, result.type]),
      [["/sub/deep", "directory"]],
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.search finds literal text with line numbers", async () => {
  const { base, context } = await fixture();
  try {
    const found = await executeOperation(context, "fs.search", "alpha", {
      path: "/",
      kind: "text",
      text: "needle",
    });
    const results = found.result.results as Array<{
      path: string;
      line: number;
      snippet: string;
    }>;
    assertEquals(
      results.some((result) =>
        result.path === "/a.txt" && result.line === 2 &&
        result.snippet === "needle here"
      ),
      true,
    );
    assertEquals(
      results.some((result) =>
        result.path === "/sub/b.py" && result.line === 1
      ),
      true,
    );
    assertEquals(
      results.some((result) => result.path === "/binary.bin"),
      false,
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.search bounds results and validates its mode", async () => {
  const { base, context } = await fixture();
  try {
    const limited = await executeOperation(context, "fs.search", "alpha", {
      path: "/",
      kind: "text",
      text: "needle",
      maxResults: 1,
    });
    assertEquals((limited.result.results as unknown[]).length, 1);
    assertEquals(limited.result.truncated, true);

    await assertRejects(
      () =>
        executeOperation(context, "fs.search", "alpha", {
          path: "/",
          kind: "name",
        }),
      HostError,
      "name is required",
    );
    await assertRejects(
      () =>
        executeOperation(context, "fs.search", "alpha", {
          path: "/",
          kind: "text",
        }),
      HostError,
      "text is required",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test({
  name: "fs.search reads symlinked files and skips FIFOs and escaping links",
  ignore: posixOnly,
  fn: async () => {
    const { base, context } = await fixture(async (root) => {
      await Deno.symlink("/a.txt", `${root}/link.txt`);
      await Deno.symlink("/etc", `${root}/escape`);
      const fifo = await new Deno.Command("mkfifo", {
        args: [`${root}/pipe`],
      }).output();
      if (!fifo.success) throw new Error("mkfifo failed");
    });
    try {
      const links = await executeOperation(context, "fs.search", "alpha", {
        path: "/",
        kind: "name",
        name: "link.txt",
      });
      assertEquals(links.result.results, [{
        path: "/link.txt",
        type: "symlink",
      }]);

      const directoryLink = await executeOperation(
        context,
        "fs.search",
        "alpha",
        { path: "/", kind: "name", name: "escape" },
      );
      assertEquals(directoryLink.result.results, [{
        path: "/escape",
        type: "symlink",
      }]);

      const text = await executeOperation(context, "fs.search", "alpha", {
        path: "/",
        kind: "text",
        text: "needle",
      });
      const paths = (text.result.results as Array<{ path: string }>).map((
        result,
      ) => result.path);
      assertEquals(paths.includes("/link.txt"), true);
      assertEquals(paths.some((path) => path.startsWith("/escape")), false);
      assertEquals(paths.includes("/pipe"), false);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});
