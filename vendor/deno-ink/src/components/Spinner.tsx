// Spinner component (based on ink-spinner)
import React, { useState, useEffect } from "npm:react@18.3.1";
import { Text } from "./Text.tsx";
import { spinners, type SpinnerName } from "../spinners.ts";

export interface SpinnerProps {
  /**
   * Type of spinner to use
   * @default "dots"
   */
  type?: SpinnerName;

  /**
   * Color of the spinner
   */
  color?: string;
}

/**
 * Animated spinner component
 */
export function Spinner({
  type = "dots",
  color,
}: SpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const spinner = spinners[type] || spinners.dots;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f: number) => (f + 1) % spinner.frames.length);
    }, spinner.interval);

    return () => clearInterval(timer);
  }, [spinner.frames.length, spinner.interval]);

  return React.createElement(Text, { color }, spinner.frames[frame]);
}
