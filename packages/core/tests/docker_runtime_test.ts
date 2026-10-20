import { assert, assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { buildRuntimeImage, DockerRuntimeManager } from "../Runtime.ts";
import { FilesystemFeature } from "../tools/FilesystemTools.ts";
import { VisionFeature } from "../tools/ViewImageTool.ts";
import { HttpFeature } from "../tools/HttpRequestTool.ts";
import { unwrapObservedToolResult } from "../ToolSupport.ts";
import type { AgentRunDeps } from "../Agent.ts";
import type { RuntimeEnv } from "../types.ts";
import type { ToolDefinition } from "@vibesjs/sdk";

let dockerIntegrationEnabled = false;
try {
  dockerIntegrationEnabled =
    Deno.env.get("AGENT_ZOO_DOCKER_INTEGRATION") === "1";
} catch {
  // Unit-test runs deliberately do not need environment permission.
}

if (dockerIntegrationEnabled) {
  await buildRuntimeImage("agent-runtime:test");
}

Deno.test({
  name: "Docker runtime isolates agent roots and shares only /shared",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-runtime-test-",
    });
    const runtime = new DockerRuntimeManager(
      shared,
      "agent-runtime:test",
      `agent-runtime-test-${crypto.randomUUID()}`,
    );
    try {
      const alpha = await runtime.createEnv("alpha");
      const beta = await runtime.createEnv("beta");

      const ownership = await new Deno.Command("docker.exe", {
        args: [
          "inspect",
          runtime.hostName,
          `${runtime.hostName}-data`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(ownership.success, new TextDecoder().decode(ownership.stderr));
      const ownedResources = JSON.parse(
        new TextDecoder().decode(ownership.stdout),
      ) as Array<
        {
          Config?: { Labels?: Record<string, string> };
          Labels?: Record<string, string>;
        }
      >;
      for (const resource of ownedResources) {
        const labels = resource.Config?.Labels ?? resource.Labels;
        assertEquals(labels?.["agent-zoo.managed"], "true");
        assertEquals(labels?.["agent-zoo.runtime"], runtime.runId);
        assertEquals(labels?.["agent-zoo.run"], runtime.runId);
        assertEquals(labels?.["agent-zoo.created"], runtime.createdAt);
        assertEquals(labels?.["agent-zoo.project"], runtime.project);
        assertEquals(labels?.["agent-zoo.workspace"], resolve(shared));
      }

      const alphaResult = await alpha.exec(
        [
          "/bin/bash",
          "--login",
          "-c",
          "test -d /run && touch /run/adduser; echo alpha > /tmp/private; echo handoff > /shared/handoff",
        ],
      );
      const betaResult = await beta.exec(
        [
          "/bin/bash",
          "--login",
          "-c",
          "cat /shared/handoff; test ! -e /tmp/private; pwd",
        ],
        { cwd: "/tmp" },
      );

      assertEquals(
        alphaResult.exitCode,
        0,
        JSON.stringify(alphaResult),
      );
      assertEquals(
        betaResult.exitCode,
        0,
        JSON.stringify(betaResult),
      );
      assert(betaResult.stdout.includes("handoff"));
      assert(betaResult.stdout.includes("/tmp"));

      const privateProcess = await alpha.exec([
        "/bin/bash",
        "-c",
        "cp /bin/sleep /tmp/alpha-sleeper; nohup /tmp/alpha-sleeper 300 </dev/null >/tmp/private-process.out 2>&1 & echo $!",
      ]);
      assertEquals(privateProcess.exitCode, 0, JSON.stringify(privateProcess));
      const privatePid = privateProcess.stdout.trim();
      assert(/^[0-9]+$/.test(privatePid), JSON.stringify(privateProcess));
      const sameEnvironmentCanSeeProcess = await alpha.exec([
        "/bin/bash",
        "-c",
        `cat /proc/${privatePid}/comm`,
      ]);
      assertEquals(
        sameEnvironmentCanSeeProcess.exitCode,
        0,
        JSON.stringify(sameEnvironmentCanSeeProcess),
      );
      assert(
        sameEnvironmentCanSeeProcess.stdout.trim() === "alpha-sleeper",
        JSON.stringify(sameEnvironmentCanSeeProcess),
      );
      const siblingProcessView = await beta.exec([
        "/bin/bash",
        "-c",
        'found=; for file in /proc/[0-9]*/comm; do value=$(cat "$file" 2>/dev/null || true); test "$value" = alpha-sleeper && found=yes; done; test -z "$found"',
      ]);
      assertEquals(
        siblingProcessView.exitCode,
        0,
        JSON.stringify(siblingProcessView),
      );
      const outerPidResult = await new Deno.Command("docker.exe", {
        args: [
          "exec",
          runtime.hostName,
          "/bin/bash",
          "-c",
          'for file in /proc/[0-9]*/comm; do value=$(cat "$file" 2>/dev/null || true); if test "$value" = alpha-sleeper; then basename "$(dirname "$file")"; exit 0; fi; done; exit 1',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const outerPid = new TextDecoder().decode(outerPidResult.stdout).trim();
      assert(
        outerPidResult.success,
        new TextDecoder().decode(outerPidResult.stderr),
      );
      assert(/^[0-9]+$/.test(outerPid), outerPid);
      const siblingCannotSignalProcess = await beta.exec([
        "/bin/bash",
        "-c",
        `! kill -0 ${outerPid} 2>/dev/null`,
      ]);
      assertEquals(
        siblingCannotSignalProcess.exitCode,
        0,
        JSON.stringify(siblingCannotSignalProcess),
      );
      const processSurvived = await alpha.exec([
        "/bin/bash",
        "-c",
        `kill -0 ${privatePid}`,
      ]);
      assertEquals(
        processSurvived.exitCode,
        0,
        JSON.stringify(processSurvived),
      );

      const timedCommand = await alpha.exec(
        [
          "/bin/bash",
          "-c",
          "cp /bin/sleep /tmp/timed-sleeper; /bin/bash -c 'exec 9>/tmp/timed-command.lock; flock 9; exec /tmp/timed-sleeper 300' | /bin/cat",
        ],
        { timeoutMs: 250 },
      );
      assertEquals(timedCommand.timedOut, true, JSON.stringify(timedCommand));
      const timedDescendantsGone = await alpha.exec([
        "/bin/bash",
        "-c",
        'found=; for file in /proc/[0-9]*/comm; do value=$(cat "$file" 2>/dev/null || true); test "$value" = timed-sleeper && found=yes; done; test -z "$found"',
      ]);
      assertEquals(
        timedDescendantsGone.exitCode,
        0,
        JSON.stringify(timedDescendantsGone),
      );
      const timedLockReleased = await alpha.exec([
        "/usr/bin/flock",
        "--nonblock",
        "/tmp/timed-command.lock",
        "/bin/true",
      ]);
      assertEquals(
        timedLockReleased.exitCode,
        0,
        JSON.stringify(timedLockReleased),
      );
      const unrelatedProcessSurvived = await alpha.exec([
        "/bin/bash",
        "-c",
        `kill -0 ${privatePid}`,
      ]);
      assertEquals(
        unrelatedProcessSurvived.exitCode,
        0,
        JSON.stringify(unrelatedProcessSurvived),
      );

      const cancellation = new AbortController();
      setTimeout(() => cancellation.abort(), 250);
      const abortedCommand = await alpha.exec(
        [
          "/bin/bash",
          "-c",
          "cp /bin/sleep /tmp/aborted-sleeper; /tmp/aborted-sleeper 300 | /bin/cat",
        ],
        { signal: cancellation.signal },
      );
      assertEquals(
        abortedCommand.aborted,
        true,
        JSON.stringify(abortedCommand),
      );
      const abortedDescendantsGone = await alpha.exec([
        "/bin/bash",
        "-c",
        'found=; for file in /proc/[0-9]*/comm; do value=$(cat "$file" 2>/dev/null || true); test "$value" = aborted-sleeper && found=yes; done; test -z "$found"',
      ]);
      assertEquals(
        abortedDescendantsGone.exitCode,
        0,
        JSON.stringify(abortedDescendantsGone),
      );
      await alpha.exec(["/bin/kill", privatePid]);

      const visibleIdentity = await alpha.exec([
        "/bin/bash",
        "--login",
        "-c",
        "cat /root/.bashrc; hostname; cat /proc/self/mountinfo",
      ]);
      assertEquals(visibleIdentity.exitCode, 0);
      const leakedIdentity = visibleIdentity.stdout.split("\n").filter((line) =>
        /agent[ -]?zoo/i.test(line)
      );
      assertEquals(leakedIdentity, []);

      const tools = new Map(
        (await new FilesystemFeature().createTools()).map((tool) => [
          tool.name,
          tool,
        ]),
      );
      const invoke = async (
        env: RuntimeEnv,
        name: string,
        args: unknown,
      ) => {
        const tool = tools.get(name) as ToolDefinition<AgentRunDeps>;
        const value = await tool.execute({
          deps: {
            agentId: env.agentId,
            provider: "openai-compatible",
            model: "test-model",
            runtime: env,
            cwd: "/root",
            control: {},
          },
        } as never, args);
        return unwrapObservedToolResult(value).result as Record<
          string,
          unknown
        >;
      };

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf private-data > /root/private-tool; printf shared-data > /shared/shared-tool",
      ]);
      const privateRead = await invoke(alpha, "read_file", {
        path: "/root/private-tool",
      });
      assertEquals(privateRead.content, "private-data");
      await assertRejects(
        () => invoke(beta, "read_file", { path: "/root/private-tool" }),
        Error,
        "The path does not exist.",
      );
      const sharedRead = await invoke(beta, "read_file", {
        path: "/shared/shared-tool",
      });
      assertEquals(sharedRead.content, "shared-data");

      const bounded = await invoke(alpha, "read_file", {
        path: "/root/private-tool",
        offset: 2,
        limit: 3,
      });
      assertEquals(bounded.content, "iva");
      assertEquals(bounded.truncated, true);
      assertEquals(bounded.nextOffset, 5);

      await invoke(alpha, "write_file", {
        path: "/root/written",
        content: "one",
      });
      await invoke(alpha, "write_file", {
        path: "/root/written",
        content: "-two",
        mode: "append",
      });
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/written"])).stdout,
        "one-two",
      );
      await assertRejects(
        () =>
          invoke(alpha, "write_file", {
            path: "/root/written",
            content: "accidental replacement",
          }),
        Error,
        "The file already exists.",
      );
      await assertRejects(
        () =>
          invoke(alpha, "write_file", {
            path: "/root/written",
            content: "unconfirmed replacement",
            mode: "overwrite",
          }),
        Error,
        "requires explicit confirmation",
      );
      await invoke(alpha, "write_file", {
        path: "/root/written",
        content: "replaced",
        mode: "overwrite",
        force: true,
      });
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/written"])).stdout,
        "replaced",
      );

      await invoke(alpha, "write_file", {
        path: "/root/editable",
        content: "same same",
      });
      await assertRejects(
        () =>
          invoke(alpha, "edit_file", {
            path: "/root/editable",
            oldText: "missing",
            newText: "x",
          }),
        Error,
        "The requested text was not found.",
      );
      await assertRejects(
        () =>
          invoke(alpha, "edit_file", {
            path: "/root/editable",
            oldText: "same",
            newText: "x",
          }),
        Error,
        "The requested text occurs more than once.",
      );
      const edited = await invoke(alpha, "edit_file", {
        path: "/root/editable",
        oldText: "same",
        newText: "done",
        replaceAll: true,
      });
      assertEquals(edited.replacements, 2);

      const exactLines = [
        "first line",
        "  indentation stays intact",
        String.raw`literal \n and regex ^[a-z]+$`,
        "Unicode λ🙂 and quotes: \"double\" 'single'",
        "",
      ];
      await invoke(alpha, "write_file", {
        path: "/root/line-oriented",
        content: exactLines.join("\n"),
      });
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/line-oriented"])).stdout,
        exactLines.join("\n"),
      );
      await invoke(alpha, "edit_file", {
        path: "/root/line-oriented",
        oldText: [
          "  indentation stays intact",
          String.raw`literal \n and regex ^[a-z]+$`,
        ].join("\n"),
        newText: [
          "  replacement remains indented",
          "second replacement line",
        ].join("\n"),
      });
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/line-oriented"])).stdout,
        [
          "first line",
          "  replacement remains indented",
          "second replacement line",
          "Unicode λ🙂 and quotes: \"double\" 'single'",
          "",
        ].join("\n"),
      );
      const patched = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "diff --git a/patched.txt b/patched.txt",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/patched.txt",
          "@@ -0,0 +1,3 @@",
          "+first line",
          "+  indentation from patch",
          "+Unicode λ🙂",
        ].join("\n"),
      });
      assertEquals(patched.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/patched.txt"])).stdout,
        "first line\n  indentation from patch\nUnicode λ🙂\n",
      );
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'first\\nsecond' > /root/no-final-newline.txt",
      ]);
      const eofPatched = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/no-final-newline.txt",
          "+++ b/no-final-newline.txt",
          "@@ -1,2 +1,3 @@",
          " first",
          " second",
          "+third",
        ].join("\n"),
      });
      assertEquals(eofPatched.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/no-final-newline.txt"])).stdout,
        "first\nsecond\nthird",
      );
      const repository = await alpha.exec([
        "/bin/bash",
        "-c",
        "mkdir /root/repository && cd /root/repository && git init -q && printf 'before\\n' > tracked.txt && git add tracked.txt",
      ]);
      assertEquals(repository.exitCode, 0, JSON.stringify(repository));
      const repositoryPatch = await invoke(alpha, "apply_patch", {
        cwd: "/root/repository",
        patch: [
          "diff --git a/tracked.txt b/tracked.txt",
          "--- a/tracked.txt",
          "+++ b/tracked.txt",
          "@@ -1 +1 @@",
          "-before",
          "+after",
        ].join("\n"),
      });
      assertEquals(repositoryPatch.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/repository/tracked.txt"])).stdout,
        "after\n",
      );
      const repositoryDiff = await alpha.exec([
        "/usr/bin/git",
        "-C",
        "/root/repository",
        "diff",
        "--",
        "tracked.txt",
      ]);
      assertEquals(repositoryDiff.exitCode, 0, JSON.stringify(repositoryDiff));
      assert(repositoryDiff.stdout.includes("-before"));
      assert(repositoryDiff.stdout.includes("+after"));

      await alpha.exec([
        "/bin/bash",
        "-c",
        "mkdir -p /root/tree/child; touch /root/tree/top /root/tree/child/deep; printf needle > /root/tree/a.txt; printf needle > /root/tree/b.txt",
      ]);
      const listed = await invoke(alpha, "list_directory", {
        path: "/root/tree",
      });
      const names = (listed.entries as Array<{ name: string }>).map((entry) =>
        entry.name
      );
      assert(names.includes("child"));
      assert(!names.includes("deep"));
      const discovered = await invoke(alpha, "search_files", {});
      const discoveredPaths = (
        discovered.results as Array<{ path: string }>
      ).map((result) => result.path);
      assert(discoveredPaths.includes("./tree"));
      assert(discoveredPaths.includes("./tree/child/deep"));
      const searched = await invoke(alpha, "search_files", {
        path: "/root/tree",
        text: "needle",
        maxResults: 1,
      });
      assertEquals((searched.results as unknown[]).length, 1);
      assertEquals(searched.truncated, true);

      const visionTools = new Map(
        (await new VisionFeature().createTools()).map((tool) => [
          tool.name,
          tool,
        ]),
      );
      const invokeVision = async (env: RuntimeEnv, args: unknown) => {
        const tool = visionTools.get("view_image") as ToolDefinition<
          AgentRunDeps
        >;
        const value = await tool.execute({
          deps: {
            agentId: env.agentId,
            provider: "openai-compatible",
            model: "test-model",
            runtime: env,
            cwd: "/root",
            control: {},
          },
        } as never, args);
        return unwrapObservedToolResult(value);
      };

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf '\\211PNG\\r\\n\\032\\n' > /root/photo.png",
      ]);
      const viewed = (await invokeVision(alpha, {
        path: "/root/photo.png",
      })).result as {
        type: string;
        mimeType: string;
        data: Uint8Array;
      };
      assertEquals(viewed.type, "binary");
      assertEquals(viewed.mimeType, "image/png");
      assertEquals(
        viewed.data,
        new Uint8Array([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
        ]),
      );

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'not an image' > /root/not-image.bin",
      ]);
      await assertRejects(
        () => invokeVision(alpha, { path: "/root/not-image.bin" }),
        Error,
        "The file is not a supported image.",
      );

      await assertRejects(
        () => invokeVision(alpha, { path: "/root/missing.png" }),
        Error,
        "The image path does not exist.",
      );
      await assertRejects(
        () => invokeVision(alpha, { path: "/root/tree" }),
        Error,
        "The image path is not a regular file.",
      );
      await alpha.exec([
        "/bin/bash",
        "-c",
        "head -c 209715201 /dev/zero > /root/huge.bin",
      ]);
      await assertRejects(
        () => invokeVision(alpha, { path: "/root/huge.bin" }),
        Error,
        "exceeds the 209715200 byte limit",
      );

      const neutralFailure = await assertRejects(
        () => invoke(alpha, "read_file", { path: "/does-not-exist" }),
      );
      const neutralMessage = neutralFailure instanceof Error
        ? neutralFailure.message
        : String(neutralFailure);
      assert(!neutralMessage.includes(shared));
      assert(!neutralMessage.includes(runtime.hostName));

      const httpTool = (await new HttpFeature().createTools())[0];
      const httpValue = await httpTool.execute({
        deps: {
          agentId: alpha.agentId,
          provider: "openai-compatible",
          model: "test-model",
          runtime: alpha,
          cwd: "/root",
          control: {},
        },
      } as never, { url: "https://example.com" });
      const httpResult = unwrapObservedToolResult(httpValue).result as Record<
        string,
        unknown
      >;
      assertEquals(httpResult.status, 200);
      assert(String(httpResult.body).includes("Example Domain"));
    } finally {
      await runtime.purge();
      await Deno.remove(shared, { recursive: true });
    }
  },
});

