---
name: editing-files
description: Use when inspecting or modifying existing text files with FileSystem tools. Teaches safe editing workflows using read_file, apply_patch, edit_file, and write_file. Prefer patches for nearly all edits. Do not use when creating entirely new files.
---

# Edit Existing Files Precisely

When changing an existing text file, think in terms of **editing**, not
rewriting.

Your goal is to make the smallest correct change while preserving everything
that is unrelated.

## Workflow

### 1. Read before you edit

Always inspect the current file before attempting to change it.

Use `read_file` to retrieve the current contents. For most files, simply read
the entire file:

```json
{"path":"src/example.ts"}
```

For larger files, continue reading from the returned `nextOffset`. Offsets and
limits are **bytes**, not line numbers.

```json
{"path":"src/example.ts","offset":65536,"limit":65536}
```

Never guess an offset or build an edit from memory. If you need to edit a piece
of text, read the file containing that text first.

---

### 2. Prefer patches

For almost every edit, use **`apply_patch`**.

A patch describes **what changes**, not the entire file. This makes edits:

- easier to review
- less likely to remove unrelated code
- safer when files have changed
- suitable for edits across multiple locations or files

Think of a patch as a set of instructions:

> "Remove these lines, insert these new lines, and leave everything else
> exactly as it is."

Use patches whenever you're:

- inserting code
- deleting code
- changing multiple lines
- renaming symbols
- modifying several locations
- editing multiple files

## Understanding Unified Diffs

`apply_patch` uses the standard **unified diff** format.

Example:

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -8,5 +8,6 @@
 export function add(a, b) {
-  return a - b;
+  const sum = a + b;
+  return sum;
 }
```

Each part has a purpose:

- `---` identifies the original file.
- `+++` identifies the updated file.
- `@@` begins a *hunk* (the region being modified).
- Lines beginning with a space are unchanged context.
- Lines beginning with `-` are removed.
- Lines beginning with `+` are added.

The unchanged context is important. It tells the tool exactly where the edit
belongs and lets it verify that the file still matches what you previously
read.

Always copy context from the current file. Never invent it.

If the patch no longer matches because the file changed, read the file again
and rebuild the patch.

Example:

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,6 +1,7 @@
 import { foo } from "./foo";
+import { bar } from "./bar";

 export function run() {
-  foo();
+  foo();
+  bar();
 }
```

---

### 3. Use `edit_file` for one exact replacement

`edit_file` is intentionally strict.

It succeeds only when the `oldText` identifies **one unambiguous location**.

Use it only when you already know the exact text to replace.

```json
{
  "path":"src/example.ts",
  "oldText":"const enabled = false;",
  "newText":"const enabled = true;"
}
```

Good uses:

- changing a literal value
- fixing a typo
- replacing one known line
- updating one unique statement

If the tool reports that the text is missing or ambiguous:

1. Read the file again.
2. Copy the current text exactly.
3. Retry using fresh context.

Do **not** resend the same failed edit.

If the change affects multiple locations or becomes more than a simple
replacement, switch to `apply_patch`.

---

### 4. Avoid overwriting entire files

`write_file` with `mode: "overwrite"` replaces the entire file.

This is almost never the correct tool for editing an existing file.

Use it only when the intended result is genuinely a complete replacement and
the user has explicitly requested that outcome.

Do not use overwrite simply because a patch feels inconvenient.

---

### 5. Verify immediately

After every successful edit:

- read the affected region again, or
- run an appropriate focused validation.

Do not continue editing from the snapshot you originally read. Once a file has
changed, that earlier snapshot is stale.

---

## Recovering from failures

If an edit or patch fails:

1. Read the file again.
2. Assume the previous snapshot is no longer current.
3. Rebuild the edit or patch from the latest contents.
4. Retry.

Never resend the same failed edit unchanged.

## Summary

When editing existing text files:

1. Read first.
2. Prefer `apply_patch`.
3. Use `edit_file` only for one exact replacement.
4. Avoid whole-file overwrites.
5. Verify every successful change.
6. If anything fails, read again before retrying.
