// useFocusManager hook - control focus programmatically
import { useContext, useCallback } from "npm:react@18.3.1";
import { FocusManagerContext } from "../contexts/focus-context.ts";

export interface UseFocusManagerResult {
  /**
   * Enable focus management. Focus will be restored to the last focused component.
   */
  enableFocus: () => void;

  /**
   * Disable focus management. No component will be focused.
   */
  disableFocus: () => void;

  /**
   * Move focus to the next focusable component.
   */
  focusNext: () => void;

  /**
   * Move focus to the previous focusable component.
   */
  focusPrevious: () => void;

  /**
   * Focus a specific component by its ID.
   */
  focus: (id: string) => void;
}

/**
 * Hook to manage focus programmatically.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { focusNext, focusPrevious } = useFocusManager();
 *
 *   useInput((input, key) => {
 *     if (key.tab) {
 *       if (key.shift) {
 *         focusPrevious();
 *       } else {
 *         focusNext();
 *       }
 *     }
 *   });
 *
 *   return (
 *     <Box flexDirection="column">
 *       <Button label="Button 1" />
 *       <Button label="Button 2" />
 *       <Button label="Button 3" />
 *     </Box>
 *   );
 * }
 * ```
 */
export function useFocusManager(): UseFocusManagerResult {
  const focusManagerContext = useContext(FocusManagerContext);

  const enableFocus = useCallback(() => {
    const ctx = focusManagerContext?.manager.getContextValue();
    ctx?.enableFocus();
  }, [focusManagerContext]);

  const disableFocus = useCallback(() => {
    const ctx = focusManagerContext?.manager.getContextValue();
    ctx?.disableFocus();
  }, [focusManagerContext]);

  const focusNext = useCallback(() => {
    const ctx = focusManagerContext?.manager.getContextValue();
    ctx?.focusNext();
  }, [focusManagerContext]);

  const focusPrevious = useCallback(() => {
    const ctx = focusManagerContext?.manager.getContextValue();
    ctx?.focusPrevious();
  }, [focusManagerContext]);

  const focus = useCallback(
    (id: string) => {
      const ctx = focusManagerContext?.manager.getContextValue();
      ctx?.focus(id);
    },
    [focusManagerContext]
  );

  return {
    enableFocus,
    disableFocus,
    focusNext,
    focusPrevious,
    focus,
  };
}