Deno.test({
  name: "Docker runtime reuses config state and purges only the selected agent",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-persistence-test-",
    });
    const project = resolve(shared, "persistent-config.yaml");
    const first = new DockerRuntimeManager(
      shared,
      "agent-runtime:test",
      undefined,
      { project },
    );
    let second: DockerRuntimeManager | undefined;
    try {
      const alpha = await first.createEnv("alpha");
      const firstWrite = await alpha.exec([
        "/bin/bash",
        "-c",
        "printf persistent > /root/persistent-marker; " +
        "printf '\\nexport AGENT_PERSISTED=yes\\n' >> /root/.bashrc",
      ]);
      assertEquals(firstWrite.exitCode, 0, JSON.stringify(firstWrite));

      await alpha.destroy();
      await first.stop();
      const stopped = await new Deno.Command("docker.exe", {
        args: ["inspect", "--format", "{{.State.Status}}", first.hostName],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(stopped.success, new TextDecoder().decode(stopped.stderr));
      assertEquals(new TextDecoder().decode(stopped.stdout).trim(), "exited");

      second = new DockerRuntimeManager(
        shared,
        "agent-runtime:test",
        undefined,
        { project },
      );
      assertEquals(second.hostName, first.hostName);
      assertEquals(second.dataVolumeName, first.dataVolumeName);

      const restoredAlpha = await second.createEnv("alpha");
      const restored = await restoredAlpha.exec([
        "/bin/bash",
        "--login",
        "-c",
        'cat /root/persistent-marker; test "$AGENT_PERSISTED" = yes',
      ]);
      assertEquals(restored.exitCode, 0, JSON.stringify(restored));
      assert(restored.stdout.includes("persistent"));

      const beta = await second.createEnv("beta");
      const betaWrite = await beta.exec([
        "/bin/bash",
        "-c",
        "printf beta > /root/beta-marker; test ! -e /root/persistent-marker",
      ]);
      assertEquals(betaWrite.exitCode, 0, JSON.stringify(betaWrite));

      await second.purgeEnv("alpha");
      const cleanAlpha = await second.createEnv("alpha");
      const alphaWasReset = await cleanAlpha.exec([
        "/bin/bash",
        "-c",
        "test ! -e /root/persistent-marker",
      ]);
      assertEquals(alphaWasReset.exitCode, 0, JSON.stringify(alphaWasReset));
      const betaSurvived = await beta.exec([
        "/bin/bash",
        "-c",
        'test "$(cat /root/beta-marker)" = beta',
      ]);
      assertEquals(betaSurvived.exitCode, 0, JSON.stringify(betaSurvived));
    } finally {
      await (second ?? first).purge().catch(() => {});
      await Deno.remove(shared, { recursive: true });
    }
  },
});

