/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { assertEquals } from "@std/assert";
import { HttpFeature, unwrapObservedToolResult } from "../mod.ts";
import type { CommandOptions, CommandResult, RuntimeEnv } from "../types.ts";

function runtimeFor(body: Uint8Array): RuntimeEnv {
  return {
    agentId: "alpha",
    prepare: () => Promise.resolve(),
    exec: (
      _command: string | string[],
      _options?: CommandOptions,
    ): Promise<CommandResult> =>
      Promise.resolve({
        exitCode: 0,
        stdout: `200\nhttps://example.test/final\n${
          btoa("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n")
        }\n${btoa(String.fromCharCode(...body))}\n`,
        stderr: "",
        timedOut: false,
        aborted: false,
      }),
    destroy: () => Promise.resolve(),
    reset: () => Promise.resolve(),
  };
}

async function request(body: Uint8Array): Promise<Record<string, unknown>> {
  const tool = (await new HttpFeature().createTools())[0];
  const value = await tool.execute({
    deps: {
      agentId: "alpha",
      provider: "openai-compatible",
      model: "test-model",
      runtime: runtimeFor(body),
      cwd: "/root",
      control: {},
    },
  } as never, { url: "https://example.test/start" });
  return unwrapObservedToolResult(value).result as Record<string, unknown>;
}

Deno.test("HTTP decoding keeps text when the clip splits a UTF-8 character", async () => {
  const body = new Uint8Array(65_538);
  body.fill(0x61, 0, 65_535);
  body.set([0xe2, 0x82, 0xac], 65_535);
  const result = await request(body);
  assertEquals(result.bodyEncoding, "utf-8");
  assertEquals(String(result.body).length, 65_535);
  assertEquals(result.truncated, true);
  assertEquals(result.bodyBytesReturned, 65_536);
});

Deno.test("HTTP decoding falls back to base64 for a complete non-UTF-8 body", async () => {
  const result = await request(new Uint8Array([0x68, 0x69, 0xff]));
  assertEquals(result.bodyEncoding, "base64");
  assertEquals(result.truncated, false);
  assertEquals(
    String(result.body),
    btoa(String.fromCharCode(0x68, 0x69, 0xff)),
  );
});

Deno.test("HTTP decoding treats an empty body as UTF-8 text", async () => {
  const result = await request(new Uint8Array(0));
  assertEquals(result.bodyEncoding, "utf-8");
  assertEquals(result.body, "");
});
