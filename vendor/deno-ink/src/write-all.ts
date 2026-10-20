/**
 * Write a complete byte sequence to a terminal stream.
 *
 * `Deno.stdout.writeSync` performs short writes on Windows consoles: an
 * 8 KB frame is accepted but only the first 4096 bytes are consumed, and the
 * caller sees that count. Ignoring it truncates the frame mid-row, which is
 * what leaves half-drawn boxes on screen. Retry until every byte is accepted,
 * and fail when a write makes no progress: returning success there would claim
 * a complete frame while silently dropping the remainder.
 */
export function writeAll(
  stream: { writeSync(bytes: Uint8Array): number },
  bytes: Uint8Array,
): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = stream.writeSync(bytes.subarray(offset));
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error(
        `Terminal stream accepted no bytes: ${
          bytes.length - offset
        } of ${bytes.length} bytes were not written.`,
      );
    }
    offset += written;
  }
}
