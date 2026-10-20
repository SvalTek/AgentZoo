# Vendored `@deno-ink/core` 0.2.1

Source: <https://jsr.io/@deno-ink/core@0.2.1> (MIT, `LICENSE` kept verbatim).
Vendored at commit `409cb4f` so the renderer can be fixed locally; JSR keeps
`src/` private, so the compatibility shim in `packages/cli/deno_ink.ts` already
had to reach into untyped internals.

Upstream is not a fork target: the file layout and API are unchanged, and every
edit below is local to this directory. Compare against the published sources
when bumping the version.

## Patches to this copy

### 1. Complete writes — `src/write-all.ts`, `src/ink.ts`, `src/log-update.ts`

`Deno.stdout.writeSync` performs short writes on Windows terminals: an 8850-byte
dashboard frame returns **4096** and the caller must retry. Ignoring the count
truncated every frame mid-row, which is what left boxes without right/bottom
edges and hid the activity panel below the agent list. `writeAll` loops until
every byte is accepted, and throws when a write reports no progress so a
stalled stream cannot claim a complete frame.

This was the cause of the "broken from the start on one machine, 80% fine on
another" behaviour: the loss depends on frame size and console buffering.

### 2. No clear past the last row — `src/ink.ts`, `render()`

After painting, the full-screen path moved to `row = lines.length + 1` and ran
`ED`. When the frame fills the terminal that row does not exist: terminals clamp
the move to the last row and the `ED` then erases the final painted line (the
keybinding hint). The clear is now emitted only when `lines.length < rows`, and
`render()` reads `rows` from `Deno.consoleSize()` for that check.

### 3. Honor `options.stdout` — `src/ink.ts`

`Ink.writeSync` hard-coded `Deno.stdout`, so `InkOptions.stdout` was silently
ignored and the renderer could not be driven against a capture stream. It now
writes through `this.options.stdout`.

### 4. Type errors the published surface hid — `src/ink.ts`, `src/components/ErrorBoundary.tsx`

The JSR build is consumed as `any`-ish internals, so these never surfaced:

- `rebuildYogaTree` narrows `node.yogaNode` through `?? (node.yogaNode = …)`;
  the property read was re-checked by the compiler and treated as possibly
  undefined.
- `InkProvider` declares `children` required, so it is passed in props instead
  of as the third `createElement` argument.
- `ErrorBoundary`'s factory returns an anonymous class; it is cast to
  `ComponentClass<Props, State>` at the return site.
- `src/yoga.ts` was missing from the initial vendor copy and is now present.

## Unfixed upstream behaviour (known, not currently harmful)

- `src/log-update.ts` erases by *logical* line count, so wrapped rows desync
  `eraseLines`. Only affects inline mode; the CLI uses `fullScreen: true`, which
  paints by absolute row and never calls it.
- `Output.get()` runs `trimEnd()` per line. Right alignment here comes from Yoga
  x-offsets, not padding, and no component relies on trailing styled spaces, so
  it is inert today. It would clip a `backgroundColor` or `inverse` fill that
  extends past its text.
- `wrapText` calls `wrap-ansi` with `trim: false`, so a wrapped line can keep the
  space it broke on (visible as a one-space indent on continuation lines).
  Measurement and rendering use the same call, so heights stay consistent.
- `useTerminalSize` polls at 1000 ms, so a resize reflows up to a second late.

## Patches living outside this directory

`packages/cli/deno_ink.ts` replaces `Ink.prototype.rebuildYogaTree` because the
shipped measure function pinned every text node to its unwrapped natural width.
That replacement is part of the same rendering contract as the patches above:

- text is measured against the Yoga constraint instead of its unwrapped width;
- `wrap="truncate"` / `truncate-start` / `truncate-middle` report one row per
  source line, matching the renderer, which truncates instead of wrapping.
  Wrapping in measurement reserved rows the renderer left blank and stretched
  every border below the text.
