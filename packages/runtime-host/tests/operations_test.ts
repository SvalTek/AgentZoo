import { assertEquals, assertRejects } from "@std/assert";
import { HostError } from "../protocol.ts";
import { executeOperation, type OperationContext } from "../operations.ts";

async function fixture(files: Record<string, Uint8Array | string>) {
  const base = await Deno.makeTempDir({ prefix: "runtime-host-read-" });
  const root = `${base}/alpha/merged`;
  await Deno.mkdir(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await Deno.writeFile(
      `${root}/${path}`,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    );
  }
  return { base, context: { agentsRoot: `${base}` } as OperationContext };
}

Deno.test("fs.read returns a byte window and the next offset", async () => {
  const { base, context } = await fixture({ "numbers.txt": "0123456789" });
  try {
    const read = await executeOperation(context, "fs.read", "alpha", {
      path: "/numbers.txt",
      unit: "bytes",
      offset: 2,
      limit: 3,
    });
    assertEquals(new TextDecoder().decode(read.payload), "234");
    assertEquals(read.result, {
      unit: "bytes",
      offset: 2,
      bytesRead: 3,
      sizeBytes: 10,
      truncated: true,
      nextByteOffset: 5,
    });

    const end = await executeOperation(context, "fs.read", "alpha", {
      path: "/numbers.txt",
      unit: "bytes",
      offset: 10,
      limit: 3,
    });
    assertEquals(end.payload?.length, 0);
    assertEquals(end.result.truncated, false);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read refuses a range beyond the file", async () => {
  const { base, context } = await fixture({ "short.txt": "abc" });
  try {
    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/short.txt",
          unit: "bytes",
          offset: 4,
          limit: 1,
        }),
      HostError,
      "is 3 bytes, but offset was 4",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read rejects binary and split UTF-8 content", async () => {
  const { base, context } = await fixture({
    "binary.bin": new Uint8Array([0x61, 0x00, 0x62]),
    "euro.txt": new Uint8Array([0xe2, 0x82, 0xac]),
  });
  try {
    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/binary.bin",
          unit: "bytes",
        }),
      HostError,
      "not a text file",
    );
    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/euro.txt",
          unit: "bytes",
          offset: 1,
          limit: 1,
        }),
      HostError,
      "not valid UTF-8",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read returns 1-based line windows with their own endings", async () => {
  const { base, context } = await fixture({
    "lines.txt": "one\ntwo\r\nthree",
  });
  try {
    const read = await executeOperation(context, "fs.read", "alpha", {
      path: "/lines.txt",
      unit: "lines",
      startLine: 2,
      lineLimit: 2,
    });
    assertEquals(new TextDecoder().decode(read.payload), "two\r\nthree");
    assertEquals(read.result, {
      unit: "lines",
      startLine: 2,
      linesReturned: 2,
      totalLines: 3,
      truncated: false,
    });

    const first = await executeOperation(context, "fs.read", "alpha", {
      path: "/lines.txt",
      unit: "lines",
      startLine: 1,
      lineLimit: 1,
    });
    assertEquals(new TextDecoder().decode(first.payload), "one\n");
    assertEquals(first.result.truncated, true);
    assertEquals(first.result.nextLine, 2);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read reports a line start beyond the file", async () => {
  const { base, context } = await fixture({ "lines.txt": "one\ntwo\n" });
  try {
    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/lines.txt",
          unit: "lines",
          startLine: 4,
        }),
      HostError,
      "has 2 lines, but startLine was 4",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read rejects mixed units and unknown operations", async () => {
  const { base, context } = await fixture({ "lines.txt": "one\n" });
  try {
    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/lines.txt",
          unit: "bytes",
          startLine: 1,
        }),
      HostError,
      "byte reads take offset and limit",
    );
    await assertRejects(
      () => executeOperation(context, "nope", "alpha", {}),
      HostError,
      'unknown operation "nope"',
    );
    await assertRejects(
      () => executeOperation(context, "fs.stat", "missing", { path: "/x" }),
      HostError,
      "has no environment",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.stat reports type and size", async () => {
  const { base, context } = await fixture({ "file.txt": "abc" });
  try {
    const stat = await executeOperation(context, "fs.stat", "alpha", {
      path: "/file.txt",
    });
    assertEquals(stat.result.type, "file");
    assertEquals(stat.result.sizeBytes, 3);
    assertEquals(stat.result.symlink, false);

    const directory = await executeOperation(context, "fs.stat", "alpha", {
      path: "/",
    });
    assertEquals(directory.result.type, "directory");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test({
  name: "fs.read refuses a FIFO without blocking",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const { base, context } = await fixture({});
    try {
      const fifo = `${base}/alpha/merged/pipe`;
      const created = await new Deno.Command("mkfifo", {
        args: [fifo],
      }).output();
      if (!created.success) throw new Error("mkfifo failed");
      const stat = await executeOperation(context, "fs.stat", "alpha", {
        path: "/pipe",
      });
      assertEquals(stat.result.type, "other");
      await assertRejects(
        () =>
          executeOperation(context, "fs.read", "alpha", {
            path: "/pipe",
            unit: "bytes",
          }),
        HostError,
        "not a regular file",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test("fs.write creates, appends, and replaces a file atomically", async () => {
  const { base, context } = await fixture({});
  const root = `${base}/alpha/merged`;
  const encode = (value: string) => new TextEncoder().encode(value);
  try {
    const created = await executeOperation(
      context,
      "fs.write",
      "alpha",
      { path: "/notes.txt", mode: "create" },
      encode("one"),
    );
    assertEquals(created.result, {
      path: "/notes.txt",
      mode: "create",
      created: true,
      sizeBytes: 3,
    });

    const appended = await executeOperation(
      context,
      "fs.write",
      "alpha",
      { path: "/notes.txt", mode: "append" },
      encode("-two"),
    );
    assertEquals(appended.result.created, false);
    assertEquals(await Deno.readTextFile(`${root}/notes.txt`), "one-two");

    await Deno.chmod(`${root}/notes.txt`, 0o640);
    const replaced = await executeOperation(
      context,
      "fs.write",
      "alpha",
      { path: "/notes.txt", mode: "overwrite" },
      encode("three"),
    );
    assertEquals(replaced.result.sizeBytes, 5);
    assertEquals(await Deno.readTextFile(`${root}/notes.txt`), "three");
    if (Deno.build.os === "linux") {
      assertEquals((await Deno.stat(`${root}/notes.txt`)).mode! & 0o777, 0o640);
    }

    await assertRejects(
      () =>
        executeOperation(
          context,
          "fs.write",
          "alpha",
          { path: "/notes.txt", mode: "create" },
          encode("again"),
        ),
      HostError,
      "already exists",
    );

    await Deno.symlink("/notes.txt", `${root}/link.txt`, { type: "file" });
    await assertRejects(
      () =>
        executeOperation(
          context,
          "fs.write",
          "alpha",
          { path: "/link.txt", mode: "overwrite" },
          encode("through"),
        ),
      HostError,
      "symbolic link",
    );

    await assertRejects(
      () =>
        executeOperation(
          context,
          "fs.write",
          "alpha",
          { path: "/missing/notes.txt", mode: "create" },
          encode("x"),
        ),
      HostError,
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.remove unlinks files and links without following them", async () => {
  const { base, context } = await fixture({ "gone.txt": "x", "keep.txt": "y" });
  const root = `${base}/alpha/merged`;
  try {
    const removed = await executeOperation(context, "fs.remove", "alpha", {
      path: "/gone.txt",
    });
    assertEquals(removed.result, { path: "/gone.txt", removed: true });
    await assertRejects(
      () => Deno.lstat(`${root}/gone.txt`),
      Deno.errors.NotFound,
    );

    const again = await executeOperation(context, "fs.remove", "alpha", {
      path: "/gone.txt",
    });
    assertEquals(again.result, { path: "/gone.txt", removed: false });

    await Deno.symlink("keep.txt", `${root}/link.txt`, { type: "file" });
    await executeOperation(context, "fs.remove", "alpha", {
      path: "/link.txt",
    });
    await assertRejects(
      () => Deno.lstat(`${root}/link.txt`),
      Deno.errors.NotFound,
    );
    assertEquals(await Deno.readTextFile(`${root}/keep.txt`), "y");

    await assertRejects(
      () => executeOperation(context, "fs.remove", "alpha", { path: "/" }),
      HostError,
      "not a file path",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.read returns an empty page for line 1 of an empty file", async () => {
  const { base, context } = await fixture({ "empty.txt": "" });
  try {
    const read = await executeOperation(context, "fs.read", "alpha", {
      path: "/empty.txt",
      unit: "lines",
      startLine: 1,
      lineLimit: 10,
    });
    assertEquals(read.result, {
      unit: "lines",
      startLine: 1,
      linesReturned: 0,
      totalLines: 0,
      truncated: false,
    });
    assertEquals(read.payload?.length, 0);

    await assertRejects(
      () =>
        executeOperation(context, "fs.read", "alpha", {
          path: "/empty.txt",
          unit: "lines",
          startLine: 2,
          lineLimit: 10,
        }),
      HostError,
      "startLine was 2",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("fs.write refuses a stale expected snapshot", async () => {
  const { base, context } = await fixture({ "note.txt": "current" });
  try {
    await assertRejects(
      () =>
        executeOperation(
          context,
          "fs.write",
          "alpha",
          {
            path: "/note.txt",
            mode: "overwrite",
            expectedSizeBytes: 3,
            expectedMtimeMs: 1,
          },
          new TextEncoder().encode("new"),
        ),
      HostError,
      "changed after it was read",
    );
    assertEquals(
      await Deno.readTextFile(`${base}/alpha/merged/note.txt`),
      "current",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
