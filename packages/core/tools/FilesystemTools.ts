/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import type { ToolDefinition } from "@vibesjs/sdk";
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
import { resolveRuntimeDirectory } from "./RuntimePaths.ts";

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
  cat >> "$path"
else
  cat > "$path"
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

const PATCH_SCRIPT = String.raw`
patch_file=$(mktemp) || exit 53
normalized=$(mktemp) || exit 53
trap 'rm -f "$patch_file" "$normalized"' EXIT
cat > "$patch_file" || exit 53
# Unified diffs are line-based, but a hunk must match the file's bytes. Rewrite
# each section's context/added/removed lines to the target file's line ending
# so an LF patch applies to a CRLF file without relaxing context matching, and
# a CRLF file never picks up mixed endings. Headers stay LF.
awk '
  BEGIN { CR = sprintf("%c", 13); crlf = 0 }
  {
    line = $0
    if (substr(line, length(line)) == CR) sub(CR "$", "", line)
    if (substr(line, 1, 4) == "+++ ") {
      path = substr(line, 5)
      tab = index(path, "\t")
      if (tab) path = substr(path, 1, tab - 1)
      if (substr(path, 1, 2) == "b/") path = substr(path, 3)
      crlf = target_crlf(path)
      printf "%s\n", line
      next
    }
    if (substr(line, 1, 4) == "--- " || substr(line, 1, 6) == "diff -" ||
        substr(line, 1, 6) == "index " || substr(line, 1, 5) == "@@ -" ||
        substr(line, 1, 3) == "new" || substr(line, 1, 3) == "old" ||
        substr(line, 1, 4) == "renam" || substr(line, 1, 4) == "copy" ||
        substr(line, 1, 2) == "\\ ") {
      printf "%s\n", line
      next
    }
    if (substr(line, 1, 1) == " " || substr(line, 1, 1) == "+" ||
        substr(line, 1, 1) == "-") {
      if (crlf) printf "%s%s\n", line, CR
      else printf "%s\n", line
      next
    }
    printf "%s\n", line
  }
  function target_crlf(path,   line) {
    while ((getline line < path) > 0) {
      if (substr(line, length(line)) == CR) { close(path); return 1 }
    }
    close(path)
    return 0
  }
' "$patch_file" > "$normalized" || exit 53
apply_mode=()
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || apply_mode=(--no-index)
eof_mode=()
git apply "$${"{"}apply_mode[@]}" --check --unidiff-zero --whitespace=nowarn -- "$normalized" >/dev/null 2>&1 || eof_mode=(--inaccurate-eof)
if ! patch_error=$(git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --check --unidiff-zero --whitespace=nowarn -- "$normalized" 2>&1 >/dev/null); then
  printf '%s\n' "$patch_error" >&2
  case "$patch_error" in
    *"corrupt patch"*) exit 60 ;;
    *"No such file or directory"*) exit 61 ;;
  esac
  exit 51
fi
git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --check --unidiff-zero --whitespace=nowarn -- "$normalized" || exit 52
git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --unidiff-zero --whitespace=nowarn -- "$normalized" || exit 52
stats=$(git apply "$${"{"}apply_mode[@]}" "$${"{"}eof_mode[@]}" --numstat -- "$normalized") || exit 51
# --numstat reports work-tree-root-relative paths; report them relative to the
# directory the patch was applied from, which is what the model supplied.
prefix=""
top=$(git rev-parse --show-toplevel 2>/dev/null) || top=""
if [ -n "$top" ] && [ "$top" != "$PWD" ] && [ "$${"{"}PWD#"$top"/}" != "$PWD" ]; then
  prefix="$${"{"}PWD#"$top"/}/"
fi
printf '%s\n' "$stats" | while IFS=$'\t' read -r added removed changed; do
  printf '%s\t%s\t%s\n' "$added" "$removed" "$${"{"}changed#"$prefix"}"
done
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
  find "$path" \( -type f -o -type l \) -name "$name" -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
else
  find "$path" \( -type f -o -type l \) -exec grep -nIH -F -- "$pattern" {} + 2>/dev/null
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
    const patchFailures: Record<
      number,
      ToolFeedback | ((raw: CommandResult) => ToolFeedback)
    > = {
      51: (raw) => [
        "No files were changed: the patch does not match the current files.",
        ...patchDiagnostic(raw),
        "Read the affected files and rebuild the patch from their current contents.",
        "Do not resend the same patch unchanged.",
      ],
      52: (raw) => [
        "No files were changed: the checked patch could not be applied.",
        ...patchDiagnostic(raw),
        "Read the affected files, confirm their current state, and regenerate the patch.",
      ],
      53: [
        "No files were changed: the patch could not be processed.",
        "Provide a complete unified diff with valid file headers and hunk lines.",
      ],
      60: (raw) => [
        "No files were changed: the patch could not be parsed.",
        ...patchDiagnostic(raw),
        "Check the '@@' hunk header and line counts, and start every hunk line with a space, '-', or '+'.",
      ],
      61: (raw) => [
        "No files were changed: a file in the patch does not exist.",
        ...patchDiagnostic(raw),
        "Check the paths in the '---' and '+++' headers, or create the file with write_file first.",
      ],
    };
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
          "Apply a unified diff to files. For one small exact replacement, prefer edit_file; prefer apply_patch for changes spanning multiple regions or files. Set cwd to the directory containing the patched paths, use matching relative '--- a/path' and '+++ b/path' headers, and use exact '@@' hunk counts. A hunk may begin or end with a changed line; trailing context is not required. Context matches the file's own line endings, so a LF patch applies to a CRLF file. The complete patch is checked before files are changed. Returns changed paths (relative to cwd) and addition/deletion counts.",
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
          const patch = input.patch!.endsWith("\n")
            ? input.patch!
            : `${input.patch!}\n`;
          const cwd = resolveRuntimeDirectory(context.deps.cwd, input.cwd);
          const raw = await execute(
            context.deps,
            ["/bin/bash", "-c", PATCH_SCRIPT, "apply_patch"],
            patch,
            cwd,
            patchFailures,
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
          const result = {
            filesChanged: changes.length,
            changes,
            message:
              "Patch applied. Its previous file context is now stale; read or test before another related edit.",
          };
          return observedToolResult(result, { command: raw, result });
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
          "List the immediate contents of a directory without recursive traversal. Follows a symlinked directory when path itself is a link. Returns each entry's name, type, and sizeBytes (for a symlink, the length of its target path).",
        parameters: ListParameters,
        execute: async (context, input) => {
          const path = input.path ?? ".";
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

/** Forward the tool's own diagnostic line instead of hiding the actual cause. */
function patchDiagnostic(raw: CommandResult): string[] {
  const line = raw.stderr.split(/\r?\n/).map((entry) => entry.trim()).find(
    Boolean,
  );
  return line ? [`The patch command reported: ${line}`] : [];
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
