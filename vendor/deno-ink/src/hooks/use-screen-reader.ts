/**
 * Hook to check if a screen reader is enabled.
 */

import { useContext } from "npm:react@18.3.1";
import { AccessibilityContext } from "../contexts/accessibility-context.ts";

/**
 * Returns whether a screen reader is currently enabled.
 *
 * Screen reader mode can be enabled via:
 * - The `isScreenReaderEnabled` option in render()
 * - Setting the `INK_SCREEN_READER=1` environment variable
 *
 * When screen reader mode is enabled, rendering may be adjusted
 * to provide better accessibility.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isScreenReaderEnabled = useIsScreenReaderEnabled();
 *
 *   if (isScreenReaderEnabled) {
 *     return <Text>Accessible description of content</Text>;
 *   }
 *
 *   return <Spinner />;
 * }
 * ```
 */
export function useIsScreenReaderEnabled(): boolean {
  const { isScreenReaderEnabled } = useContext(AccessibilityContext);
  return isScreenReaderEnabled;
}
