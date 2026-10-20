import React from "npm:react@18.3.1";
import { Text } from "./Text.tsx";
import { useInput } from "../hooks/use-input.ts";

export interface ConfirmInputProps {
  /**
   * Called when user confirms (presses Y or Enter with defaultValue=true)
   */
  onConfirm: () => void;
  /**
   * Called when user cancels (presses N or Enter with defaultValue=false)
   */
  onCancel: () => void;
  /**
   * Default value when Enter is pressed without Y or N
   * @default true
   */
  defaultValue?: boolean;
  /**
   * Whether the input is disabled
   * @default false
   */
  isDisabled?: boolean;
}

/**
 * A confirmation input component that prompts for Y/n or y/N input.
 *
 * @example
 * ```tsx
 * <ConfirmInput
 *   onConfirm={() => console.log("Confirmed!")}
 *   onCancel={() => console.log("Cancelled!")}
 * />
 *
 * // With default No
 * <ConfirmInput
 *   onConfirm={() => console.log("Confirmed!")}
 *   onCancel={() => console.log("Cancelled!")}
 *   defaultValue={false}
 * />
 * ```
 */
export function ConfirmInput({
  onConfirm,
  onCancel,
  defaultValue = true,
  isDisabled = false,
}: ConfirmInputProps) {
  useInput(
    (input, key) => {
      if (isDisabled) return;

      const lowerInput = input.toLowerCase();

      if (lowerInput === "y") {
        onConfirm();
      } else if (lowerInput === "n") {
        onCancel();
      } else if (key.return) {
        if (defaultValue) {
          onConfirm();
        } else {
          onCancel();
        }
      }
    },
    { isActive: !isDisabled }
  );

  return <Text>{defaultValue ? "(Y/n)" : "(y/N)"}</Text>;
}
