/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import type { AgentRunDeps } from "./Agent.ts";
import type { Feature } from "./Feature.ts";
import type { CommandResult } from "./types.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
} from "./ToolSupport.ts";

const PathParameter = z.string().optional().describe(
  "The file path for this operation. Required for execution. Use an absolute path or a path relative to the current working directory.",
);
const ReadParameters = z.object({
  path: PathParameter,
  offset: z.number().int().nonnegative().optional().describe(
    "The zero-based byte offset at which to begin reading. Defaults to 0.",
  ),
  limit: z.number().int().positive().max(262_144).optional().describe(
    "The maximum number of bytes to read. Defaults to 65536 and cannot exceed 262144.",
  ),
});
const WriteParameters = z.object({
  path: PathParameter,
  content: z.string().optional().describe(
    "The complete text to write. Required for execution. Provide multiline text directly with normal line breaks; do not replace line breaks with literal backslash-n text.",
  ),
  mode: z.enum(["create", "overwrite", "append"]).optional().describe(
    "Use create for a new file, overwrite to replace an entire existing file, or append to add content to its end. Defaults to create, which refuses to replace an existing path. The parent directory must already exist.",
  ),
  force: z.boolean().optional().describe(
    "Set force true with mode overwrite to confirm intentional replacement of the file's complete contents. Prefer edit_file for one small exact replacement or apply_patch for larger or multiple changes. Defaults to false.",
  ),
});
const EditParameters = z.object({
  path: PathParameter,
  oldText: z.string().max(8_192).optional().describe(
    "The exact text to replace, including normal line breaks when matching multiple lines. It must occur exactly once unless replaceAll is true.",
  ),
  newText: z.string().max(8_192).optional().describe(
    "The replacement text. Provide multiline text directly with normal line breaks. Use an empty string to delete the matched text.",
  ),
  replaceAll: z.boolean().optional().describe(
    "Set true to replace every exact match. Defaults to false, which requires the old text to occur exactly once.",
  ),
});
const PatchParameters = z.object({
  patch: z.string().optional().describe(
    `The complete unified diff as multiline text. Required for execution. Paths must be relative to cwd and normally use a/ and b/ prefixes. Every hunk line must begin with a space for unchanged context, '-' for removal, or '+' for addition, and the hunk line counts must match. Example:
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 first
 second
+third`,
  ),
  cwd: z.string().min(1).optional().describe(
    "The directory from which patch paths are resolved, as an absolute path or a path relative to the current working directory. Defaults to the current working directory.",
  ),
});
const ListParameters = z.object({
  path: z.string().min(1).optional().describe(
    "The directory to list, as an absolute path or a path relative to the current working directory. Defaults to the current working directory.",
  ),
});
const SearchParameters = z.object({
  path: z.string().min(1).optional().describe(
    "The directory to search recursively, as an absolute path or a path relative to the current working directory. Defaults to the current working directory.",
  ),
  name: z.string().min(1).optional().describe(
    "A case-sensitive filename glob, such as '*.ts'. Defaults to '*' when neither name nor text is provided. When text is also provided, only matching filenames are searched for that text.",
  ),
  text: z.string().min(1).optional().describe(
    "Case-sensitive literal text to find in files. This is not a regular expression.",
  ),
  maxResults: z.number().int().positive().max(200).optional().describe(
    "The maximum number of results to return. Defaults to 50 and cannot exceed 200.",
  ),
});

const READ_SCRIPT = String.raw`
path=$1 offset=$2 limit=$3
test -e "$path" || exit 40
test -f "$path" || exit 41
size=$(stat -Lc %s -- "$path") || exit 42
printf '%s\n' "$size"
dd if="$path" bs=1 skip="$offset" count="$limit" status=none | base64 -w0
`;

const WRITE_SCRIPT = String.raw`
path=$1 mode=$2
parent=$(dirname -- "$path")
test -d "$parent" || exit 43
if test -e "$path" && ! test -f "$path"; then exit 41; fi
if test "$mode" = create; then
  test ! -e "$path" || exit 54
  (set -o noclobber; cat > "$path") || exit 54
elif test "$mode" = append; then
  cat >> "$path"
else
  cat > "$path"
fi
`;

