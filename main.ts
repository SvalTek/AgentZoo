/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { runCli } from "./cli.tsx";

if (import.meta.main) await runCli(Deno.args);
