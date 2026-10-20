// deno-lint-ignore-file no-explicit-any
import React, { type ReactNode } from "npm:react@18.3.1";

export interface TextProps {
  key?: React.Key;
  children?: ReactNode;
  color?: string;
  backgroundColor?: string;
  dimColor?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  wrap?: "wrap" | "truncate" | "truncate-middle" | "truncate-start";
}

export function Text({
  children,
  color,
  backgroundColor,
  dimColor,
  bold,
  italic,
  underline,
  strikethrough,
  inverse,
  wrap,
}: TextProps): React.ReactElement {
  const style = {
    color,
    backgroundColor,
    dimColor,
    bold,
    italic,
    underline,
    strikethrough,
    inverse,
    wrap,
  };

  return React.createElement(
    "ink-text" as any,
    { style },
    children
  );
}
