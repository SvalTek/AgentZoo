// useTerminalSize hook - get terminal dimensions with live updates
import { useState, useEffect } from "npm:react@18.3.1";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Hook to get the current terminal size with live updates.
 *
 * Polls for terminal size changes and triggers re-renders when
 * the terminal is resized. Useful for responsive layouts.
 *
 * @param pollInterval - How often to check for size changes (ms). Default: 100
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { columns, rows } = useTerminalSize();
 *
 *   return (
 *     <Box width={columns - 4}>
 *       <Text>Terminal is {columns}x{rows}</Text>
 *     </Box>
 *   );
 * }
 * ```
 */
export function useTerminalSize(pollInterval = 1000): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => {
    try {
      const consoleSize = Deno.consoleSize();
      return { columns: consoleSize.columns, rows: consoleSize.rows };
    } catch {
      return { columns: 80, rows: 24 };
    }
  });

  useEffect(() => {
    const checkSize = (): void => {
      try {
        const consoleSize = Deno.consoleSize();
        if (consoleSize.columns !== size.columns || consoleSize.rows !== size.rows) {
          setSize({ columns: consoleSize.columns, rows: consoleSize.rows });
        }
      } catch {
        // Ignore errors (not a TTY, etc.)
      }
    };

    const interval = setInterval(checkSize, pollInterval);
    return () => clearInterval(interval);
  }, [size.columns, size.rows, pollInterval]);

  return size;
}
