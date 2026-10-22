/**
 * Entrypoint for the resident runtime-host service.
 *
 * Compiled with `deno compile -A` and started by the runtime entrypoint. It
 * runs outside every agent root; agents cannot see or modify it.
 */

import { createRuntimeHostServer } from "./server.ts";
import { DEFAULT_PORT } from "./protocol.ts";

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

const server = createRuntimeHostServer({ agentsRoot, token, port });
console.log(
  `runtime host listening on port ${server.port} (agents root: ${agentsRoot})`,
);
