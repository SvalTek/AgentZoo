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
headers_file=$(mktemp) body_file=$(mktemp) meta_file=$(mktemp)
trap 'rm -f "$headers_file" "$body_file" "$meta_file"' EXIT
set +e
curl --silent --show-error --location --max-redirs 5 --max-time 120 \
  --dump-header "$headers_file" --write-out '%{stderr}\n%{http_code}\n%{url_effective}' \
  "$@" 2> "$meta_file" | head -c 1048577 > "$body_file"
code=$${"{"}PIPESTATUS[0]}
set -e
if test "$code" -ne 0 && test "$code" -ne 23; then exit 49; fi
tail -n 2 "$meta_file"; printf '\n'
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
        "Make an HTTP request. Follows up to 5 redirects and waits up to 120 seconds. Returns status, final URL, selected response headers, a bounded body, bodyEncoding, bodyBytes, and truncation status. A base64 bodyEncoding means the returned body is base64-encoded binary data.",
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
        if (raw.exitCode !== 0) {
          throw actionableToolError(
            [
              "No HTTP response was received.",
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
        const responseTruncated = bodyBytes.length > responseLimit;
        const available = bodyBytes.slice(
          0,
          Math.min(responseLimit, modelLimit),
        );
        const body = decodeBody(available);
        const result = {
          status: Number(statusLine),
          url: effectiveUrl,
          headers: relevantHeaders(headerText),
          body: body.value,
          bodyEncoding: body.encoding,
          bodyBytes: Math.min(bodyBytes.length, responseLimit),
          truncated: responseTruncated || bodyBytes.length > modelLimit,
        };
        return observedToolResult(result, {
          command: raw,
          response: {
            status: result.status,
            url: effectiveUrl,
            headers: headerText,
            body: decodeBody(bodyBytes.slice(0, responseLimit)),
            truncated: responseTruncated,
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
): { value: string; encoding: "utf-8" | "base64" } {
  try {
    return {
      value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8_192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
    }
    return { value: btoa(binary), encoding: "base64" };
  }
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
