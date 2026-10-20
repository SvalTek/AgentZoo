// Transform component - transforms text output
import React from "npm:react@18.3.1";
import type { ReactNode } from "npm:react@18.3.1";

export interface TransformProps {
  /**
   * Children to transform. Can be a string or React elements.
   */
  children?: ReactNode;

  /**
   * Transform function that receives the output string and index, returns transformed text.
   * The function receives the concatenated text content and the index of this text node.
   */
  transform: (text: string, index: number) => string;
}

/**
 * Transform component that applies a transformation function to its children's text output.
 * Useful for effects like gradient text, line numbering, wrapping text in brackets, etc.
 *
 * The transform is applied to the final text output, not to the React element tree.
 * This allows nested transforms to work correctly.
 *
 * @example
 * ```tsx
 * // Wrap text in brackets with index
 * <Transform transform={(text, index) => `[${index}: ${text}]`}>
 *   <Text>hello world</Text>
 * </Transform>
 * // Output: [0: hello world]
 *
 * // Nested transforms
 * <Transform transform={(text, i) => `[${i}: ${text}]`}>
 *   <Text>
 *     <Transform transform={(text, i) => `{${i}: ${text}}`}>
 *       <Text>test</Text>
 *     </Transform>
 *   </Text>
 * </Transform>
 * // Output: [0: {0: test}]
 * ```
 */
export function Transform({ children, transform }: TransformProps) {
  if (children === undefined || children === null) {
    return null;
  }

  // Use React.createElement to avoid JSX intrinsic element type issues
  // deno-lint-ignore no-explicit-any
  return React.createElement(
    "ink-text" as any,
    {
      style: { flexGrow: 0, flexShrink: 1, flexDirection: "row" },
      internal_transform: transform,
    },
    children
  );
}
