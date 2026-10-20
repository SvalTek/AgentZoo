// useInput hook for keyboard interactivity
import { useEffect, useContext, useRef, createContext } from "npm:react@18.3.1";

export interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
}

export type InputHandler = (input: string, key: Key) => void;

export interface UseInputOptions {
  isActive?: boolean;
}

// Input context for sharing stdin across components
interface InputContextValue {
  subscribe: (handler: InputHandler) => () => void;
  isRawModeSupported: boolean;
}

export const InputContext = createContext<InputContextValue | null>(null);

// Key sequence mappings
const KEY_SEQUENCES: Record<string, Partial<Key>> = {
  "\x1b[A": { upArrow: true },
  "\x1b[B": { downArrow: true },
  "\x1b[C": { rightArrow: true },
  "\x1b[D": { leftArrow: true },
  "\x1b[5~": { pageUp: true },
  "\x1b[6~": { pageDown: true },
  "\x1b[H": { home: true },
  "\x1b[F": { end: true },
  "\x1b[1~": { home: true }, // Alternative Home sequence
  "\x1b[4~": { end: true }, // Alternative End sequence
  "\x1bOH": { home: true }, // Another Home variant (application mode)
  "\x1bOF": { end: true }, // Another End variant (application mode)
  "\r": { return: true },
  "\n": { return: true },
  "\x1b": { escape: true },
  "\t": { tab: true },
  "\x7f": { backspace: true },
  "\x1b[3~": { delete: true },
};

/**
 * Parse input data into a Key object
 */
export function parseKey(input: string): Key {
  const key: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
  };

  // Check for known sequences
  const sequenceKey = KEY_SEQUENCES[input];
  if (sequenceKey) {
    Object.assign(key, sequenceKey);
  }

  // Check for Ctrl+key (ASCII 1-26)
  if (input.length === 1) {
    const code = input.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      key.ctrl = true;
    }
  }

  // Check for shift (uppercase letters)
  if (input.length === 1 && input >= "A" && input <= "Z") {
    key.shift = true;
  }

  return key;
}

/**
 * Hook to handle keyboard input
 */
export function useInput(
  inputHandler: InputHandler,
  options: UseInputOptions = {}
): void {
  const { isActive = true } = options;
  const inputContext = useContext(InputContext);

  // Use a ref to store the handler so we don't re-subscribe on every render
  const handlerRef = useRef<InputHandler>(inputHandler);
  handlerRef.current = inputHandler;

  useEffect(() => {
    if (!isActive || !inputContext) {
      return;
    }

    const handler: InputHandler = (input, key) => {
      handlerRef.current(input, key);
    };

    const unsubscribe = inputContext.subscribe(handler);

    return () => {
      unsubscribe();
    };
  }, [isActive, inputContext]);
}

/**
 * Create an input manager for the Ink instance
 */
export function createInputManager(_debug = false) {
  const handlers = new Set<InputHandler>();

  return {
    subscribe(handler: InputHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    emit(input: string): void {
      const key = parseKey(input);
      for (const handler of handlers) {
        handler(input, key);
      }
    },

    get isRawModeSupported(): boolean {
      try {
        return Deno.stdin.isTerminal();
      } catch {
        return false;
      }
    },
  };
}