const EDIT_SCRIPT = String.raw`
path=$1 old64=$2 new64=$3 all=$4
test -e "$path" || exit 40
test -f "$path" || exit 41
test "$(stat -Lc %s -- "$path")" -le 4194304 || exit 47
if od -An -v -t u1 -- "$path" | grep -qw 0; then exit 50; fi
old=$(printf '%s' "$old64" | base64 -d; printf x); old=$${"{"}old%x}
new=$(printf '%s' "$new64" | base64 -d; printf x); new=$${"{"}new%x}
content=$(cat -- "$path"; printf x); content=$${"{"}content%x}
rest=$content count=0
while test "$${"{"}rest#*"$old"}" != "$rest"; do
  count=$((count + 1)); rest=$${"{"}rest#*"$old"}
done
test "$count" -gt 0 || exit 44
if test "$all" != true && test "$count" -ne 1; then exit 45; fi
if test "$all" = true; then output=$${"{"}content//"$old"/"$new"}; replacements=$count
else output=$${"{"}content/"$old"/"$new"}; replacements=1; fi
printf '%s' "$output" > "$path" || exit 46
printf '%s\n' "$replacements"
`;

const PATCH_SCRIPT = String.raw`
patch_file=$(mktemp) || exit 53
trap 'rm -f "$patch_file"' EXIT
cat > "$patch_file" || exit 53
apply_mode=()
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || apply_mode=(--no-index)
eof_mode=()
git apply "$${"{"}apply_mode[@]}" --check --recount --whitespace=nowarn -- "$patch_file" >/dev/null 2>&1 || eof_mode=(--inaccurate-eof)
git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --check --recount --whitespace=nowarn -- "$patch_file" || exit 51
git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --numstat -- "$patch_file" || exit 51
git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --recount --whitespace=nowarn -- "$patch_file" || exit 52
`;

const LIST_SCRIPT = String.raw`
path=$1
test -e "$path" || exit 40
test -d "$path" || exit 48
find "$path" -mindepth 1 -maxdepth 1 -printf '%f\0%y\0%s\0'
`;

const SEARCH_NAME_SCRIPT = String.raw`
path=$1 pattern=$2 limit=$3
test -e "$path" || exit 40
test -d "$path" || exit 48
find "$path" -mindepth 1 -name "$pattern" -printf '%p\0%y\0' | head -z -n "$((2 * (limit + 1)))"
`;

const SEARCH_TEXT_SCRIPT = String.raw`
path=$1 pattern=$2 limit=$3 name=$4
test -e "$path" || exit 40
test -d "$path" || exit 48
if test -n "$name"; then
  find "$path" -type f -name "$name" -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
else
  find "$path" -type f -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
fi | head -n "$((limit + 1))"
`;

