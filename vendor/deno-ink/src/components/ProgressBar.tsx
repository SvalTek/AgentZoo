import React from "npm:react@18.3.1";
import { Box } from "./Box.tsx";
import { Text } from "./Text.tsx";

export interface ProgressBarProps {
  /**
   * Current value (0-100 by default, or 0-maxValue if maxValue is set)
   */
  value: number;
  /**
   * Maximum value (default: 100)
   */
  maxValue?: number;
  /**
   * Width of the progress bar in characters
   * @default 20
   */
  width?: number;
  /**
   * Color of the filled portion
   * @default "green"
   */
  color?: string;
  /**
   * Color of the unfilled portion
   */
  backgroundColor?: string;
  /**
   * Character used for the filled portion
   * @default "█"
   */
  character?: string;
  /**
   * Character used for the unfilled portion
   * @default "░"
   */
  backgroundCharacter?: string;
}

/**
 * A progress bar component that displays a visual indicator of progress.
 *
 * @example
 * ```tsx
 * <ProgressBar value={50} />
 * <ProgressBar value={75} width={30} color="cyan" />
 * <ProgressBar value={5} maxValue={10} character="=" backgroundCharacter="-" />
 * ```
 */
export function ProgressBar({
  value,
  maxValue = 100,
  width = 20,
  color = "green",
  backgroundColor,
  character = "█",
  backgroundCharacter = "░",
}: ProgressBarProps) {
  // Calculate percentage, clamped to 0-100
  const percentage = Math.min(100, Math.max(0, (value / maxValue) * 100));
  const filledWidth = Math.round((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  return (
    <Box>
      <Text color={color}>{character.repeat(filledWidth)}</Text>
      <Text color={backgroundColor}>{backgroundCharacter.repeat(emptyWidth)}</Text>
    </Box>
  );
}
