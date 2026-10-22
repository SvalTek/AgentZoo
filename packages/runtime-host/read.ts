/**
 * Byte and line reads for `fs.read`.
 *
 * The caller owns the handle: `operations.ts` opens the target through the
 * kernel containment check and passes the handle plus its stat information, so
 * a read cannot be redirected by a symlink that changed after validation.
 */

import {
  DEFAULT_LINE_LIMIT,
  HostError,
  MAX_LINE_FILE_BYTES,
  MAX_LINE_LIMIT,
  MAX_RESPONSE_BYTES,
} from "./protocol.ts";

export interface ReadResult {
  readonly result: Record<string, unknown>;
  readonly payload: Uint8Array;
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function decodeText(bytes: Uint8Array, label: string): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new HostError("invalid_utf8", `${label} is not valid UTF-8 text`);
  }
}

/** Split text into lines, keeping each line's own terminator. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

export async function readBytes(
  file: Deno.FsFile,
  info: Deno.FileInfo,
  label: string,
  requestedOffset: number,
  requestedLimit: number,
  validate = true,
): Promise<ReadResult> {
  const size = info.size;
  if (requestedOffset > size) {
    throw new HostError(
      "range",
      `${label} is ${size} bytes, but offset was ${requestedOffset}`,
    );
  }
  const limit = Math.min(requestedLimit, MAX_RESPONSE_BYTES);
  const count = Math.min(limit, size - requestedOffset);
  await file.seek(requestedOffset, Deno.SeekMode.Start);
  const buffer = new Uint8Array(count);
  let read = 0;
  while (read < count) {
    const chunk = await file.read(buffer.subarray(read));
    if (chunk === null) break;
    read += chunk;
  }
  const bytes = buffer.subarray(0, read);
  if (validate) {
    if (bytes.includes(0)) {
      throw new HostError("binary", `${label} is not a text file`);
    }
    // A byte window is explicit: a split character is reported, not dropped.
    decodeText(bytes, `${label} at offset ${requestedOffset}`);
  }
  const truncated = requestedOffset + read < size;
  return {
    result: {
      unit: "bytes",
      offset: requestedOffset,
      bytesRead: read,
      sizeBytes: size,
      truncated,
      ...(truncated ? { nextByteOffset: requestedOffset + read } : {}),
    },
    payload: bytes,
  };
}

export async function readLines(
  file: Deno.FsFile,
  info: Deno.FileInfo,
  label: string,
  requestedStart: number,
  requestedLimit: number,
): Promise<ReadResult> {
  if (info.size > MAX_LINE_FILE_BYTES) {
    throw new HostError(
      "too_large",
      `${label} is too large for line reads; use byte ranges`,
    );
  }
  await file.seek(0, Deno.SeekMode.Start);
  const bytes = new Uint8Array(info.size);
  let read = 0;
  while (read < bytes.length) {
    const chunk = await file.read(bytes.subarray(read));
    if (chunk === null) break;
    read += chunk;
  }
  const content = bytes.subarray(0, read);
  if (content.includes(0)) {
    throw new HostError("binary", `${label} is not a text file`);
  }
  const text = decodeText(content, label);
  const lines = splitLines(text);
  const totalLines = lines.length;
  // An empty file has no lines, but reading line 1 is an empty page rather
  // than an out-of-range error.
  if (requestedStart > Math.max(totalLines, 1)) {
    throw new HostError(
      "range",
      `${label} has ${totalLines} lines, but startLine was ${requestedStart}`,
    );
  }

  const limit = Math.min(
    requestedLimit || DEFAULT_LINE_LIMIT,
    MAX_LINE_LIMIT,
  );
  const selected: string[] = [];
  let bytesUsed = 0;
  for (
    let index = requestedStart - 1;
    index < lines.length && selected.length < limit;
    index++
  ) {
    const line = lines[index];
    const lineBytes = encoder.encode(line).length;
    if (lineBytes > MAX_RESPONSE_BYTES) {
      throw new HostError(
        "too_large",
        `${label} line ${
          index + 1
        } is larger than one response; use byte ranges`,
      );
    }
    if (selected.length > 0 && bytesUsed + lineBytes > MAX_RESPONSE_BYTES) {
      break;
    }
    selected.push(line);
    bytesUsed += lineBytes;
  }

  const linesReturned = selected.length;
  const nextLine = requestedStart + linesReturned;
  const truncated = nextLine <= totalLines;
  return {
    result: {
      unit: "lines",
      startLine: requestedStart,
      linesReturned,
      totalLines,
      truncated,
      ...(truncated ? { nextLine } : {}),
    },
    payload: encoder.encode(selected.join("")),
  };
}
