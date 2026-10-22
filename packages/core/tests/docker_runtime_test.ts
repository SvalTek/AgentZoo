import { assert, assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { buildRuntimeImage, DockerRuntimeManager } from "../Runtime.ts";
import { RuntimeHostClient } from "../RuntimeHostClient.ts";
import { FilesystemFeature } from "../tools/FilesystemTools.ts";
import { ShellFeature } from "../tools/ShellTool.ts";
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

      const envLeak = await alpha.exec([
        "/bin/bash",
        "-c",
        "tr '\\0' '\\n' </proc/1/environ | grep -c '^AGENTZOO_RUNTIME_TOKEN=' || true",
      ]);
      assertEquals(envLeak.stdout.trim(), "0");

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
        byteOffset: 2,
        byteLimit: 3,
      });
      assertEquals(bounded.content, "iva");
      assertEquals(bounded.truncated, true);
      assertEquals(bounded.nextByteOffset, 5);

      await assertRejects(
        () =>
          invoke(alpha, "read_file", {
            path: "/root/private-tool",
            offset: 2,
          }),
        Error,
        "no longer read_file parameters",
      );

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'one\ntwo\nthree\n' > /root/lines.txt",
      ]);
      const linesPage = await invoke(alpha, "read_file", {
        path: "/root/lines.txt",
        startLine: 2,
        lineLimit: 1,
      });
      assertEquals(linesPage.content, "two\n");
      assertEquals(linesPage.startLine, 2);
      assertEquals(linesPage.totalLines, 3);
      assertEquals(linesPage.truncated, true);
      assertEquals(linesPage.nextLine, 3);

      await invoke(alpha, "write_file", {
        path: "/root/empty.txt",
        content: "",
      });
      const emptyRead = await invoke(alpha, "read_file", {
        path: "/root/empty.txt",
      });
      assertEquals(emptyRead.content, "");
      assertEquals(emptyRead.totalLines, 0);
      assertEquals(emptyRead.truncated, false);

      // A lexical path that resolves through a symlink into the agent's /proc
      // mount is invisible to the host; the tool must fall back to exec.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "ln -sfn /proc /root/proc-link",
      ]);
      const mounts = await invoke(alpha, "read_file", {
        path: "/root/proc-link/mounts",
      });
      assert(String(mounts.content).includes("overlay"));

      const hostListing = await invoke(alpha, "list_directory", {
        path: "/root",
      });
      const hostListingNames = (hostListing.entries as Array<{ name: string }>)
        .map((entry) => entry.name);
      assert(
        hostListingNames.includes("private-tool"),
        JSON.stringify(hostListingNames),
      );

      const hostNameMatches = await invoke(alpha, "search_files", {
        path: "/root",
        name: "private-*",
      });
      assert(
        (hostNameMatches.results as Array<{ path: string }>).some((result) =>
          result.path.endsWith("/private-tool")
        ),
        JSON.stringify(hostNameMatches.results),
      );

      const hostTextMatches = await invoke(alpha, "search_files", {
        path: "/root",
        text: "private-data",
      });
      assert(
        (hostTextMatches.results as Array<{ path: string; line: number }>)
          .some((result) =>
            result.path.endsWith("/private-tool") && result.line === 1
          ),
        JSON.stringify(hostTextMatches.results),
      );

      const otherRootEntries = await invoke(beta, "list_directory", {
        path: "/root",
      });
      assert(
        !(otherRootEntries.entries as Array<{ name: string }>).some((entry) =>
          entry.name === "private-tool"
        ),
        JSON.stringify(otherRootEntries.entries),
      );

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
      const idempotent = await invoke(alpha, "write_file", {
        path: "/root/written",
        content: "one-two",
      });
      assertEquals(idempotent.sizeBytes, 7);
      assert(String(idempotent.message).includes("identical"));
      await assertRejects(
        () =>
          invoke(alpha, "write_file", {
            path: "/root/written",
            content: "accidental replacement",
          }),
        Error,
        "the file already exists.",
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
      // A failed write must not be reported as success just because the file
      // can still be stat-ed afterwards.
      await assertRejects(
        () =>
          invoke(alpha, "write_file", {
            path: "/proc/self/status",
            content: "not writable",
            mode: "append",
          }),
        Error,
        "The write did not complete",
      );

      await invoke(alpha, "write_file", {
        path: "/root/editable",
        content: "same same",
      });
      await invoke(alpha, "write_file", {
        path: "/root/dollar.txt",
        content: "prefix foo suffix\n",
      });
      const dollarEdit = await invoke(alpha, "edit_file", {
        path: "/root/dollar.txt",
        oldText: "foo",
        newText: "$&-bar $1",
      });
      assertEquals(dollarEdit.replacements, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/dollar.txt"])).stdout,
        "prefix $&-bar $1 suffix\n",
      );

      const largeContent = "x".repeat(1_500_000);
      const largeWrite = await invoke(alpha, "write_file", {
        path: "/root/large.txt",
        content: largeContent,
      });
      assertEquals(largeWrite.sizeBytes, largeContent.length);
      assertEquals(
        (await alpha.exec(["/bin/stat", "-c", "%s", "/root/large.txt"])).stdout
          .trim(),
        String(largeContent.length),
      );

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf '\\357\\273\\277hello world\\n' > /root/bom.txt; printf '\\357\\273\\277alpha\\nbeta\\n' > /root/bom-patch.txt",
      ]);
      await invoke(alpha, "edit_file", {
        path: "/root/bom.txt",
        oldText: "world",
        newText: "there",
      });
      assertEquals(
        (await alpha.exec([
          "/usr/bin/od",
          "-An",
          "-tx1",
          "-N3",
          "/root/bom.txt",
        ]))
          .stdout.replaceAll(/\s+/g, ""),
        "efbbbf",
      );

      await invoke(alpha, "apply_patch", {
        patch: [
          "--- a/bom-patch.txt",
          "+++ b/bom-patch.txt",
          "@@ -1,2 +1,2 @@",
          "-alpha",
          "+ALPHA",
          " beta",
        ].join("\n"),
      });
      assertEquals(
        (await alpha.exec([
          "/usr/bin/od",
          "-An",
          "-tx1",
          "-N3",
          "/root/bom-patch.txt",
        ]))
          .stdout.replaceAll(/\s+/g, ""),
        "efbbbf",
      );

      await invoke(alpha, "write_file", {
        path: "/root/mode-file",
        content: "before",
      });
      await alpha.exec(["/bin/chmod", "640", "/root/mode-file"]);
      await invoke(alpha, "write_file", {
        path: "/root/mode-file",
        content: "mode kept",
        mode: "overwrite",
        force: true,
      });
      assertEquals(
        (await alpha.exec(["/bin/stat", "-c", "%a", "/root/mode-file"])).stdout
          .trim(),
        "640",
      );

      const missingEdit = await assertRejects(
        () =>
          invoke(alpha, "edit_file", {
            path: "/root/editable",
            oldText: "missing",
            newText: "x",
          }),
        Error,
        "The requested text was not found",
      );
      assert(String(missingEdit.message).includes("The file has"));
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

      // A hunk with leading context only, in the shape the parameter
      // description documents, must apply mid-file.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'one\\ntwo\\nthree\\nfour\\n' > /root/midpatch.txt",
      ]);
      const midPatched = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/midpatch.txt",
          "+++ b/midpatch.txt",
          "@@ -2,1 +2,2 @@",
          " two",
          "+inserted",
        ].join("\n"),
      });
      assertEquals(midPatched.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/midpatch.txt"])).stdout,
        "one\ntwo\ninserted\nthree\nfour\n",
      );

      // Multiple files in one patch using only ---/+++ headers.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'aaa\\n' > /root/multi1.txt; printf 'bbb\\n' > /root/multi2.txt",
      ]);
      const multiPatched = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/multi1.txt",
          "+++ b/multi1.txt",
          "@@ -1 +1 @@",
          "-aaa",
          "+AAA",
          "--- a/multi2.txt",
          "+++ b/multi2.txt",
          "@@ -1 +1 @@",
          "-bbb",
          "+BBB",
        ].join("\n"),
      });
      assertEquals(multiPatched.filesChanged, 2);
      assertEquals(
        (multiPatched.changes as Array<{ path: string }>).map((change) =>
          change.path
        ),
        ["multi1.txt", "multi2.txt"],
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/multi1.txt"])).stdout,
        "AAA\n",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/multi2.txt"])).stdout,
        "BBB\n",
      );

      // Deletions, including a CRLF file patched with LF text.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'gone\\r\\nline\\r\\n' > /root/delete-crlf.txt; printf 'plain\\n' > /root/delete-lf.txt",
      ]);
      const deleted = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/delete-crlf.txt",
          "+++ /dev/null",
          "@@ -1,2 +0,0 @@",
          "-gone",
          "-line",
          "--- a/delete-lf.txt",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-plain",
        ].join("\n"),
      });
      assertEquals(deleted.filesChanged, 2);
      assertEquals(
        deleted.changes,
        [
          { path: "delete-crlf.txt", additions: 0, deletions: 2 },
          { path: "delete-lf.txt", additions: 0, deletions: 1 },
        ],
      );
      const removed = await alpha.exec([
        "/bin/bash",
        "-c",
        "test ! -e /root/delete-crlf.txt && test ! -e /root/delete-lf.txt",
      ]);
      assertEquals(removed.exitCode, 0, JSON.stringify(removed));

      // A patch that fails on its second file must leave the first untouched:
      // everything is validated in memory before any write.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'ok\\n' > /root/atomic-a.txt; printf 'original\\n' > /root/atomic-b.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/atomic-a.txt",
              "+++ b/atomic-a.txt",
              "@@ -1 +1 @@",
              "-ok",
              "+changed",
              "--- a/atomic-b.txt",
              "+++ b/atomic-b.txt",
              "@@ -1 +1 @@",
              "-missing",
              "+other",
            ].join("\n"),
          }),
        Error,
        "does not match",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/atomic-a.txt"])).stdout,
        "ok\n",
      );

      // A hunk that matches two regions is rejected; more context fixes it.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'keep\\nsame\\nkeep\\nsame\\n' > /root/ambiguous.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/ambiguous.txt",
              "+++ b/ambiguous.txt",
              "@@ -1,2 +1,2 @@",
              " keep",
              "-same",
              "+CHANGED",
            ].join("\n"),
          }),
        Error,
        "matches 2 places",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/ambiguous.txt"])).stdout,
        "keep\nsame\nkeep\nsame\n",
      );
      const disambiguated = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/ambiguous.txt",
          "+++ b/ambiguous.txt",
          "@@ -1,3 +1,3 @@",
          " keep",
          "-same",
          "+CHANGED",
          " keep",
        ].join("\n"),
      });
      assertEquals(disambiguated.filesChanged, 1);

      // A deletion section must remove every line, and an insertion needs an
      // unchanged line to locate it.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'one\\ntwo\\n' > /root/partial-delete.txt; printf 'alpha\\nbeta\\n' > /root/insert-only.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/partial-delete.txt",
              "+++ /dev/null",
              "@@ -1,1 +0,0 @@",
              "-one",
            ].join("\n"),
          }),
        Error,
        "does not delete all",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/partial-delete.txt"])).stdout,
        "one\ntwo\n",
      );
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/insert-only.txt",
              "+++ b/insert-only.txt",
              "@@ -1,0 +2,1 @@",
              "+inserted",
            ].join("\n"),
          }),
        Error,
        "has no context",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/insert-only.txt"])).stdout,
        "alpha\nbeta\n",
      );

      // Blank context lines arrive from the parser as empty strings and must
      // still anchor the hunk.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'alpha\\n\\nbeta\\n' > /root/blank-context.txt",
      ]);
      const blankContext = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/blank-context.txt",
          "+++ b/blank-context.txt",
          "@@ -1,3 +1,4 @@",
          " alpha",
          "",
          "+inserted",
          " beta",
        ].join("\n"),
      });
      assertEquals(blankContext.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/blank-context.txt"])).stdout,
        "alpha\n\ninserted\nbeta\n",
      );

      // Creating a file must not replace one that already exists.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'precious\\n' > /root/exists.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- /dev/null",
              "+++ b/exists.txt",
              "@@ -0,0 +1,1 @@",
              "+replacement",
            ].join("\n"),
          }),
        Error,
        "already exists",
      );
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/exists.txt"])).stdout,
        "precious\n",
      );
      await alpha.exec([
        "/bin/bash",
        "-c",
        "mkdir -p /root/create-target",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- /dev/null",
              "+++ b/create-target",
              "@@ -0,0 +1,1 @@",
              "+x",
            ].join("\n"),
          }),
        Error,
        "already exists",
      );

      // A patch whose own lines use CRLF must apply too.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'alpha\\r\\nbeta\\r\\ngamma\\r\\n' > /root/crlf-patch.txt",
      ]);
      const crlfPatch = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/crlf-patch.txt",
          "+++ b/crlf-patch.txt",
          "@@ -1,3 +1,3 @@",
          " alpha",
          "-beta",
          "+BETA",
          " gamma",
        ].join("\r\n"),
      });
      assertEquals(crlfPatch.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/crlf-patch.txt"])).stdout,
        "alpha\r\nBETA\r\ngamma\r\n",
      );

      // A later hunk may be unique only after an earlier hunk changed the text.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'one\\na\\nb\\ntwo\\na\\nb\\n' > /root/later.txt",
      ]);
      const later = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/later.txt",
          "+++ b/later.txt",
          "@@ -1,4 +1,4 @@",
          " one",
          " a",
          "-b",
          "+B",
          " two",
          "@@ -5,2 +5,2 @@",
          " a",
          "-b",
          "+B2",
        ].join("\n"),
      });
      assertEquals(later.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/later.txt"])).stdout,
        "one\na\nB\ntwo\na\nB2\n",
      );

      // Replacing the final line of a file without a trailing newline.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'a\\nb' > /root/no-eol.txt",
      ]);
      const noEol = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/no-eol.txt",
          "+++ b/no-eol.txt",
          "@@ -1,2 +1,2 @@",
          " a",
          "-b",
          "+c",
          "\\ No newline at end of file",
        ].join("\n"),
      });
      assertEquals(noEol.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/no-eol.txt"])).stdout,
        "a\nc",
      );

      // A patch path may not leave the working directory.
      await alpha.exec(["/bin/bash", "-c", "printf 'x\\n' > /root/noop.txt"]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/../escape.txt",
              "+++ b/../escape.txt",
              "@@ -1 +1 @@",
              "-x",
              "+y",
            ].join("\n"),
          }),
        Error,
        "leaves the working directory",
      );

      // A context block that only occurs inside a longer line is not a match.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'xa\\nb\\nc\\n' > /root/midline.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/midline.txt",
              "+++ b/midline.txt",
              "@@ -1,2 +1,2 @@",
              " a",
              "-b",
              "+B",
            ].join("\n"),
          }),
        Error,
        "does not match",
      );

      // Deleting an empty file is still a change.
      await alpha.exec([
        "/bin/bash",
        "-c",
        ": > /root/empty-delete.txt",
      ]);
      const emptyDelete = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/empty-delete.txt",
          "+++ /dev/null",
          "@@ -0,0 +0,0 @@",
        ].join("\n"),
      });
      assertEquals(emptyDelete.filesChanged, 1);
      const emptyGone = await alpha.exec([
        "/bin/bash",
        "-c",
        "test ! -e /root/empty-delete.txt",
      ]);
      assertEquals(emptyGone.exitCode, 0, JSON.stringify(emptyGone));

      // Absolute patch paths are not applied outside the working directory.
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- \\etc\\hosts",
              "+++ \\etc\\hosts",
              "@@ -1 +1 @@",
              "-x",
              "+y",
            ].join("\n"),
          }),
        Error,
        "is absolute",
      );

      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- /etc/hosts",
              "+++ /etc/hosts",
              "@@ -1 +1 @@",
              "-x",
              "+y",
            ].join("\n"),
          }),
        Error,
        "is absolute",
      );

      // A symlink target is rejected rather than replaced by a regular file.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'linked\\n' > /root/link-target.txt; ln -sfn /root/link-target.txt /root/link-path.txt",
      ]);
      await assertRejects(
        () =>
          invoke(alpha, "apply_patch", {
            cwd: "/root",
            patch: [
              "--- a/link-path.txt",
              "+++ b/link-path.txt",
              "@@ -1 +1 @@",
              "-linked",
              "+changed",
            ].join("\n"),
          }),
        Error,
        "symbolic link",
      );
      const linkIntact = await alpha.exec([
        "/bin/bash",
        "-c",
        'test -L /root/link-path.txt && test "$(cat /root/link-target.txt)" = linked',
      ]);
      assertEquals(linkIntact.exitCode, 0, JSON.stringify(linkIntact));

      // Text search must not block on a symlink to a FIFO.
      await alpha.exec([
        "/bin/bash",
        "-c",
        "mkdir -p /root/search-tree; printf needle > /root/search-tree/real.txt; mkfifo /root/search-tree/pipe; ln -s pipe /root/search-tree/link-pipe",
      ]);
      const fifoSearch = await invoke(alpha, "search_files", {
        path: "/root/search-tree",
        text: "needle",
      });
      assertEquals((fifoSearch.results as unknown[]).length, 1);

      // A section that changes nothing is not reported as a change.
      const noop = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/noop.txt",
          "+++ b/noop.txt",
          "@@ -1 +1 @@",
          " x",
        ].join("\n"),
      });
      assertEquals(noop.filesChanged, 0);

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'alpha\\r\\nbeta\\r\\ngamma\\r\\n' > /root/crlf.txt",
      ]);
      await invoke(alpha, "edit_file", {
        path: "/root/crlf.txt",
        oldText: "beta",
        newText: "BETA",
      });
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/crlf.txt"])).stdout,
        "alpha\r\nBETA\r\ngamma\r\n",
      );
      const crlfPatched = await invoke(alpha, "apply_patch", {
        cwd: "/root",
        patch: [
          "--- a/crlf.txt",
          "+++ b/crlf.txt",
          "@@ -1,3 +1,3 @@",
          " alpha",
          "-BETA",
          "+delta",
          " gamma",
        ].join("\n"),
      });
      assertEquals(crlfPatched.filesChanged, 1);
      assertEquals(
        (await alpha.exec(["/bin/cat", "/root/crlf.txt"])).stdout,
        "alpha\r\ndelta\r\ngamma\r\n",
      );

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
      await alpha.exec([
        "/bin/bash",
        "-c",
        "mkdir -p /root/real-dir && touch /root/real-dir/inner && ln -sfn /root/real-dir /root/linked-dir",
      ]);
      const linkedListing = await invoke(alpha, "list_directory", {
        path: "/root/linked-dir",
      });
      assertEquals(
        (linkedListing.entries as Array<{ name: string }>).map((entry) =>
          entry.name
        ),
        ["inner"],
      );
      const discovered = await invoke(alpha, "search_files", {
        maxResults: 200,
      });
      const discoveredPaths = (
        discovered.results as Array<{ path: string }>
      ).map((result) => result.path);
      // The agent root also holds files created by earlier assertions, so
      // match the discovered paths by suffix rather than exact text.
      assert(
        discoveredPaths.some((entry) =>
          entry.endsWith("/tree") || entry === "./tree"
        ),
      );
      assert(
        discoveredPaths.some((entry) =>
          entry.endsWith("/tree/child/deep") || entry === "./tree/child/deep"
        ),
      );
      const searched = await invoke(alpha, "search_files", {
        path: "/root/tree",
        text: "needle",
        maxResults: 1,
      });
      assertEquals((searched.results as unknown[]).length, 1);
      assertEquals(searched.truncated, true);

      const shellTools = new Map(
        (await new ShellFeature().createTools()).map((tool) => [
          tool.name,
          tool,
        ]),
      );
      const invokeShell = async (
        env: RuntimeEnv,
        name: string,
        args: unknown,
      ) => {
        const tool = shellTools.get(name) as ToolDefinition<AgentRunDeps>;
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
      await invokeShell(alpha, "start_background", {
        name: "bg-finished",
        command: "echo bg-output-line",
      });
      let background: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 100; attempt++) {
        background = await invokeShell(alpha, "get_background", {
          name: "bg-finished",
        });
        if (background.found === true && background.alive === false) break;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
      // A finished background process keeps its pane, so the output and exit
      // status stay available instead of reading as an unknown session.
      assertEquals(background.found, true, JSON.stringify(background));
      assertEquals(background.alive, false, JSON.stringify(background));
      assertEquals(background.exitCode, 0, JSON.stringify(background));
      assert(
        String(background.output).includes("bg-output-line"),
        JSON.stringify(background),
      );
      assertEquals(
        (await invokeShell(alpha, "stop_background", { name: "bg-finished" }))
          .status,
        "stopped",
      );
      assertEquals(
        (await invokeShell(alpha, "get_background", { name: "bg-finished" }))
          .found,
        false,
      );

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

Deno.test({
  name: "Docker agent terminal devices stay inside their own environment",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-pts-test-",
    });
    const runtime = new DockerRuntimeManager(
      shared,
      "agent-runtime:test",
      `agent-runtime-pts-test-${crypto.randomUUID()}`,
    );
    try {
      const alpha = await runtime.createEnv("pts-alpha");
      const beta = await runtime.createEnv("pts-beta");
      // A pty allocated inside alpha's chroot must come from alpha's own
      // devpts instance, so no sibling agent can name or open it.
      const holder = alpha.exec([
        "/bin/bash",
        "-c",
        "script -q -e -c 'sleep 2' /dev/null",
      ]);
      // `ptmx` is always present; wait for an actual pty node.
      let alphaListing = "";
      for (let attempt = 0; attempt < 100; attempt++) {
        alphaListing = (await alpha.exec(["/bin/bash", "-c", "ls -A /dev/pts"]))
          .stdout;
        if (
          alphaListing.split("\n").some((entry) =>
            /^[0-9]+$/.test(entry.trim())
          )
        ) break;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
      assert(
        alphaListing.split("\n").some((entry) => /^[0-9]+$/.test(entry.trim())),
        `alpha should see its own pty: ${JSON.stringify(alphaListing)}`,
      );
      const betaListing = await beta.exec([
        "/bin/bash",
        "-c",
        "ls -A /dev/pts",
      ]);
      assertEquals(betaListing.stdout.trim(), "ptmx");
      await holder;
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

async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

async function connectRuntimeHost(
  runtime: DockerRuntimeManager,
): Promise<RuntimeHostClient> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const endpoint = runtime.runtimeHostEndpoint();
    if (endpoint) {
      try {
        return await RuntimeHostClient.connect(endpoint, { timeoutMs: 1_000 });
      } catch (error) {
        lastError = error;
      }
    }
    await delay(200);
  }
  throw new Error(
    `runtime host service did not become reachable: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

Deno.test({
  name: "Docker runtime exposes the resident runtime host service",
  ignore: !dockerIntegrationEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shared = await Deno.makeTempDir({
      prefix: "agent-zoo-runtime-host-test-",
    });
    const runtime = new DockerRuntimeManager(
      shared,
      "agent-runtime:test",
      `agent-runtime-host-test-${crypto.randomUUID()}`,
    );
    let client: RuntimeHostClient | undefined;
    try {
      const alpha = await runtime.createEnv("host-alpha");
      client = await connectRuntimeHost(runtime);

      const ping = await client.request("ping");
      assertEquals(ping.result.protocol, 1);

      const logFile = runtime.runtimeLogFile();
      let log = "";
      const logDeadline = Date.now() + 3_000;
      while (Date.now() < logDeadline) {
        log = await Deno.readTextFile(logFile).catch(() => "");
        if (log.includes("listening")) break;
        await delay(50);
      }
      assert(log.includes("listening"), `empty runtime host log: ${logFile}`);

      await alpha.exec([
        "/bin/bash",
        "-c",
        "printf 'one\\ntwo\\n' > /root/host-lines.txt",
      ]);
      const lines = await client.request("fs.read", "host-alpha", {
        path: "/root/host-lines.txt",
        unit: "lines",
        startLine: 1,
        lineLimit: 1,
      });
      assertEquals(new TextDecoder().decode(lines.payload), "one\n");
      assertEquals(lines.result.nextLine, 2);

      const listing = await client.request("fs.list", "host-alpha", {
        path: "/root",
      });
      const names = (listing.result.entries as Array<{ name: string }>).map(
        (entry) => entry.name,
      );
      assert(names.includes("host-lines.txt"), JSON.stringify(names));

      const search = await client.request("fs.search", "host-alpha", {
        path: "/root",
        kind: "text",
        text: "two",
      });
      assert(
        (search.result.results as Array<{ path: string; line: number }>).some(
          (result) =>
            result.path === "/root/host-lines.txt" && result.line === 2,
        ),
        JSON.stringify(search.result),
      );

      // The service binary lives outside every agent root.
      const hidden = await alpha.exec([
        "/bin/bash",
        "-c",
        "test ! -e /usr/local/bin/agentzoo-runtime-host",
      ]);
      assertEquals(hidden.exitCode, 0, JSON.stringify(hidden));

      const events: string[][] = [];
      const subscription = await client.subscribe(
        "host-alpha",
        { path: "/root", depth: 1, debounceMs: 50 },
        (event) => {
          if (Array.isArray(event.paths)) events.push(event.paths as string[]);
        },
      );
      try {
        await alpha.exec([
          "/bin/bash",
          "-c",
          "printf x > /root/watched.txt",
        ]);
        const deadline = Date.now() + 5_000;
        while (
          !events.some((paths) => paths.includes("/root/watched.txt")) &&
          Date.now() < deadline
        ) {
          await delay(50);
        }
        assert(
          events.some((paths) => paths.includes("/root/watched.txt")),
          JSON.stringify(events),
        );
      } finally {
        subscription.close();
      }
    } finally {
      client?.close();
      await runtime.purge().catch(() => undefined);
      await Deno.remove(shared, { recursive: true });
    }
  },
});