Deno.test({
  name: "Docker agent environment updates apt and installs a package privately",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-apt-test-",
    });
    const runtime = new DockerRuntimeManager(
      shared,
      "agent-runtime:apt-test",
      `agent-runtime-apt-test-${crypto.randomUUID()}`,
    );
    try {
      const alpha = await runtime.createEnv("apt-alpha");
      const beta = await runtime.createEnv("apt-beta");
      const devices = await alpha.exec([
        "/bin/bash",
        "-c",
        "test -c /dev/null && test -c /dev/urandom && test -d /dev/pts && test -d /dev/shm && printf ok > /dev/null && printf private > /dev/shm/alpha-only",
      ]);
      assertEquals(devices.exitCode, 0, JSON.stringify(devices));

      const installed = await alpha.exec(
        [
          "/bin/bash",
          "-c",
          "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends jq && jq --version",
        ],
        { timeoutMs: 10 * 60_000 },
      );
      assertEquals(installed.exitCode, 0, JSON.stringify(installed));
      assert(installed.stdout.includes("jq-"), JSON.stringify(installed));

      const isolated = await beta.exec([
        "/bin/bash",
        "-c",
        "! command -v jq && test ! -e /usr/bin/jq && test ! -e /dev/shm/alpha-only",
      ]);
      assertEquals(isolated.exitCode, 0, JSON.stringify(isolated));
    } finally {
      await runtime.purge();
      await Deno.remove(shared, { recursive: true });
    }
  },
});

