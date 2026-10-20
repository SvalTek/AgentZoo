// useStdin hook - access to stdin
import { useContext } from "npm:react@18.3.1";
import { StdinContext, type StdinContextValue } from "../contexts/std-context.ts";

/**
 * Hook to access stdin.
 * Use this to read from stdin or control raw mode.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { setRawMode, isRawModeSupported } = useStdin();
 *
 *   useEffect(() => {
 *     if (isRawModeSupported) {
 *       setRawMode(true);
 *       return () => setRawMode(false);
 *     }
 *   }, []);
 *
 *   return <Text>Raw mode: {isRawModeSupported ? "enabled" : "not supported"}</Text>;
 * }
 * ```
 */
export function useStdin(): StdinContextValue {
  const context = useContext(StdinContext);

  if (!context) {
    throw new Error("useStdin must be used within an Ink render context");
  }

  return context;
}
