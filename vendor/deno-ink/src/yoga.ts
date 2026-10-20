// deno-lint-ignore-file no-explicit-any
// Custom Yoga loader for Deno

import initYogaModule from "npm:yoga-wasm-web@0.3.3";
import { join } from "jsr:@std/path@1";

let yoga: any = null;

export async function loadYoga(): Promise<any> {
  if (yoga) return yoga;

  // Try CDN first (works in compiled binaries)
  try {
    const response = await fetch(
      "https://unpkg.com/yoga-wasm-web@0.3.3/dist/yoga.wasm"
    );
    if (response.ok) {
      const wasmBytes = await response.arrayBuffer();
      yoga = await initYogaModule(wasmBytes);
      return yoga;
    }
  } catch {
    // CDN failed, try local cache
  }

  // Fallback: try local Deno cache
  try {
    const cacheDir = Deno.env.get("DENO_DIR") ||
      join(Deno.env.get("HOME") || "", "Library", "Caches", "deno");

    const wasmPath = join(
      cacheDir,
      "npm",
      "registry.npmjs.org",
      "yoga-wasm-web",
      "0.3.3",
      "dist",
      "yoga.wasm"
    );

    const wasmBytes = await Deno.readFile(wasmPath);
    yoga = await initYogaModule(wasmBytes);
    return yoga;
  } catch (error) {
    throw new Error(`Failed to load yoga WASM: ${error}`);
  }
}

export type { Yoga, Node } from "npm:yoga-wasm-web@0.3.3";
