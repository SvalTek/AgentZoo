/**
 * Entrypoint for the resident runtime-host service.
 *
 * Compiled with `deno compile -A` and started by the runtime entrypoint. It
 * runs outside every agent root; agents cannot see or modify it.
 */

import { createRuntimeHostServer } from "./server.ts";
import { DEFAULT_PORT } from "./protocol.ts";
import { Logger, type LogLevel } from "./log.ts";

const token = Deno.env.get("AGENTZOO_RUNTIME_TOKEN");
if (!token) {
  console.error("AGENTZOO_RUNTIME_TOKEN is required");
  Deno.exit(1);
}

const agentsRoot = Deno.env.get("AGENTZOO_AGENTS_ROOT") ??
  "/var/lib/runtime/agents";
const port = Number(Deno.env.get("AGENTZOO_RUNTIME_PORT") ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("AGENTZOO_RUNTIME_PORT must be a positive port");
  Deno.exit(1);
}

const logger = new Logger({
  path: "/var/log/agentzoo/runtime-host.log",
  level: (Deno.env.get("AGENTZOO_LOG_LEVEL") as LogLevel) ?? "info",
});
const server = createRuntimeHostServer({ agentsRoot, token, port, logger });
logger.info("main", "listening", { port: server.port, agentsRoot });
// Infrastructure channel only: the application record is the JSONL file.
console.error(`runtime-host listening on port ${server.port}`);

const shutdown = () => {
  logger.info("main", "shutting down");
  logger.close();
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);
