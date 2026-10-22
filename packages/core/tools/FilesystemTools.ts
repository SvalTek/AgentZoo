/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
import { applyPatch, parsePatch } from "npm:diff@8";
import { TextTemplate } from "@agent-zoo/shared";
import { z } from "zod";
import type { AgentRunDeps } from "../Agent.ts";
import type { Feature } from "../Feature.ts";
import type { CommandResult } from "../types.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
  type ToolFeedback,
} from "../ToolSupport.ts";
import { relative as relativePath } from "@std/path/posix";
import { resolveRuntimeDirectory } from "./RuntimePaths.ts";
import { RuntimeFilesError } from "../RuntimeHostFiles.ts";

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
chunk=$(mktemp) || exit 52
trap 'rm -f "$chunk"' EXIT
dd if="$path" bs=1 skip="$offset" count="$limit" status=none > "$chunk" || exit 51
base64 -w0 "$chunk"
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
  cat >> "$path" || exit 55
else
  cat > "$path" || exit 55
fi
stat -Lc %s -- "$path"
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
# Match and replace in the file's own line endings: a model that sees CRLF
# text through read_file may send either form, and the edited region must not
# end up with mixed endings.
case "$content" in
  *$'\r\n'*)
    old=$${"{"}old//$'\r\n'/$'\n'}; old=$${"{"}old//$'\n'/$'\r\n'}
    new=$${"{"}new//$'\r\n'/$'\n'}; new=$${"{"}new//$'\n'/$'\r\n'}
    ;;
esac
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

const READ_TEXT_SCRIPT = String.raw`
path=$1 limit=$2
test -e "$path" || exit 40
test -f "$path" || exit 41
size=$(stat -Lc %s -- "$path") || exit 42
test "$size" -le "$limit" || exit 43
stat -Lc %a -- "$path" || exit 42
base64 -w0 -- "$path" || exit 44
`;

const PATH_KIND_SCRIPT = String.raw`
path=$1
if test -L "$path"; then printf "symlink\\n"; exit 0; fi
if test -d "$path"; then printf "directory\\n"; exit 0; fi
if test -e "$path"; then printf "exists\\n"; exit 0; fi
printf "missing\\n"
`;

/**
 * Write content to a temporary file in the target directory.
 *
 * `action` is either `copy` (preserve an existing target's mode and owner) or
 * `mode:<perm>` (a new file or a restore, which must not rely on the current
 * on-disk target).
 */
const WRITE_TEMP_SCRIPT = String.raw`
target=$1 action=$2
dir=$(dirname -- "$target")
test -d "$dir" || exit 43
tmp=$(mktemp "$dir/.agentzoo-patch.XXXXXX") || exit 55
case "$action" in
  copy) cp -p -- "$target" "$tmp" || { rm -f "$tmp"; exit 55; } ;;
  mode:*) chmod "$${"{"}action#mode:}" "$tmp" || { rm -f "$tmp"; exit 55; } ;;
esac
base64 -d > "$tmp" || { rm -f "$tmp"; exit 55; }
printf '%s\n' "$tmp"
`;

const LIST_SCRIPT = String.raw`
path=$1
test -e "$path" || exit 40
test -d "$path" || exit 48
find -H "$path" -mindepth 1 -maxdepth 1 -printf '%f\0%y\0%s\0'
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
  find "$path" -xtype f -name "$name" -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
else
  find "$path" -xtype f -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
fi | head -n "$((limit + 1))"
`;

