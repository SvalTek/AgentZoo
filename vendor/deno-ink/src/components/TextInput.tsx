// TextInput component - single-line text input
// Based on ink-text-input: https://github.com/vadimdemedes/ink-text-input
import React, { useState, useEffect, useCallback } from "npm:react@18.3.1";
import { Text } from "./Text.tsx";
import { useInput, type Key } from "../hooks/use-input.ts";

export interface TextInputProps {
  /**
   * Current value of the input.
   */
  value: string;

  /**
   * Callback when the value changes.
   */
  onChange: (value: string) => void;

  /**
   * Callback when Enter is pressed.
   */
  onSubmit?: (value: string) => void;

  /**
   * Placeholder text shown when value is empty.
   */
  placeholder?: string;

  /**
   * Whether the input is focused (receives keyboard input).
   * @default true
   */
  focus?: boolean;

  /**
   * Mask character for password fields.
   * When set, all characters are replaced with this character.
   */
  mask?: string;

  /**
   * Whether to show cursor.
   * @default true
   */
  showCursor?: boolean;

  /**
   * Cursor character.
   * @default "█"
   */
  cursorChar?: string;

  /**
   * Color of the text.
   */
  color?: string;
}

/**
 * Single-line text input component.
 *
 * Note: This component does NOT register itself as focusable.
 * The parent is responsible for managing focus and passing the `focus` prop.
 * Use with useFocus() in a wrapper component for Tab navigation.
 *
 * @example
 * ```tsx
 * function MyInput() {
 *   const { isFocused } = useFocus();
 *   const [value, setValue] = useState("");
 *
 *   return (
 *     <Box borderColor={isFocused ? "cyan" : "gray"}>
 *       <TextInput
 *         value={value}
 *         onChange={setValue}
 *         focus={isFocused}
 *         placeholder="Type here..."
 *       />
 *     </Box>
 *   );
 * }
 * ```
 */
export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  mask,
  showCursor = true,
  cursorChar = "\u2588", // Block cursor
  color,
}: TextInputProps): React.ReactElement {
  const [cursorOffset, setCursorOffset] = useState<number>(value.length);

  // Keep cursor at end when value changes externally
  useEffect(() => {
    setCursorOffset(value.length);
  }, [value.length]);

  useInput(
    useCallback(
      (input: string, key: Key) => {
        // Ignore certain keys
        if (
          key.upArrow ||
          key.downArrow ||
          key.tab ||
          key.escape ||
          key.pageUp ||
          key.pageDown ||
          (key.ctrl && input === "c")
        ) {
          return;
        }

        if (key.return && onSubmit) {
          onSubmit(value);
          return;
        }

        let nextValue = value;
        let nextCursorOffset = cursorOffset;

        if (key.leftArrow) {
          if (showCursor) {
            nextCursorOffset = Math.max(0, cursorOffset - 1);
          }
        } else if (key.rightArrow) {
          if (showCursor) {
            nextCursorOffset = Math.min(value.length, cursorOffset + 1);
          }
        } else if (key.home) {
          nextCursorOffset = 0;
        } else if (key.end) {
          nextCursorOffset = value.length;
        } else if (key.backspace) {
          if (cursorOffset > 0) {
            nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
            nextCursorOffset = cursorOffset - 1;
          }
        } else if (key.delete) {
          if (cursorOffset < value.length) {
            nextValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1);
          }
        } else if (!key.ctrl && !key.meta && input) {
          // Regular character input
          nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
          nextCursorOffset = cursorOffset + input.length;
        }

        if (nextCursorOffset !== cursorOffset) {
          setCursorOffset(nextCursorOffset);
        }

        if (nextValue !== value) {
          onChange(nextValue);
        }
      },
      [value, onChange, onSubmit, cursorOffset, showCursor]
    ),
    { isActive: focus }
  );

  // Build display value
  let displayValue = value;
  if (mask) {
    displayValue = mask.repeat(value.length);
  }

  // Show placeholder if empty and not focused, or empty and focused without cursor
  if (value.length === 0) {
    if (placeholder && (!focus || !showCursor)) {
      return React.createElement(Text, { color: "gray", dimColor: true }, placeholder);
    }
    // Show just cursor when focused and empty
    if (focus && showCursor) {
      return React.createElement(Text, { inverse: true }, cursorChar);
    }
    return React.createElement(Text, { color: "gray", dimColor: true }, placeholder || " ");
  }

  // Show cursor when focused
  if (focus && showCursor) {
    const before = displayValue.slice(0, cursorOffset);
    const cursorValue = displayValue[cursorOffset] || cursorChar;
    const after = displayValue.slice(cursorOffset + 1);

    return React.createElement(
      Text,
      { color },
      before,
      React.createElement(Text, { inverse: true }, cursorValue),
      after
    );
  }

  return React.createElement(Text, { color }, displayValue);
}
