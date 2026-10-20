import { assertEquals, assertThrows } from "@std/assert";
import { writeAll } from "../vendor/deno-ink/src/write-all.ts";

Deno.test("writeAll retries short writes until every byte is accepted", () => {
  const bytes = new TextEncoder().encode("0123456789");
  const accepted: number[] = [];
  writeAll({
    writeSync(chunk: Uint8Array) {
      accepted.push(chunk.length);
      return Math.min(4, chunk.length);
    },
  }, bytes);
  assertEquals(accepted, [10, 6, 2]);
});

Deno.test("writeAll rejects a stream that accepts no bytes", () => {
  const bytes = new TextEncoder().encode("frame");
  assertThrows(
    () => writeAll({ writeSync: () => 0 }, bytes),
    Error,
    "accepted no bytes",
  );
  // A stream that collects bytes without returning a count must not be read
  // as progress: `undefined <= 0` is false and would skip the tail.
  assertThrows(
    () => writeAll({ writeSync: () => undefined as unknown as number }, bytes),
    Error,
    "accepted no bytes",
  );
});