/** Structured convenience interfaces for ordinary filesystem operations. */
export class FilesystemFeature implements Feature<AgentRunDeps> {
  readonly id = "filesystem";
  readonly description = "Use files and directories.";
  readonly systemPrompt = new TextTemplate(`## Filesystem tools

Use these structured tools for ordinary file and directory work instead of shell.

- Inspect with list_directory, read_file, or search_files.
- Create a new complete file with write_file.
- Make one exact, known text replacement with edit_file.
- Use apply_patch for related changes across multiple regions or files. Read the current contents first and build the patch from that state.
- Use shell for commands and operations, not to avoid structured text-file edits.`);

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const { tool } = await import("@vibesjs/sdk");
    const writeFailures: Record<number, ToolFeedback> = {
      41: [
        "No bytes were written: the path is not a regular file.",
        "Choose a file path.",
      ],
      43: [
        "No bytes were written: the parent directory does not exist.",
        "Create the parent directory or choose an existing directory.",
      ],
      54: [
        "No bytes were written: the file already exists.",
        "create is only for a new file.",
        "For a local change, read the file and use edit_file; for related changes, use apply_patch.",
        "Use overwrite only for an intended complete replacement.",
      ],
      55: [
        "The write did not complete: the file could not be written.",
        "The disk may be full or the path may be read-only.",
        "A complete replacement may have truncated or partially written the file; read it before retrying.",
      ],
    };
    const editFailures: Record<number, ToolFeedback> = {
      40: [
        "No files were changed: the path does not exist.",
        "Check the path or list its parent directory.",
      ],
      41: [
        "No files were changed: the path is not a regular file.",
        "Choose a file path.",
      ],
      44: [
        "No files were changed.",
        "The requested text was not found in the current file.",
        "Read the current file and copy the exact text into oldText.",
        "If several related edits are needed, rebuild one apply_patch from current content.",
      ],
      45: [
        "No files were changed.",
        "The requested text occurs more than once.",
        "Provide more surrounding text to identify one occurrence, or set replaceAll to true to replace every exact match.",
        "For several related edits, rebuild one apply_patch from current content.",
      ],
      47: [
        "No files were changed: the file is too large for edit_file.",
        "Use apply_patch for a precise change or shell for an appropriate large-file operation.",
      ],
      50: [
        "No files were changed: the file is not suitable for text editing.",
        "Use shell for binary data or choose a UTF-8 text file.",
      ],
    };
    const readFailures: Record<number, ToolFeedback> = {
      40: [
        "The path does not exist.",
        "Check the path or list its parent directory to find the correct name.",
      ],
      41: [
        "The path is not a regular file.",
        "Choose a file path; use list_directory when the path is a directory.",
      ],
      42: [
        "The file size could not be read.",
        "Use shell to inspect the path when the file metadata is unavailable.",
      ],
      51: [
        "No bytes were read: the file could not be read.",
        "Check the file permissions or use shell for files this computer cannot read.",
      ],
      52: [
        "No bytes were read: the read could not be prepared.",
        "Retry the read, or use shell when the problem persists.",
      ],
    };
    const directoryFailures: Record<number, ToolFeedback> = {
      40: [
        "The path does not exist.",
        "Check the path or list its parent directory to find the correct name.",
      ],
      48: [
        "The path is not a directory.",
        "Choose a directory path or use read_file when the path is a file.",
      ],
    };
    return [
      tool<AgentRunDeps, typeof PatchParameters>({
        name: "apply_patch",
        description:
          "Apply a unified diff to files. For one small exact replacement, prefer edit_file; prefer apply_patch for changes spanning multiple regions or files. Set cwd to the directory containing the patched paths, and use matching relative '--- a/path' and '+++ b/path' headers. Hunk line counts must match. A hunk may begin or end with a changed line; trailing context is not required, but a hunk's context must identify one unique location. Patch lines are matched in the file's own line endings, so a LF patch edits a CRLF file without mixing endings. Every affected file is read and patched in memory first; if any hunk or write fails, earlier writes are rolled back. Returns changed paths (relative to cwd) and addition/deletion counts.",
        parameters: PatchParameters,
        argsValidator: (input) => {
          if (!input.patch?.trim()) {
            throw actionableToolError(
              [
                "No patch was provided.",
                "Provide the complete unified diff in patch.",
              ],
            );
          }
          if (
            !/^---\s+\S+/m.test(input.patch!) ||
            !/^\+\+\+\s+\S+/m.test(input.patch!)
          ) {
            throw actionableToolError([
              "The patch has no complete unified-diff file header.",
              "No files were changed.",
              "Include matching --- and +++ file-header lines before any hunk.",
            ]);
          }
        },
        execute: async (context, input) => {
          const cwd = resolveRuntimeDirectory(context.deps.cwd, input.cwd);
          const staged = await stagePatch(context.deps, input.patch!, cwd);
          const written = await commitPatch(context.deps, staged);
          const changes = [...staged.values()].map((file) => ({
            path: relativeToDirectory(cwd, file.path),
            additions: file.additions,
            deletions: file.deletions,
          }));
          const result = {
            filesChanged: changes.length,
            changes,
            message:
              "Patch applied. Its previous file context is now stale; read or test before another related edit.",
          };
          return observedToolResult(result, { ...written, result });
        },
      }),
      tool<AgentRunDeps, typeof WriteParameters>({
        name: "write_file",
        description:
          "Create a new file without replacing an existing one, append content, or explicitly replace a file's complete contents. Do NOT use this as a general-purpose text editor; prefer edit_file for one small exact replacement or apply_patch for larger or multiple changes. Returns the path, mode, bytesWritten (bytes sent by this call, not the resulting file size), sizeBytes (the file afterwards), and a message.",
        parameters: WriteParameters,
        argsValidator: validateWriteArguments,
        execute: async (context, input) => {
          validateWriteArguments(input);
          const mode = input.mode ?? "create";
          const content = input.content!;
          const raw = await execute(
            context.deps,
            [
              "/bin/bash",
              "-c",
              WRITE_SCRIPT,
              "write_file",
              input.path!,
              mode,
            ],
            content,
            undefined,
            writeFailures,
          );
          const result = {
            path: input.path!,
            bytesWritten: new TextEncoder().encode(content).length,
            sizeBytes: Number(raw.stdout.trim()),
            mode,
            message: mode === "overwrite"
              ? "Complete file replacement finished. Read or test this file before another write."
              : "Write finished.",
          };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof EditParameters>({
        name: "edit_file",
        description:
          "Make a precise exact-text change to a text file. Prefer edit_file for one small exact replacement; prefer apply_patch for changes spanning multiple regions or files. A missing match fails; multiple matches fail unless replaceAll is true. Line endings are matched in the file's own convention, so LF and CRLF forms of oldText both work. Returns the path and number of replacements.",
        parameters: EditParameters,
        argsValidator: validateEditArguments,
        execute: async (context, input) => {
          const oldText = input.oldText!;
          const newText = input.newText!;
          const encode = (value: string) =>
            btoa(String.fromCharCode(...new TextEncoder().encode(value)));
          const raw = await execute(
            context.deps,
            [
              "/bin/bash",
              "-c",
              EDIT_SCRIPT,
              "edit_file",
              input.path!,
              encode(oldText),
              encode(newText),
              String(input.replaceAll ?? false),
            ],
            undefined,
            undefined,
            editFailures,
          );
          const replacements = Number(raw.stdout.trim());
          const result = {
            path: input.path!,
            replacements,
            message:
              "Exact replacement finished. The oldText from this call is no longer current; read or test before another related edit.",
          };
          return observedToolResult(result, { command: raw, result });
        },
      }),
      tool<AgentRunDeps, typeof ReadParameters>({
        name: "read_file",
        description:
          "Read a bounded section of a UTF-8 text file. offset, limit, and nextOffset are byte positions: offset is the zero-based byte at which reading starts, limit is the maximum number of bytes, and nextOffset is the offset to pass to continue when truncated is true. Returns content, offset, bytesRead, sizeBytes, truncated, and nextOffset while more data remains.",
        parameters: ReadParameters,
        argsValidator: (input) => requirePath(input.path, "read"),
        execute: async (context, input) => {
          const offset = input.offset ?? 0;
          const limit = input.limit ?? 65_536;
          const files = context.deps.runtime.files;
          if (files) {
            const target = resolveRuntimeDirectory(
              context.deps.cwd,
              input.path!,
            );
            try {
              const read = await files.readBytes(target, offset, limit);
              const result = {
                path: input.path!,
                content: new TextDecoder().decode(read.bytes),
                offset: read.offset,
                bytesRead: read.bytes.length,
                sizeBytes: read.sizeBytes,
                truncated: read.truncated,
                ...(read.nextOffset === undefined
                  ? {}
                  : { nextOffset: read.nextOffset }),
              };
              return observedToolResult(result, { host: "fs.read", result });
            } catch (error) {
              throwHostFailure(error, {
                not_found: readFailures[40],
                not_a_file: readFailures[41],
                range: [
                  "No bytes were read: offset is beyond the end of the file.",
                  `The offset was ${offset}.`,
                  "Read from offset 0 or use an offset no greater than the file size.",
                ],
                binary: [
                  "The file is not suitable for text reading.",
                  "Use shell for binary data or choose a UTF-8 text file.",
                ],
                invalid_utf8: [
                  "The requested byte range is not valid UTF-8.",
                  "The file may be binary, or offset and limit may split a multibyte character.",
                  "Read from offset 0 or choose a different byte range before retrying.",
                ],
                too_large: [
                  "The requested byte range is too large for one response.",
                  "Reduce limit or use shell for the file.",
                ],
                permission_denied: [
                  "The file could not be read: permission denied.",
                  "Check the file permissions or use shell for files this computer cannot read.",
                ],
                path_escape: [
                  "The path resolves outside the agent environment.",
                  "Use a path inside the environment.",
                ],
              });
              // Transport failure: fall back to the exec path below.
            }
          }
          const command = [
            "/bin/bash",
            "-c",
            READ_SCRIPT,
            "read_file",
            input.path!,
            String(offset),
            String(limit),
          ];
          const raw = await execute(
            context.deps,
            command,
            undefined,
            undefined,
            readFailures,
          );
          const [sizeLine = "0", encoded = ""] = raw.stdout.split("\n", 2);
          const sizeBytes = Number(sizeLine);
          if (offset > sizeBytes) {
            throw actionableToolError([
              "No bytes were read: offset is beyond the end of the file.",
              `The file is ${sizeBytes} bytes, but offset was ${offset}.`,
              "Read from offset 0 or use an offset no greater than the file size.",
            ], { command: raw });
          }
          let bytes: Uint8Array;
          try {
            bytes = Uint8Array.from(
              atob(encoded.trim()),
              (char) => char.charCodeAt(0),
            );
          } catch {
            throw actionableToolError(
              [
                "The file contents could not be decoded.",
                "Use shell for binary data or retry read_file with a valid text file.",
              ],
              { command: raw },
            );
          }
          if (bytes.includes(0)) {
            throw actionableToolError(
              [
                "The file is not suitable for text reading.",
                "Use shell for binary data or choose a UTF-8 text file.",
              ],
              { command: raw },
            );
          }
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw actionableToolError(
              [
                "The requested byte range is not valid UTF-8.",
                "The file may be binary, or offset and limit may split a multibyte character.",
                "Read from offset 0 or choose a different byte range before retrying.",
              ],
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
          "List the immediate contents of a directory without recursive traversal. Follows a symlinked directory when path itself is a link. Returns each entry's name, type, and sizeBytes (for a symlink, the length of its target path), plus truncated when more than 500 entries exist.",
        parameters: ListParameters,
        execute: async (context, input) => {
          const path = input.path ?? ".";
          const files = context.deps.runtime.files;
          if (files) {
            const target = resolveRuntimeDirectory(context.deps.cwd, path);
            try {
              const listing = await files.list(target, 500);
              const entries = listing.entries.map((entry) => ({
                name: entry.name,
                type: entry.type,
                sizeBytes: entry.sizeBytes ?? 0,
              }));
              const result = {
                path,
                entries,
                truncated: listing.truncated,
              };
              return observedToolResult(result, { host: "fs.list", result });
            } catch (error) {
              throwHostFailure(error, {
                not_found: directoryFailures[40],
                not_a_directory: directoryFailures[48],
                permission_denied: [
                  "The directory could not be listed: permission denied.",
                  "Check the directory permissions or use shell for paths this computer cannot read.",
                ],
                path_escape: [
                  "The path resolves outside the agent environment.",
                  "Use a path inside the environment.",
                ],
              });
              // Transport failure: fall back to the exec path below.
            }
          }
          const raw = await execute(
            context.deps,
            [
              "/bin/bash",
              "-c",
              LIST_SCRIPT,
              "list_directory",
              path,
            ],
            undefined,
            undefined,
            directoryFailures,
          );
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
          "Search recursively beneath a directory by filename glob, literal file text, or both. Text search also reads symlinked files. Results report paths exactly as the search resolved them beneath path, so an absolute path yields absolute results. Returns bounded path results; text matches include line numbers and snippets. The result reports whether more matches were truncated.",
        parameters: SearchParameters,
        execute: async (context, input) => {
          const path = input.path ?? ".";
          const maxResults = input.maxResults ?? 50;
          const files = context.deps.runtime.files;
          if (files) {
            const target = resolveRuntimeDirectory(context.deps.cwd, path);
            const name = input.name ?? (input.text ? undefined : "*");
            try {
              const search = await files.search({
                path: target,
                kind: input.text ? "text" : "name",
                ...(name === undefined ? {} : { name }),
                ...(input.text === undefined ? {} : { text: input.text }),
                maxResults,
              });
              // The host works in absolute agent paths; keep the model's
              // relative form so results match the exec transport.
              const results = path.startsWith("/")
                ? search.results
                : search.results.map((match) => ({
                  ...match,
                  path: path === "."
                    ? `./${relativePath(target, match.path)}`
                    : `${path.replace(/\/+$/, "")}/${
                      relativePath(target, match.path)
                    }`,
                }));
              const result = {
                path,
                results,
                truncated: search.truncated,
              };
              return observedToolResult(result, { host: "fs.search", result });
            } catch (error) {
              throwHostFailure(error, {
                not_found: directoryFailures[40],
                not_a_directory: directoryFailures[48],
                permission_denied: [
                  "The search could not read a path: permission denied.",
                  "Check the directory permissions or use shell for paths this computer cannot read.",
                ],
                path_escape: [
                  "The path resolves outside the agent environment.",
                  "Use a path inside the environment.",
                ],
              });
              // Transport failure: fall back to the exec path below.
            }
          }
          const raw = input.text
            ? await execute(
              context.deps,
              [
                "/bin/bash",
                "-c",
                SEARCH_TEXT_SCRIPT,
                "search_files",
                path,
                input.text,
                String(maxResults),
                input.name ?? "",
              ],
              undefined,
              undefined,
              directoryFailures,
            )
            : await execute(
              context.deps,
              [
                "/bin/bash",
                "-c",
                SEARCH_NAME_SCRIPT,
                "search_files",
                path,
                input.name ?? "*",
                String(maxResults),
              ],
              undefined,
              undefined,
              directoryFailures,
            );
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

/**
 * Surface a protocol-level host failure. Transport failures return normally so
 * the caller can continue with the exec path; only the host itself answers the
 * request (so no fallback would help) for the errors handled here.
 */
function throwHostFailure(
  error: unknown,
  feedback: Partial<Record<string, ToolFeedback>>,
): void {
  if (!(error instanceof RuntimeFilesError)) return;
  throw actionableToolError(
    feedback[error.code] ??
      ["The runtime host could not complete the operation."],
    { error: { code: error.code } },
  );
}

function requirePath(
  path: string | undefined,
  operation: string,
): asserts path is string {
  if (path?.trim()) return;
  throw actionableToolError(
    ["No file path was provided.", `Provide the file to ${operation} in path.`],
  );
}

function validateWriteArguments(input: z.infer<typeof WriteParameters>): void {
  requirePath(input.path, "write");
  if (input.content === undefined) {
    throw actionableToolError(
      [
        "No file content was provided.",
        "Provide the complete text to write in content. Use an empty string to write an empty file.",
      ],
    );
  }
  if (input.mode === "overwrite" && input.force !== true) {
    throw actionableToolError(
      [
        "Replacing the complete file requires explicit confirmation.",
        "No bytes were written.",
        "For a local change, prefer edit_file; for related changes, prefer apply_patch.",
        "Only for an intended complete replacement, set mode to overwrite and force to true.",
      ],
    );
  }
  if (input.force === true && input.mode !== "overwrite") {
    throw actionableToolError([
      "force only applies with mode overwrite.",
      "No bytes were written.",
      "Omit force for create or append, or set mode to overwrite only for an intended complete replacement.",
    ]);
  }
}

function validateEditArguments(input: z.infer<typeof EditParameters>): void {
  requirePath(input.path, "edit");
  if (!input.oldText) {
    throw actionableToolError(
      [
        "No exact text to replace was provided.",
        "Provide the existing text in oldText. oldText cannot be empty.",
      ],
    );
  }
  if (input.newText === undefined) {
    throw actionableToolError(
      [
        "No replacement text was provided.",
        "Provide the replacement in newText. Use an empty string to delete the matched text.",
      ],
    );
  }
}

async function execute(
  deps: AgentRunDeps,
  command: string[],
  stdin?: string,
  cwd = deps.cwd,
  failures: Readonly<
    Record<number, ToolFeedback | ((raw: CommandResult) => ToolFeedback)>
  > = {},
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
  const failure = failures[raw.exitCode ?? -1];
  if (failure) {
    throw actionableToolError(
      typeof failure === "function" ? failure(raw) : failure,
      { command: raw },
    );
  }
  throw new ToolExecutionError("The operation failed.", { command: raw });
}

const PATCH_FILE_LIMIT = 33_554_432;

interface StagedPatchFile {
  readonly path: string;
  /** Original text, or null when the patch creates the file. */
  readonly before: string | null;
  /** Original permission bits, used when a rollback must recreate the file. */
  readonly mode: string | null;
  /** Patched text, or null when the patch deletes the file. */
  readonly after: string | null;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Read, patch, and validate every file in memory before anything is written.
 *
 * The patch is a standard unified diff, so the application needs file contents
 * and must not depend on a Git worktree. Applying here means a context mismatch
 * or an unreadable target fails before the first byte reaches the filesystem.
 */
async function stagePatch(
  deps: AgentRunDeps,
  patch: string,
  cwd: string,
): Promise<Map<string, StagedPatchFile>> {
  // diff requires one consistent line ending, including the final line, and
  // autoConvertLineEndings adapts the result to each file. Mixed or
  // unterminated patches are normalised to LF before parsing.
  const normalizedPatch = (patch.endsWith("\n") ? patch : `${patch}\n`)
    .replaceAll("\r\n", "\n");
  let files;
  try {
    files = parsePatch(normalizedPatch);
  } catch (error) {
    throw actionableToolError([
      "No files were changed: the patch could not be parsed.",
      `The patch parser reported: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "Check the '@@' hunk header and line counts, and start every hunk line with a space, '-', or '+'.",
    ], { patch });
  }
  if (files.length === 0) {
    throw actionableToolError([
      "No files were changed: the patch contains no file sections.",
      "Provide a unified diff with matching '---' and '+++' headers.",
    ], { patch });
  }

  const staged = new Map<string, StagedPatchFile>();
  for (const file of files) {
    const oldPath = patchFilePath(file.oldFileName, cwd);
    const newPath = patchFilePath(file.newFileName, cwd);
    if (oldPath !== null && newPath !== null && oldPath !== newPath) {
      throw actionableToolError([
        "No files were changed: apply_patch does not move or rename files.",
        `The patch changes ${relativeToDirectory(cwd, oldPath)} to ${
          relativeToDirectory(cwd, newPath)
        }.`,
        "Create the new file with write_file and remove the old one, or use shell.",
      ], { patch });
    }
    const path = newPath ?? oldPath;
    if (path === null) {
      throw actionableToolError([
        "No files were changed: a file section names neither a source nor a destination.",
        "Provide '--- a/path' and '+++ b/path' headers.",
      ], { patch });
    }
    if (staged.has(path)) {
      throw actionableToolError([
        `No files were changed: the patch modifies ${
          relativeToDirectory(cwd, path)
        } more than once.`,
        "Combine the changes for that file into one section.",
      ], { patch });
    }

    let before: string | null = null;
    let mode: string | null = null;
    if (oldPath !== null) {
      const kind = await pathKind(deps, oldPath);
      if (kind === "symlink") {
        throw actionableToolError([
          `No files were changed: ${
            relativeToDirectory(cwd, oldPath)
          } is a symbolic link.`,
          "Patch the file it points to, or replace the link with shell.",
        ], { patch });
      }
      const read = await readPatchFile(deps, oldPath, cwd);
      if (read === null) {
        throw actionableToolError([
          `No files were changed: ${
            relativeToDirectory(cwd, oldPath)
          } does not exist.`,
          "Read the affected files and rebuild the patch from their current contents.",
          "Create a new file with write_file, or with a '--- /dev/null' patch section.",
        ], { patch });
      }
      before = read.content;
      mode = read.mode;
    } else {
      // A creation section must not replace something that is already there.
      const kind = await pathKind(deps, path);
      if (kind !== "missing") {
        throw actionableToolError([
          `No files were changed: ${
            relativeToDirectory(cwd, path)
          } already exists.`,
          kind === "symlink"
            ? "The path is a symbolic link."
            : kind === "directory"
            ? "The path is a directory."
            : "Remove it first, or patch the existing file instead of creating it.",
        ], { patch });
      }
    }

    // Apply hunks one at a time, checking each against the text produced so
    // far: a later hunk can be unique only after an earlier hunk changed the
    // text it matches.
    let working = before ?? "";
    for (const hunk of file.hunks) {
      const oldLines: string[] = [];
      let trailingNewline = true;
      for (const line of hunk.lines) {
        if (line.startsWith("\\")) {
          // "\ No newline at end of file" applies to the previous old line.
          if (oldLines.length > 0) trailingNewline = false;
          continue;
        }
        // diff stores a blank context line as "" rather than " ".
        const operation = line.length > 0 ? line[0] : " ";
        if (operation === "+") continue;
        if (operation === " " || operation === "-") {
          oldLines.push(line.slice(1).replace(/\r$/, ""));
          trailingNewline = true;
        }
      }
      if (oldLines.length === 0) {
        // An insertion with no unchanged line can only be placed by its line
        // number, which is stale as soon as the file changes.
        if (working.length > 0) {
          throw actionableToolError([
            `No files were changed: the hunk at line ${hunk.oldStart} has no context.`,
            "Include at least one unchanged line so the change has a unique position.",
            "Read the file and copy the line before or after the addition into the hunk.",
          ], { patch });
        }
      } else {
        const needle = oldLines.join("\n") + (trailingNewline ? "\n" : "");
        if (needle !== "") {
          // Only a match that starts a line counts: a context block may not
          // match inside a longer line.
          const normalizedWorking = working.replaceAll("\r\n", "\n");
          let occurrences = 0;
          for (
            let index = normalizedWorking.indexOf(needle);
            index !== -1;
            index = normalizedWorking.indexOf(needle, index + 1)
          ) {
            if (index === 0 || normalizedWorking[index - 1] === "\n") {
              occurrences++;
            }
          }
          // A hunk may end at a file whose last line has no newline; the
          // parser still reports that line with one.
          if (occurrences === 0 && needle.endsWith("\n")) {
            const truncated = needle.slice(0, -1);
            const start = normalizedWorking.length - truncated.length;
            if (
              start >= 0 && normalizedWorking.endsWith(truncated) &&
              (start === 0 || normalizedWorking[start - 1] === "\n")
            ) occurrences = 1;
          }
          if (occurrences === 0) {
            throw actionableToolError([
              `No files were changed: the hunk at line ${hunk.oldStart} does not match ${
                relativeToDirectory(cwd, path)
              }.`,
              "Read that file and rebuild the hunk from its current contents.",
              "Do not resend the same patch unchanged.",
            ], { patch });
          }
          if (occurrences > 1) {
            throw actionableToolError([
              `No files were changed: the hunk at line ${hunk.oldStart} matches ${occurrences} places in ${
                relativeToDirectory(cwd, path)
              }.`,
              "Include more surrounding context so the hunk identifies one location.",
              hunk.lines.some((line) => line.startsWith("-"))
                ? "Read the file and copy the surrounding lines around the intended change."
                : "Add the unchanged lines immediately before or after the change.",
            ], { patch });
          }
        }
      }
      const single = { ...file, hunks: [hunk] };
      let next = applyPatch(working, single, {
        fuzzFactor: 0,
        autoConvertLineEndings: true,
      });
      if (
        next === false && !working.endsWith("\n") &&
        hunk.lines.some((line) => line.startsWith("\\"))
      ) {
        // diff refuses a no-final-newline hunk against a file that already
        // lacks the newline; retry against a newline-terminated copy, which
        // yields the patched text without the newline.
        next = applyPatch(`${working}\n`, single, {
          fuzzFactor: 0,
          autoConvertLineEndings: true,
        });
      }
      if (next === false) {
        throw actionableToolError([
          `No files were changed: the patch context does not match ${
            relativeToDirectory(cwd, path)
          }.`,
          "Read that file and rebuild the hunk from its current contents.",
          "Do not resend the same patch unchanged.",
        ], { patch });
      }
      working = next;
    }

    const updated = working;
    // Deleting the file is only correct when the patch removes every line.
    if (newPath === null && updated !== "") {
      const remaining = updated.replace(/\n$/, "").split("\n").length;
      throw actionableToolError([
        `No files were changed: the patch does not delete all of ${
          relativeToDirectory(cwd, path)
        }.`,
        `The patch removes part of the file and would leave ${remaining} line(s).`,
        "Remove every line in the hunk, or patch the file instead of deleting it.",
      ], { patch });
    }
    // A section that keeps the file is not a change; a deletion always is.
    if (newPath !== null && before !== null && updated === before) continue;
    staged.set(path, {
      path,
      before,
      mode,
      after: newPath === null ? null : updated,
      additions: file.hunks.reduce(
        (total, hunk) =>
          total + hunk.lines.filter((line) => line.startsWith("+")).length,
        0,
      ),
      deletions: file.hunks.reduce(
        (total, hunk) =>
          total + hunk.lines.filter((line) => line.startsWith("-")).length,
        0,
      ),
    });
  }
  return staged;
}

/** Stage every replacement, then rename them in one step; roll back on failure. */
async function commitPatch(
  deps: AgentRunDeps,
  staged: ReadonlyMap<string, StagedPatchFile>,
): Promise<{ commit: unknown; staged: readonly StagedPatchFile[] }> {
  const files = [...staged.values()];
  const temps = new Map<string, string>();
  try {
    for (const file of files) {
      if (file.after === null) continue;
      temps.set(
        file.path,
        await writeTempFile(
          deps,
          file.path,
          file.after,
          file.before === null ? "mode:644" : "copy",
        ),
      );
    }
  } catch (error) {
    await removeFiles(deps, [...temps.values()]);
    if (error instanceof ToolExecutionError) throw error;
    throw actionableToolError([
      "No files were changed: the patched contents could not be staged.",
      "Check available space and permissions in the target directories.",
    ], { error });
  }

  const script = [
    "set -e",
    ...files.map((file) => {
      const temp = temps.get(file.path);
      return file.after === null
        ? `rm -f -- ${shellQuote(file.path)}`
        : `test ! -d ${shellQuote(file.path)} || exit 41\n` +
          `mv -f -- ${shellQuote(temp!)} ${shellQuote(file.path)}`;
    }),
  ].join("\n");
  const commit = await runPatchCommand(deps, script, "commit_patch", []);
  if (commit.exitCode !== 0) {
    const failed = await rollbackPatch(deps, files, temps);
    if (failed.length > 0) {
      throw actionableToolError([
        "The patch could not be committed, and the previous contents could not be fully restored.",
        `Files that may be inconsistent: ${failed.join(", ")}.`,
        "Read those files and repair them before continuing.",
      ], { commit, failed });
    }
    throw actionableToolError([
      "No files were changed: the patched files could not be written.",
      "The previous contents were restored.",
      "Check available space and permissions in the target directories.",
    ], { commit });
  }
  return { commit, staged: files };
}

async function rollbackPatch(
  deps: AgentRunDeps,
  files: readonly StagedPatchFile[],
  temps: ReadonlyMap<string, string>,
): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files) {
    try {
      if (file.before === null) {
        const removed = await runPatchCommand(
          deps,
          `rm -f -- ${shellQuote(file.path)}`,
          "rollback_remove",
          [],
        );
        if (removed.exitCode !== 0) failed.push(file.path);
        continue;
      }
      const temp = await writeTempFile(
        deps,
        file.path,
        file.before,
        `mode:${file.mode ?? "644"}`,
      );
      const moved = await runPatchCommand(
        deps,
        `mv -f -- ${shellQuote(temp)} ${shellQuote(file.path)}`,
        "rollback_move",
        [],
      );
      if (moved.exitCode !== 0) failed.push(file.path);
    } catch {
      failed.push(file.path);
    }
  }
  await removeFiles(deps, [...temps.values()]);
  return failed;
}

/** Read a patch target and its permission bits, or null when it is missing. */
async function readPatchFile(
  deps: AgentRunDeps,
  path: string,
  cwd: string,
): Promise<{ content: string; mode: string } | null> {
  const raw = await runPatchCommand(
    deps,
    READ_TEXT_SCRIPT,
    "read_patch_target",
    [path, String(PATCH_FILE_LIMIT)],
  );
  if (raw.exitCode === 40) return null;
  if (raw.exitCode !== 0) {
    const target = relativeToDirectory(cwd, path);
    if (raw.exitCode === 43) {
      throw actionableToolError([
        `No files were changed: ${target} is too large for apply_patch.`,
        `The limit is ${PATCH_FILE_LIMIT} bytes.`,
        "Use shell for an appropriate large-file operation.",
      ], { raw });
    }
    throw actionableToolError([
      `No files were changed: ${target} could not be read.`,
      raw.exitCode === 41
        ? "The path is not a regular file."
        : "Check the file permissions and available space before retrying.",
    ], { raw });
  }
  const [modeLine = "644", encoded = ""] = raw.stdout.split("\n", 2);
  const bytes = decodeBase64Bytes(encoded.replaceAll(/\s+/g, ""));
  if (bytes.includes(0)) {
    throw actionableToolError([
      `No files were changed: ${
        relativeToDirectory(cwd, path)
      } is not a text file.`,
      "Use shell for binary data.",
    ], { raw });
  }
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      mode: modeLine.trim(),
    };
  } catch {
    throw actionableToolError([
      `No files were changed: ${
        relativeToDirectory(cwd, path)
      } is not valid UTF-8 text.`,
      "Use shell for binary data.",
    ], { raw });
  }
}

async function writeTempFile(
  deps: AgentRunDeps,
  path: string,
  content: string,
  action: "copy" | `mode:${string}`,
): Promise<string> {
  const raw = await runPatchCommand(
    deps,
    WRITE_TEMP_SCRIPT,
    "write_patch_temp",
    [path, action],
    encodeBase64(content),
  );
  if (raw.exitCode !== 0 || !raw.stdout.trim()) {
    if (raw.exitCode === 43) {
      throw actionableToolError([
        `No files were changed: the directory for ${path} does not exist.`,
        "Create the directory first, or choose a path whose directory exists.",
      ], { raw });
    }
    throw new ToolExecutionError("The patched contents could not be staged.", {
      raw,
    });
  }
  return raw.stdout.trim();
}

/** Report whether a path is missing, a file, or a directory. */
async function pathKind(
  deps: AgentRunDeps,
  path: string,
): Promise<"missing" | "exists" | "directory" | "symlink"> {
  const raw = await runPatchCommand(
    deps,
    PATH_KIND_SCRIPT,
    "path_kind",
    [path],
  );
  const kind = raw.stdout.trim();
  return kind === "symlink"
    ? "symlink"
    : kind === "directory"
    ? "directory"
    : kind === "exists"
    ? "exists"
    : "missing";
}

async function removeFiles(
  deps: AgentRunDeps,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  await runPatchCommand(
    deps,
    `rm -f -- ${paths.map(shellQuote).join(" ")}`,
    "remove_patch_temps",
    [],
  ).catch(() => undefined);
}

function runPatchCommand(
  deps: AgentRunDeps,
  script: string,
  name: string,
  args: readonly string[],
  stdin?: string,
): Promise<CommandResult> {
  return deps.runtime.exec(
    ["/bin/bash", "-c", script, name, ...args],
    {
      cwd: deps.cwd,
      signal: deps.signal,
      timeoutMs: 120_000,
      stdin,
    },
  );
}

function patchFilePath(name: string, cwd: string): string | null {
  if (name === "/dev/null") return null;
  const stripped = name.replace(/^[ab]\//, "").replaceAll("\\", "/");
  if (stripped.startsWith("/")) {
    throw actionableToolError([
      `No files were changed: the patch path '${name}' is absolute.`,
      "Patch paths must be relative to the directory of the applied patch.",
    ]);
  }
  try {
    return resolveRuntimeDirectory(cwd, stripped);
  } catch (error) {
    throw actionableToolError([
      `No files were changed: the patch path '${name}' leaves the working directory.`,
      "Use a path inside the working directory.",
    ], { error });
  }
}

function relativeToDirectory(cwd: string, path: string): string {
  return relativePath(cwd, path) || ".";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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
