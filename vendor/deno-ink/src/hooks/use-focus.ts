// useFocus hook - makes component focusable
import { useContext, useEffect, useRef, useState, useCallback } from "npm:react@18.3.1";
import { FocusContext, FocusManagerContext } from "../contexts/focus-context.ts";

export interface UseFocusOptions {
  /**
   * Enable or disable focus for the component.
   * @default true
   */
  isActive?: boolean;

  /**
   * Automatically focus this component when it mounts.
   * @default false
   */
  autoFocus?: boolean;

  /**
   * Unique identifier for this focusable component.
   * Auto-generated if not provided.
   */
  id?: string;
}

export interface UseFocusResult {
  /**
   * Whether this component is currently focused.
   */
  isFocused: boolean;

  /**
   * Programmatically focus this component.
   */
  focus: () => void;
}

let focusIdCounter = 0;

/**
 * Hook to make a component focusable.
 *
 * @example
 * ```tsx
 * function Button({ label }: { label: string }) {
 *   const { isFocused } = useFocus();
 *
 *   return (
 *     <Box borderStyle={isFocused ? "bold" : "single"}>
 *       <Text color={isFocused ? "cyan" : undefined}>{label}</Text>
 *     </Box>
 *   );
 * }
 * ```
 */
export function useFocus(options: UseFocusOptions = {}): UseFocusResult {
  const { isActive = true, autoFocus = false, id: providedId } = options;
  const focusManagerContext = useContext(FocusManagerContext);
  const idRef = useRef<string>(providedId ?? `focus-${++focusIdCounter}`);
  const id = idRef.current;

  // Track focus state with local state that syncs with focus manager
  const [isFocused, setIsFocused] = useState(false);

  // Get the focus context for operations
  const getContext = useCallback(() => {
    return focusManagerContext?.manager.getContextValue();
  }, [focusManagerContext]);

  // Subscribe to focus manager changes
  useEffect(() => {
    if (!focusManagerContext) return;

    const updateFocusState = () => {
      const ctx = focusManagerContext.manager.getContextValue();
      setIsFocused(isActive && ctx.activeId === id);
    };

    // Initial check
    updateFocusState();

    // Subscribe to changes
    const unsubscribe = focusManagerContext.manager.subscribe(updateFocusState);
    return unsubscribe;
  }, [focusManagerContext, isActive, id]);

  // Register with focus manager
  useEffect(() => {
    if (!isActive || !focusManagerContext) {
      return;
    }

    const ctx = getContext();
    if (ctx) {
      ctx.add(id, { autoFocus });
    }

    return () => {
      const ctx = getContext();
      if (ctx) {
        ctx.remove(id);
      }
    };
  }, [isActive, id, autoFocus, getContext, focusManagerContext]);

  // Handle activation/deactivation
  useEffect(() => {
    if (!focusManagerContext) return;

    const ctx = getContext();
    if (!ctx) return;

    if (!isActive) {
      ctx.deactivate(id);
    } else {
      ctx.activate(id);
    }
  }, [isActive, id, getContext, focusManagerContext]);

  const focus = useCallback(() => {
    const ctx = getContext();
    if (ctx) {
      ctx.focus(id);
    }
  }, [getContext, id]);

  return {
    isFocused,
    focus,
  };
}
