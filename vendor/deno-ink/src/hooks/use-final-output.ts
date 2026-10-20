// useFinalOutput hook - set output to print after unmount
import { useCallback } from "npm:react@18.3.1";
import { useApp } from "./use-app.ts";

/**
 * Hook to set the final output that will be printed after the app unmounts.
 *
 * The final output is printed AFTER exiting the alternate screen buffer,
 * so it persists in the terminal's scrollback history. This is useful for
 * showing a minimal summary of what happened during the interactive session.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const setFinalOutput = useFinalOutput();
 *
 *   useEffect(() => {
 *     if (isComplete) {
 *       setFinalOutput("✓ Task completed!\n→ output.txt");
 *     }
 *   }, [isComplete]);
 *
 *   return <Text>Working...</Text>;
 * }
 * ```
 */
export function useFinalOutput(): (output: string) => void {
  const { setFinalOutput } = useApp();

  return useCallback(
    (output: string) => {
      setFinalOutput(output);
    },
    [setFinalOutput]
  );
}
