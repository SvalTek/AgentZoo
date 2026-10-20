import React from "npm:react@18.3.1";
import type { ReactNode } from "npm:react@18.3.1";
import { Box } from "./Box.tsx";
import { Text } from "./Text.tsx";

const VARIANTS = {
  success: { symbol: "✔", color: "green" },
  error: { symbol: "✖", color: "red" },
  warning: { symbol: "⚠", color: "yellow" },
  info: { symbol: "ℹ", color: "blue" },
} as const;

export type StatusMessageVariant = keyof typeof VARIANTS;

export interface StatusMessageProps {
  /**
   * Content to display as the message
   */
  children: ReactNode;
  /**
   * The variant determines the symbol and color
   */
  variant: StatusMessageVariant;
}

/**
 * A status message component that displays a message with a symbol
 * indicating the status type (success, error, warning, or info).
 *
 * @example
 * ```tsx
 * <StatusMessage variant="success">Operation completed</StatusMessage>
 * <StatusMessage variant="error">Something went wrong</StatusMessage>
 * <StatusMessage variant="warning">Proceed with caution</StatusMessage>
 * <StatusMessage variant="info">For your information</StatusMessage>
 * ```
 */
export function StatusMessage({ children, variant }: StatusMessageProps) {
  const { symbol, color } = VARIANTS[variant];

  return (
    <Box>
      <Text color={color}>{symbol} </Text>
      <Text>{children}</Text>
    </Box>
  );
}