/** Structured convenience interfaces for ordinary filesystem operations. */
export class FilesystemFeature implements Feature<AgentRunDeps> {
  readonly id = "filesystem";
  readonly description = "Use files and directories.";

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const { tool } = await import("@vibesjs/sdk");
    return [
      tool<AgentRunDeps, typeof PatchParameters>({
        name: "apply_patch",
        description:
          "Apply a unified diff to files. For one small exact replacement, prefer edit_file; prefer apply_patch for changes spanning multiple regions or files. Set cwd to the directory containing the patched paths, use matching relative '--- a/path' and '+++ b/path' headers, and use exact '@@' hunk counts. The complete patch is checked before files are changed. Returns changed paths and addition/deletion counts.",
        parameters: PatchParameters,
        argsValidator: (input) => {
          if (!input.patch?.trim()) {
            throw actionableToolError(
              "No patch was provided.",
              "Provide the complete unified diff in patch.",
            );
          }
        },
        execute: async (context, input) => {
          const patch = input.patch!.endsWith("\n")
            ? input.patch!
            : `${input.patch!}\n`;
          const raw = await execute(
            context.deps,
            ["/bin/bash", "-c", PATCH_SCRIPT, "apply_patch"],
            patch,
            input.cwd,
          );
          const changes = raw.stdout.split("\n").filter(Boolean).map((line) => {
            const [additions = "0", deletions = "0", ...path] = line.split(
              "\t",
            );
            return {
              path: path.join("\t"),
              additions: additions === "-" ? undefined : Number(additions),
              deletions: deletions === "-" ? undefined : Number(deletions),
            };
          });
          const result = { filesChanged: changes.length, changes };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof WriteParameters>({
        name: "write_file",
        description:
          "Create a new file without replacing an existing one, append content, or explicitly replace a file's complete contents. Do NOT use this as a general-purpose text editor; prefer edit_file for one small exact replacement or apply_patch for larger or multiple changes. Returns the path, bytesWritten, and mode.",
        parameters: WriteParameters,
        argsValidator: validateWriteArguments,
        execute: async (context, input) => {
          validateWriteArguments(input);
          const mode = input.mode ?? "create";
          const content = input.content!;
          const raw = await execute(context.deps, [
            "/bin/bash",
            "-c",
            WRITE_SCRIPT,
            "write_file",
            input.path!,
            mode,
          ], content);
          const result = {
            path: input.path!,
            bytesWritten: new TextEncoder().encode(content).length,
            mode,
          };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof EditParameters>({
        name: "edit_file",
        description:
          "Make a precise exact-text change to a text file. Prefer edit_file for one small exact replacement; prefer apply_patch for changes spanning multiple regions or files. A missing match fails; multiple matches fail unless replaceAll is true. Returns the path and number of replacements.",
        parameters: EditParameters,
        argsValidator: validateEditArguments,
        execute: async (context, input) => {
          const oldText = input.oldText!;
          const newText = input.newText!;
          const encode = (value: string) =>
            btoa(String.fromCharCode(...new TextEncoder().encode(value)));
          const raw = await execute(context.deps, [
            "/bin/bash",
            "-c",
            EDIT_SCRIPT,
            "edit_file",
            input.path!,
            encode(oldText),
            encode(newText),
            String(input.replaceAll ?? false),
          ]);
          const replacements = Number(raw.stdout.trim());
          const result = { path: input.path!, replacements };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof ReadParameters>({
        name: "read_file",
        description:
          "Read a bounded section of a UTF-8 text file. Returns content, offset, bytesRead, sizeBytes, truncated, and nextOffset when more data remains.",
        parameters: ReadParameters,
        argsValidator: (input) => requirePath(input.path, "read"),
        execute: async (context, input) => {
          const offset = input.offset ?? 0;
          const limit = input.limit ?? 65_536;
          const command = [
            "/bin/bash",
            "-c",
            READ_SCRIPT,
            "read_file",
            input.path!,
            String(offset),
            String(limit),
          ];
          const raw = await execute(context.deps, command);
          const [sizeLine = "0", encoded = ""] = raw.stdout.split("\n", 2);
          const sizeBytes = Number(sizeLine);
          let bytes: Uint8Array;
          try {
            bytes = Uint8Array.from(
              atob(encoded.trim()),
              (char) => char.charCodeAt(0),
            );
          } catch {
            throw actionableToolError(
              "The file contents could not be decoded.",
              "Use shell for binary data or retry read_file with a valid text file.",
              { command: raw },
            );
          }
          if (bytes.includes(0)) {
            throw actionableToolError(
              "The file is not suitable for text reading.",
              "Use shell for binary data or choose a UTF-8 text file.",
              { command: raw },
            );
          }
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw actionableToolError(
              "The file is not suitable for text reading.",
              "Use shell for binary data or choose a UTF-8 text file.",
              { command: raw },
            );
          }
          const truncated = offset + bytes.length < sizeBytes;
          const result = {
            path: input.path!,
            content,
            offset,
            bytesRead: bytes.length,
            sizeBytes,
            truncated,
            ...(truncated ? { nextOffset: offset + bytes.length } : {}),
          };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof ListParameters>({
        name: "list_directory",
        description:
          "List the immediate contents of a directory without recursive traversal. Returns each entry's name, type, and sizeBytes.",
        parameters: ListParameters,
        execute: async (context, input) => {
          const path = input.path ?? ".";
          const raw = await execute(context.deps, [
            "/bin/bash",
            "-c",
            LIST_SCRIPT,
            "list_directory",
            path,
          ]);
          const fields = raw.stdout.split("\0");
          if (fields.at(-1) === "") fields.pop();
          const entries = [];
          for (let index = 0; index + 2 < fields.length; index += 3) {
            entries.push({
              name: fields[index],
              type: fileType(fields[index + 1]),
              sizeBytes: Number(fields[index + 2]),
            });
          }
          entries.sort((left, right) => left.name.localeCompare(right.name));
          const result = { path, entries };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof SearchParameters>({
        name: "search_files",
        description:
          "Search recursively beneath a directory by filename glob, literal file text, or both. Returns bounded path results; text matches include line numbers and snippets. The result reports whether more matches were truncated.",
        parameters: SearchParameters,
        execute: async (context, input) => {
          const path = input.path ?? ".";
          const maxResults = input.maxResults ?? 50;
          const raw = input.text
            ? await execute(context.deps, [
              "/bin/bash",
              "-c",
              SEARCH_TEXT_SCRIPT,
              "search_files",
              path,
              input.text,
              String(maxResults),
              input.name ?? "",
            ])
            : await execute(context.deps, [
              "/bin/bash",
              "-c",
              SEARCH_NAME_SCRIPT,
              "search_files",
              path,
              input.name ?? "*",
              String(maxResults),
            ]);
          const parsed = input.text
            ? parseTextMatches(raw.stdout)
            : parseNameMatches(raw.stdout);
          const truncated = parsed.length > maxResults;
          const results = parsed.slice(0, maxResults);
          const result = { path, results, truncated };
          return observedToolResult(result, { command: raw, result });
        },
      }),
    ];
  }
}

function requirePath(
  path: string | undefined,
  operation: string,
): asserts path is string {
  if (path?.trim()) return;
  throw actionableToolError(
    "No file path was provided.",
    `Provide the file to ${operation} in path.`,
  );
}

function validateWriteArguments(input: z.infer<typeof WriteParameters>): void {
  requirePath(input.path, "write");
  if (input.content === undefined) {
    throw actionableToolError(
      "No file content was provided.",
      "Provide the complete text to write in content. Use an empty string to write an empty file.",
    );
  }
  if (input.mode === "overwrite" && input.force !== true) {
    throw actionableToolError(
      "Replacing the complete file requires explicit confirmation.",
      "Prefer edit_file for one small exact replacement or apply_patch for larger or multiple changes. To intentionally replace the complete file, set mode to overwrite and force to true.",
    );
  }
}

function validateEditArguments(input: z.infer<typeof EditParameters>): void {
  requirePath(input.path, "edit");
  if (!input.oldText) {
    throw actionableToolError(
      "No exact text to replace was provided.",
      "Provide the existing text in oldText. oldText cannot be empty.",
    );
  }
  if (input.newText === undefined) {
    throw actionableToolError(
      "No replacement text was provided.",
      "Provide the replacement in newText. Use an empty string to delete the matched text.",
    );
  }
}

async function execute(
  deps: AgentRunDeps,
  command: string[],
  stdin?: string,
  cwd = deps.cwd,
): Promise<CommandResult> {
  let raw: CommandResult;
  try {
    raw = await deps.runtime.exec(command, {
      cwd,
      signal: deps.signal,
      timeoutMs: 120_000,
      stdin,
    });
  } catch (error) {
    throw new ToolExecutionError("The operation failed.", { error });
  }
  if (raw.exitCode === 0) return raw;
  const failures: Record<number, readonly [string, string]> = {
    40: [
      "The path does not exist.",
      "Check the path or list its parent directory to find the correct name.",
    ],
    41: [
      "The path is not a regular file.",
      "Choose a file path; use list_directory when the path is a directory.",
    ],
    43: [
      "The parent directory does not exist.",
      "Create the parent directory with shell or choose an existing directory, then retry.",
    ],
    44: [
      "The requested text was not found.",
      "Read the current file, copy the exact text to oldText, and retry.\nIf the intended change is still local but exact replacement is awkward, use apply_patch with surrounding context rather than rewriting the file.",
    ],
    45: [
      "The requested text occurs more than once.",
      "Provide more surrounding text to identify one occurrence, or set replaceAll to true to replace every exact match.\nIf the intended change is still local but exact replacement is awkward, use apply_patch with surrounding context rather than rewriting the file.",
    ],
    47: [
      "The file is too large for edit_file.",
      "Use apply_patch for a precise change or shell for an appropriate large-file operation.",
    ],
    48: [
      "The path is not a directory.",
      "Choose a directory path or use read_file when the path is a file.",
    ],
    50: [
      "The file is not suitable for text editing.",
      "Use shell for binary data or choose a UTF-8 text file.",
    ],
    51: [
      "The patch does not match the current files.",
      "Read the current files, correct the paths and exact hunk context, then retry.",
    ],
    52: [
      "The checked patch could not be applied.",
      "Read the affected files to confirm their current state, regenerate the patch, and retry.",
    ],
    53: [
      "The patch could not be processed.",
      "Provide a complete unified diff with valid file headers and hunk lines, then retry.",
    ],
    54: [
      "The file already exists.",
      "Use edit_file for one exact replacement, apply_patch for larger or multiple changes, append to add content, or mode overwrite with force true to intentionally replace the complete file. Overwrite should be avoided for general-purpose text editing.",
    ],
  };
  const failure = failures[raw.exitCode ?? -1];
  if (failure) {
    throw actionableToolError(failure[0], failure[1], { command: raw });
  }
  throw neutralError("The operation failed.", raw);
}

function neutralError(
  message: string,
  command: CommandResult,
): ToolExecutionError {
  return new ToolExecutionError(message, { command });
}

function fileType(code: string): "file" | "directory" | "symlink" | "other" {
  return code === "f"
    ? "file"
    : code === "d"
    ? "directory"
    : code === "l"
    ? "symlink"
    : "other";
}

function parseNameMatches(
  value: string,
): Array<{ path: string; type: string }> {
  const fields = value.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const matches = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    matches.push({ path: fields[index], type: fileType(fields[index + 1]) });
  }
  return matches;
}

function parseTextMatches(
  value: string,
): Array<{ path: string; line: number; snippet: string }> {
  return value.split("\n").filter(Boolean).map((entry) => {
    const match = /^(.*?):(\d+):(.*)$/.exec(entry);
    return match
      ? {
        path: match[1],
        line: Number(match[2]),
        snippet: match[3].slice(0, 500),
      }
      : { path: "", line: 0, snippet: entry.slice(0, 500) };
  });
}
