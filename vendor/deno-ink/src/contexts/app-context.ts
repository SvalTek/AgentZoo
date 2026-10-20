// App context - provides access to the Ink app instance
import { createContext } from "npm:react@18.3.1";

export interface AppContextValue {
  exit: (error?: Error) => void;
  /**
   * Set the final output to be printed when the app unmounts.
   * This is printed to the terminal after exiting the alternate screen buffer,
   * so it persists in terminal history.
   */
  setFinalOutput: (output: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);
