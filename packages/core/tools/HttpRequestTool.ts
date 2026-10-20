/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import type { Feature } from "../Feature.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
} from "../ToolSupport.ts";

const HttpParameters = z.object({
  url: z.string().optional().describe(
    "The HTTP or HTTPS URL to request. Required for execution.",
  ),
  method: z.string().optional().describe(
    "The HTTP method. Defaults to GET when body is absent and POST when body is present.",
  ),
  headers: z.record(z.string(), z.string()).optional().describe(
    "Request headers as name-value pairs. Defaults to no additional headers.",
  ),
  body: z.string().optional().describe(
    "The request body sent exactly as provided. Omit it for a request without a body.",
  ),
});

const HTTP_SCRIPT = String.raw`
headers_file=$(mktemp) body_file=$(mktemp) err_file=$(mktemp)
trap 'rm -f "$headers_file" "$body_file" "$err_file"' EXIT
set +e
curl --silent --show-error --location --max-redirs 5 --max-time 120 \
  --dump-header "$headers_file" --write-out '%{stderr}\n%{http_code}\n%{url_effective}' \
  "$@" 2> "$err_file" | head -c 1048577 > "$body_file"
# Copy PIPESTATUS before any assignment replaces it.
statuses=("$${"{"}PIPESTATUS[@]}")
code=$${"{"}statuses[0]}
head_code=$${"{"}statuses[1]}
set -e
if test "$head_code" -ne 0; then
  printf 'the response body could not be captured\n'
  exit 50
fi
if test "$code" -ne 0 && test "$code" -ne 23; then
  head -n 1 "$err_file"
  exit 49
fi
tail -n 2 "$err_file"; printf '\n'
base64 -w0 "$headers_file"; printf '\n'
base64 -w0 "$body_file"; printf '\n'
`;

