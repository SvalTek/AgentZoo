// Focus context - manages focus state across components
import { createContext } from "npm:react@18.3.1";
import type { FocusManager } from "../focus-manager.ts";

export interface FocusContextValue {
  activeId: string | undefined;
  add: (id: string, options: { autoFocus: boolean }) => void;
  remove: (id: string) => void;
  activate: (id: string) => void;
  deactivate: (id: string) => void;
  enableFocus: () => void;
  disableFocus: () => void;
  focusNext: () => void;
  focusPrevious: () => void;
  focus: (id: string) => void;
  isFocusEnabled: boolean;
}

// Context now holds the focus manager directly for subscription
export interface FocusManagerContextValue {
  manager: FocusManager;
}

export const FocusContext = createContext<FocusContextValue>({
  activeId: undefined,
  add: () => {},
  remove: () => {},
  activate: () => {},
  deactivate: () => {},
  enableFocus: () => {},
  disableFocus: () => {},
  focusNext: () => {},
  focusPrevious: () => {},
  focus: () => {},
  isFocusEnabled: true,
});

export const FocusManagerContext = createContext<FocusManagerContextValue | null>(null);
