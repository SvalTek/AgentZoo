/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { resolve } from "@std/path";
import type { Workspace } from "./types.ts";

/** A host-side shared directory; agents see this same directory as /shared. */
export class SharedWorkspace implements Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async prepare(): Promise<void> {
    await Deno.mkdir(this.root, { recursive: true });
  }

  resolve(...segments: string[]): string {
    const target = resolve(this.root, ...segments);
    if (
      target !== this.root && !target.startsWith(`${this.root}\\`) &&
      !target.startsWith(`${this.root}/`)
    ) {
      throw new TypeError("Shared workspace path escapes its root");
    }
    return target;
  }
}
