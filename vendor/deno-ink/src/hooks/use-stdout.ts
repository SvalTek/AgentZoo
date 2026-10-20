// useStdout hook - access to stdout
import { useContext } from "npm:react@18.3.1";
import { StdoutContext, type StdoutContextValue } from "../contexts/std-context.ts";

/**
 * Hook to access stdout.
 * Use this to write directly to stdout outside of Ink's rendering.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { write } = useStdout();
 *
 *   useEffect(() => {
 *     write("Hello from stdout!\n");
 *   }, []);
 *
 *   return <Text>Check stdout for message</Text>;
 * }
 * ```
 */
export function useStdout(): StdoutContextValue {
  const context = useContext(StdoutContext);

  if (!context) {
    throw new Error("useStdout must be used within an Ink render context");
  }

  return context;
}
