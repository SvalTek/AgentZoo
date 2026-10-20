// deno-lint-ignore-file no-explicit-any
import React, { type ReactNode } from "npm:react@18.3.1";
import type { Styles } from "../styles.ts";

export interface BoxProps extends Styles {
  children?: ReactNode;
  /** React key for list rendering */
  key?: React.Key;
}

export function Box({ children, ...props }: BoxProps): React.ReactElement {
  const style: Styles = { ...props };

  return React.createElement(
    "ink-box" as any,
    { style },
    children
  );
}
