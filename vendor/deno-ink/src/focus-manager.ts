// Focus manager - manages focus state for the Ink instance
import type { FocusContextValue } from "./contexts/focus-context.ts";

interface FocusableComponent {
  id: string;
  isActive: boolean;
}

export interface FocusManager {
  getContextValue: () => FocusContextValue;
  subscribe: (callback: () => void) => () => void;
}

/**
 * Creates a focus manager to track and manage focusable components.
 */
export function createFocusManager(): FocusManager {
  const focusables: FocusableComponent[] = [];
  let activeId: string | undefined;
  let isFocusEnabled = true;
  const subscribers = new Set<() => void>();

  const notify = () => {
    for (const callback of subscribers) {
      callback();
    }
  };

  const getActiveFocusables = () => focusables.filter((f) => f.isActive);

  const focusNext = () => {
    if (!isFocusEnabled) return;

    const activeFocusables = getActiveFocusables();
    if (activeFocusables.length === 0) return;

    const currentIndex = activeFocusables.findIndex((f) => f.id === activeId);

    if (currentIndex === -1) {
      // No current focus, focus the first item
      activeId = activeFocusables[0].id;
    } else {
      // Move to next, wrap around
      const nextIndex = (currentIndex + 1) % activeFocusables.length;
      activeId = activeFocusables[nextIndex].id;
    }

    notify();
  };

  const focusPrevious = () => {
    if (!isFocusEnabled) return;

    const activeFocusables = getActiveFocusables();
    if (activeFocusables.length === 0) return;

    const currentIndex = activeFocusables.findIndex((f) => f.id === activeId);

    if (currentIndex === -1) {
      // No current focus, focus the last item
      activeId = activeFocusables[activeFocusables.length - 1].id;
    } else {
      // Move to previous, wrap around
      const prevIndex = (currentIndex - 1 + activeFocusables.length) % activeFocusables.length;
      activeId = activeFocusables[prevIndex].id;
    }

    notify();
  };

  const focus = (id: string) => {
    if (!isFocusEnabled) return;

    const focusable = focusables.find((f) => f.id === id && f.isActive);
    if (focusable) {
      activeId = id;
      notify();
    }
  };

  const add = (id: string, options: { autoFocus: boolean }) => {
    // Don't add duplicates
    if (focusables.some((f) => f.id === id)) return;

    focusables.push({ id, isActive: true });

    // Auto-focus if requested and nothing is focused
    if (options.autoFocus && (activeId === undefined || !getActiveFocusables().some((f) => f.id === activeId))) {
      activeId = id;
    }

    // If nothing is focused and focus is enabled, focus the first item
    if (isFocusEnabled && activeId === undefined && focusables.length === 1) {
      activeId = id;
    }

    notify();
  };

  const remove = (id: string) => {
    const index = focusables.findIndex((f) => f.id === id);
    if (index === -1) return;

    focusables.splice(index, 1);

    // If the removed item was focused, focus the next available
    if (activeId === id) {
      const activeFocusables = getActiveFocusables();
      activeId = activeFocusables.length > 0 ? activeFocusables[0].id : undefined;
    }

    notify();
  };

  const activate = (id: string) => {
    const focusable = focusables.find((f) => f.id === id);
    if (focusable) {
      focusable.isActive = true;
      notify();
    }
  };

  const deactivate = (id: string) => {
    const focusable = focusables.find((f) => f.id === id);
    if (focusable) {
      focusable.isActive = false;

      // If this was the focused item, move focus
      if (activeId === id) {
        const activeFocusables = getActiveFocusables();
        activeId = activeFocusables.length > 0 ? activeFocusables[0].id : undefined;
      }

      notify();
    }
  };

  const enableFocus = () => {
    if (isFocusEnabled) return;
    isFocusEnabled = true;

    // Focus the first available if nothing is focused
    if (activeId === undefined) {
      const activeFocusables = getActiveFocusables();
      if (activeFocusables.length > 0) {
        activeId = activeFocusables[0].id;
      }
    }

    notify();
  };

  const disableFocus = () => {
    if (!isFocusEnabled) return;
    isFocusEnabled = false;
    notify();
  };

  const getContextValue = (): FocusContextValue => ({
    activeId: isFocusEnabled ? activeId : undefined,
    add,
    remove,
    activate,
    deactivate,
    enableFocus,
    disableFocus,
    focusNext,
    focusPrevious,
    focus,
    isFocusEnabled,
  });

  const subscribe = (callback: () => void): (() => void) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  };

  return {
    getContextValue,
    subscribe,
  };
}
