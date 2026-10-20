// useApp hook - access to the Ink app instance
import { useContext } from "npm:react@18.3.1";
import { AppContext, type AppContextValue } from "../contexts/app-context.ts";

/**
 * Hook to access the Ink app instance.
 * Provides ability to exit the application programmatically.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { exit } = useApp();
 *
 *   useEffect(() => {
 *     // Exit after 5 seconds
 *     setTimeout(() => exit(), 5000);
 *   }, []);
 *
 *   return <Text>Exiting in 5 seconds...</Text>;
 * }
 * ```
 */
export function useApp(): AppContextValue {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useApp must be used within an Ink render context");
  }

  return context;
}
