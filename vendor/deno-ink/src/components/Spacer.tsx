import React from "npm:react@18.3.1";
import { Box } from "./Box.tsx";

export function Spacer(): React.ReactElement {
  return React.createElement(Box, { flexGrow: 1 });
}
