import React from "npm:react@18.3.1";
import type { ReactNode } from "npm:react@18.3.1";
import { Text } from "./Text.tsx";

export interface BadgeProps {
  /**
   * Content to display in the badge
   */
  children: ReactNode;
  /**
   * Background color of the badge
   * @default "blue"
   */
  color?: string;
}

/**
 * A badge component that displays text with a colored background.
 * Useful for status indicators, labels, and tags.
 *
 * @example
 * ```tsx
 * <Badge>INFO</Badge>
 * <Badge color="green">SUCCESS</Badge>
 * <Badge color="red">ERROR</Badge>
 * <Badge color="yellow">WARNING</Badge>
 * ```
 */
export function Badge({ children, color = "blue" }: BadgeProps) {
  return (
    <Text backgroundColor={color} color="white" bold>
      {" "}{children}{" "}
    </Text>
  );
}