/** Optional structured convenience interface for ordinary HTTP requests. */
export class HttpFeature implements Feature<AgentRunDeps> {
  readonly id = "http";
  readonly description = "Make HTTP requests.";

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const { tool } = await import("@vibesjs/sdk");
    return [tool<AgentRunDeps, typeof HttpParameters>({
      name: "http_request",
      description:
        "Make an HTTP request. Follows up to 5 redirects and waits up to 120 seconds. Returns status, final URL, selected response headers, a bounded body, bodyEncoding, bodyBytes, bodyBytesReturned, truncated, and captureTruncated. The response body is captured up to 1048576 bytes and at most 65536 bytes are returned; bodyBytes counts captured bytes, bodyBytesReturned counts the bytes included, and truncated reports that the returned body is incomplete. A base64 bodyEncoding means the included bytes are not UTF-8 text.",
      parameters: HttpParameters,
      argsValidator: (input) => {
        if (!input.url?.trim()) {
          throw actionableToolError(
            [
              "No URL was provided.",
              "Provide the HTTP or HTTPS URL to request in url.",
            ],
          );
        }
        let parsed: URL;
        try {
          parsed = new URL(input.url);
        } catch {
          throw actionableToolError([
            "The URL is malformed.",
            "No HTTP request was sent.",
            "Provide a complete HTTP or HTTPS URL, for example https://example.com/path.",
          ]);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw actionableToolError([
            "The URL must use HTTP or HTTPS.",
            "No HTTP request was sent.",
            "Use an http:// or https:// URL.",
          ]);
        }
        if (input.method !== undefined && !/^[A-Za-z]+$/.test(input.method)) {
          throw actionableToolError([
            "The HTTP method is invalid.",
            "No HTTP request was sent.",
            "Use letters only, for example GET, POST, PATCH, or DELETE.",
          ]);
        }
        if (
          input.headers &&
          Object.keys(input.headers).some((name) => !name.trim())
        ) {
          throw actionableToolError([
            "A request header has an empty name.",
            "No HTTP request was sent.",
            "Provide a non-empty header name or remove that header.",
          ]);
        }
      },
      execute: async (context, input) => {
        const url = input.url!;
        const method =
          (input.method ?? (input.body === undefined ? "GET" : "POST"))
            .toUpperCase();
        const args = [
          "/bin/bash",
          "-c",
          HTTP_SCRIPT,
          "http_request",
          "--request",
          method,
        ];
        for (const [name, value] of Object.entries(input.headers ?? {})) {
          args.push("--header", `${name}: ${value}`);
        }
        if (input.body !== undefined) args.push("--data-binary", "@-");
        args.push("--", url);
        let raw;
        try {
          raw = await context.deps.runtime.exec(args, {
            cwd: context.deps.cwd,
            signal: context.deps.signal,
            timeoutMs: 130_000,
            stdin: input.body,
          });
        } catch (error) {
          throw new ToolExecutionError("The HTTP request failed.", { error });
        }
        if (raw.exitCode === 50) {
          throw actionableToolError([
            "The response was received but its body could not be captured.",
            "Retry the request; if it persists, check free space in this computer.",
          ], { command: raw });
        }
        if (raw.exitCode !== 0) {
          const detail = raw.stdout.split(/\r?\n/).map((line) => line.trim())
            .find(Boolean);
          throw actionableToolError(
            [
              "No HTTP response was received.",
              ...(detail ? [`The request failed: ${detail}`] : []),
              ...(detail ? [] : [
                "If the request timed out, the 120-second limit was reached.",
              ]),
              "Check the URL, method, headers, and network availability before retrying.",
            ],
            { command: raw },
          );
        }
        const [
          statusLine = "0",
          effectiveUrl = url,
          headers64 = "",
          body64 = "",
        ] = raw.stdout.split("\n");
        let headerText: string;
        let bodyBytes: Uint8Array;
        try {
          headerText = decodeBase64(headers64);
          const binary = atob(body64.trim());
          bodyBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        } catch {
          throw actionableToolError(
            [
              "The HTTP response could not be read.",
              "Retry the request; if it persists, use shell with curl to inspect the raw response.",
            ],
            { command: raw },
          );
        }
        const responseLimit = 1_048_576;
        const modelLimit = 65_536;
        const captureTruncated = bodyBytes.length > responseLimit;
        const available = bodyBytes.slice(
          0,
          Math.min(responseLimit, modelLimit),
        );
        const clipped = available.length < bodyBytes.length;
        const body = decodeBody(available, clipped);
        const result = {
          status: Number(statusLine),
          url: effectiveUrl,
          headers: relevantHeaders(headerText),
          body: body.value,
          bodyEncoding: body.encoding,
          bodyBytes: Math.min(bodyBytes.length, responseLimit),
          bodyBytesReturned: available.length,
          truncated: clipped,
          captureTruncated,
        };
        return observedToolResult(result, {
          command: raw,
          response: {
            status: result.status,
            url: effectiveUrl,
            headers: headerText,
            body: decodeBody(bodyBytes.slice(0, responseLimit), captureTruncated),
            truncated: captureTruncated,
          },
        });
      },
    })];
  }
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value.trim()), (char) => char.charCodeAt(0)),
  );
}

function decodeBody(
  bytes: Uint8Array,
  clipped: boolean,
): { value: string; encoding: "utf-8" | "base64" } {
  if (bytes.length === 0) return { value: "", encoding: "utf-8" };
  // Binary payloads are the ones carrying NUL bytes; UTF-8 text never does.
  if (bytes.includes(0)) return { value: toBase64(bytes), encoding: "base64" };
  // A clipped body can end mid-character. Drop up to three trailing bytes and
  // decode the valid prefix instead of declaring a text response binary. A
  // complete body with invalid bytes stays base64 rather than losing its tail.
  const attempts = clipped ? 4 : 1;
  for (let trim = 0; trim < attempts && trim < bytes.length; trim++) {
    try {
      return {
        value: new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytes.length - trim),
        ),
        encoding: "utf-8",
      };
    } catch {
      // Try one byte shorter.
    }
  }
  return { value: toBase64(bytes), encoding: "base64" };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function relevantHeaders(source: string): Record<string, string> {
  const allowed = new Set([
    "content-type",
    "content-length",
    "location",
    "cache-control",
    "etag",
    "last-modified",
  ]);
  const blocks = source.replaceAll("\r", "").trim().split("\n\n");
  const result: Record<string, string> = {};
  for (const line of (blocks.at(-1) ?? "").split("\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (allowed.has(name)) result[name] = line.slice(separator + 1).trim();
  }
  return result;
}
