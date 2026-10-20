import React from "npm:react@18.3.1";
import { Text } from "./Text.tsx";

export interface NewlineProps {
  count?: number;
}

export function Newline({ count = 1 }: NewlineProps): React.ReactElement {
  return React.createElement(Text, null, "\n".repeat(count));
}
