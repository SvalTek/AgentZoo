/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { assert, assertRejects, assertEquals } from "@std/assert";
import { ensureRuntimeImage, type RuntimeImageDeps } from "../Runtime.ts";

/**
 * Unit tests for the runtime image provisioning decision logic extracted from
 * DockerRuntimeManager.#ensureRuntimeImage. These tests do NOT require a
 * Docker daemon — all four dependency functions are stubbed.
 */

interface CallLog {
  tryDockerImageId: string[];
  pathExists: string[];
  buildRuntimeImage: string[];
  pull: string[][];
}

function makeImageDeps(
  log: CallLog,
  config: {
    imageExists?: boolean;
    containerfileExists?: boolean;
    pullThrows?: boolean;
  },
): RuntimeImageDeps {
  return {
    tryDockerImageId: (image) => {
      log.tryDockerImageId.push(image);
      return config.imageExists
        ? Promise.resolve("sha256:exists")
        : Promise.resolve(undefined);
    },
    pathExists: (path) => {
      log.pathExists.push(path);
      return Promise.resolve(config.containerfileExists ?? false);
    },
    buildRuntimeImage: (image) => {
      log.buildRuntimeImage.push(image);
      return Promise.resolve();
    },
    runDocker: (args) => {
      log.pull.push(args);
      if (config.pullThrows) throw new Error("manifest not found");
      return Promise.resolve();
    },
  };
}

function emptyLog(): CallLog {
  return {
    tryDockerImageId: [],
    pathExists: [],
    buildRuntimeImage: [],
    pull: [],
  };
}

Deno.test("ensureRuntimeImage returns early when the image already exists locally", async () => {
  const log = emptyLog();
  const deps = makeImageDeps(log, { imageExists: true });

  await ensureRuntimeImage("agent-runtime:dev", "/fake/Containerfile", deps);

  assertEquals(log.tryDockerImageId, ["agent-runtime:dev"]);
  assertEquals(log.pathExists, []);
  assertEquals(log.buildRuntimeImage, []);
  assertEquals(log.pull, []);
});

Deno.test("ensureRuntimeImage builds from source when the image is missing and the Containerfile is present", async () => {
  const log = emptyLog();
  const deps = makeImageDeps(log, {
    imageExists: false,
    containerfileExists: true,
  });

  await ensureRuntimeImage("agent-runtime:dev", "/fake/Containerfile", deps);

  assertEquals(log.tryDockerImageId, ["agent-runtime:dev"]);
  assertEquals(log.pathExists, ["/fake/Containerfile"]);
  assertEquals(log.buildRuntimeImage, ["agent-runtime:dev"]);
  assertEquals(log.pull, []);
});

Deno.test("ensureRuntimeImage pulls the image when the image is missing and the Containerfile is absent", async () => {
  const log = emptyLog();
  const deps = makeImageDeps(log, {
    imageExists: false,
    containerfileExists: false,
  });

  await ensureRuntimeImage("agent-runtime:dev", "/fake/Containerfile", deps);

  assertEquals(log.tryDockerImageId, ["agent-runtime:dev"]);
  assertEquals(log.pathExists, ["/fake/Containerfile"]);
  assertEquals(log.buildRuntimeImage, []);
  assertEquals(log.pull, [["pull", "agent-runtime:dev"]]);
});

Deno.test("ensureRuntimeImage throws an actionable error when the image is missing, the Containerfile is absent, and pulling fails", async () => {
  const log = emptyLog();
  const deps = makeImageDeps(log, {
    imageExists: false,
    containerfileExists: false,
    pullThrows: true,
  });

  await assertRejects(
    () => ensureRuntimeImage("agent-runtime:dev", "/fake/Containerfile", deps),
    Error,
    "not available locally",
  );

  assertEquals(log.pull, [["pull", "agent-runtime:dev"]]);
  assertEquals(log.buildRuntimeImage, []);
});

Deno.test("ensureRuntimeImage error message includes the original pull failure detail and points to deno task docker:build", async () => {
  const log = emptyLog();
  const deps = makeImageDeps(log, {
    imageExists: false,
    containerfileExists: false,
    pullThrows: true,
  });

  let caught: Error | undefined;
  try {
    await ensureRuntimeImage("agent-runtime:dev", "/fake/Containerfile", deps);
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error));
  }

  assert(caught, "expected ensureRuntimeImage to reject");
  const message = caught.message;
  assert(
    message.includes("agent-runtime:dev"),
    `error should mention the image name, got: ${message}`,
  );
  assert(
    message.includes("manifest not found"),
    `error should include the original pull failure detail, got: ${message}`,
  );
  assert(
    message.includes("deno task docker:build"),
    `error should point to the manual build command, got: ${message}`,
  );
  assert(
    message.includes("Containerfile is not present"),
    `error should explain why build was not attempted, got: ${message}`,
  );
});
