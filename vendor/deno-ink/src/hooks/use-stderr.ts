// useStderr hook - access to stderr
import { useContext } from "npm:react@18.3.1";
import { StderrContext, type StderrContextValue } from "../contexts/std-context.ts";

/**
 * Hook to access stderr.
 * Use this to write error messages directly to stderr.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { write } = useStderr();
 *
 *   useEffect(() => {
 *     write("Error: something went wrong\n");
 *   }, []);
 *
 *   return <Text>Check stderr for error</Text>;
 * }
 * ```
 */
export function useStderr(): StderrContextValue {
  const context = useContext(StderrContext);

  if (!context) {
    throw new Error("useStderr must be used within an Ink render context");
  }

  return context;
}
