import { assertEquals, assertRejects } from "@std/assert";
import { HostError } from "../protocol.ts";
import { resolveExisting } from "../paths.ts";

const symlinksSupported = await (async () => {
  if (Deno.build.os === "windows") return false;
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/target`, "x");
    await Deno.symlink(`${directory}/target`, `${directory}/link`);
    return true;
  } catch {
    return false;
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
})();

async function fixture() {
  const base = await Deno.makeTempDir({ prefix: "runtime-host-paths-" });
  const root = `${base}/alpha/merged`;
  await Deno.mkdir(`${root}/nested`, { recursive: true });
  await Deno.writeTextFile(`${root}/hello.txt`, "hello");
  await Deno.writeTextFile(`${root}/nested/file.txt`, "nested");
  await Deno.writeTextFile(`${base}/outside.txt`, "outside");
  return { base, root };
}

Deno.test("resolveExisting resolves a path beneath the agent root", async () => {
  const { base, root } = await fixture();
  try {
    assertEquals(await resolveExisting(root, "/hello.txt"), {
      path: `${root}/hello.txt`,
      symlink: false,
    });
    assertEquals(await resolveExisting(root, "/nested/file.txt"), {
      path: `${root}/nested/file.txt`,
      symlink: false,
    });
    await assertRejects(
      () => resolveExisting(root, "/nested/../hello.txt"),
      HostError,
      "which is not allowed",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("resolveExisting refuses traversal and missing paths", async () => {
  const { base, root } = await fixture();
  try {
    await assertRejects(
      () => resolveExisting(root, "/../outside.txt"),
      HostError,
      "which is not allowed",
    );
    await assertRejects(
      () => resolveExisting(root, "/nested/../../outside.txt"),
      HostError,
      "which is not allowed",
    );
    await assertRejects(
      () => resolveExisting(root, "/missing.txt"),
      HostError,
      "does not exist",
    );
    await assertRejects(
      () => resolveExisting(root, "relative.txt"),
      HostError,
      "not an absolute path",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test({
  name: "resolveExisting follows a symlink that stays inside the root",
  ignore: !symlinksSupported,
  fn: async () => {
    const { base, root } = await fixture();
    try {
      await Deno.symlink("/hello.txt", `${root}/inside-link`);
      assertEquals(await resolveExisting(root, "/inside-link"), {
        path: `${root}/hello.txt`,
        symlink: true,
      });
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "resolveExisting keeps an absolute symlink target inside the root",
  ignore: !symlinksSupported,
  fn: async () => {
    const { base, root } = await fixture();
    try {
      // Chroot semantics: "/../../etc/passwd" clamps to /etc/passwd inside
      // the agent root, which does not exist there.
      await Deno.symlink("/../../etc/passwd", `${root}/escape-link`);
      await assertRejects(
        () => resolveExisting(root, "/escape-link"),
        HostError,
        "does not exist",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});
