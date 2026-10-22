import { assertEquals } from "@std/assert";
import { Logger } from "../log.ts";

Deno.test("logger writes JSONL and truncates on each start", async () => {
  const directory = await Deno.makeTempDir({ prefix: "runtime-host-log-" });
  const path = `${directory}/runtime-host.log`;
  try {
    const logger = new Logger({ path, level: "info" });
    logger.debug("test", "hidden");
    logger.info("alpha", "hello", { count: 2 });
    logger.warn("beta", "careful");
    logger.error("gamma", "failed", new Error("boom"));
    logger.close();

    const records = (await Deno.readTextFile(path)).trim().split("\n")
      .map((line) => JSON.parse(line));
    assertEquals(records.length, 3);
    assertEquals(records[0].level, "info");
    assertEquals(records[0].source, "alpha");
    assertEquals(records[0].message, "hello");
    assertEquals(records[0].details, { count: 2 });
    assertEquals(records[2].error.name, "Error");
    assertEquals(records[2].error.message, "boom");

    const fresh = new Logger({ path, level: "warn" });
    fresh.info("alpha", "ignored");
    fresh.close();
    assertEquals((await Deno.readTextFile(path)).trim(), "");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
