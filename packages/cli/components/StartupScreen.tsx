/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { Box, Spinner, Text } from "@deno-ink/core";

export function StartupScreen({ configPath }: { configPath: string }) {
  return (
    <Box padding={1}>
      <Spinner type="dots" color="cyan" />
      <Text>Loading {configPath} and preparing the agents...</Text>
    </Box>
  );
}