/**
 * Drives `chroot-exec` from a real pty the way `docker exec -t` does: the
 * harness process is a session leader whose pty is the controlling terminal.
 */
const interactivePtyProbe = `
import os, pty, select, sys, time

agent = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("runtime-host", [
        "runtime-host", "chroot-exec", agent,
        "--command-id", "8d1f2c8e-0000-4000-8000-000000000000",
        "--cwd", "/", "--", "/bin/bash",
    ])

def drain(seconds):
    out = b""
    while True:
        ready, _, _ = select.select([fd], [], [], seconds)
        if not ready:
            return out
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            return out
        if not chunk:
            return out
        out += chunk

def send(data, seconds=0.6):
    os.write(fd, data)
    time.sleep(seconds)
    return drain(0.05)

output = drain(1.5)
output += send(b"tty\\n")
output += send(b"exec 9<>/dev/tty && echo DEVTTY ok\\n")
output += send(b"python3 -c 'import sys,time;print(12345,flush=True);time.sleep(300)'\\n")
deadline = time.time() + 10
while b"12345" not in output and time.time() < deadline:
    output += drain(0.1)
output += send(b"\\x03")
output += send(b"echo RC=$?\\n")
output += send(b"exit\\n")
output += drain(0.5)
sys.stdout.write(output.decode("utf-8", "replace"))
`;

Deno.test({
  name: "Docker agent attach keeps the caller's controlling terminal",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-attach-test-",
    });
    const runtime = new DockerRuntimeManager(
      shared,
      "agent-runtime:test",
      `agent-runtime-attach-test-${crypto.randomUUID()}`,
    );
    try {
      const alpha = await runtime.createEnv("attach-alpha");
      assertEquals(alpha.agentId, "attach-alpha");
      const probe = new Deno.Command("docker.exe", {
        args: [
          "exec",
          "--interactive",
          runtime.hostName,
          "python3",
          "-",
          "attach-alpha",
        ],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = probe.stdin.getWriter();
      await writer.write(new TextEncoder().encode(interactivePtyProbe));
      await writer.close();
      const result = await probe.output();
      const output = new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr);
      assertEquals(result.code, 0, output);
      assert(output.includes("/dev/pts/"), output);
      assert(output.includes("DEVTTY ok"), output);
      // 130 proves the tty delivered SIGINT to the foreground job, which in
      // turn requires the shell to own the terminal and job control.
      assert(output.includes("RC=130"), output);
    } finally {
      await runtime.purge();
      await Deno.remove(shared, { recursive: true });
    }
  },
});
