// Std context - provides access to stdout, stderr, stdin
import { createContext } from "npm:react@18.3.1";

export interface StdoutContextValue {
  stdout: typeof Deno.stdout;
  write: (data: string) => void;
}

export interface StderrContextValue {
  stderr: typeof Deno.stderr;
  write: (data: string) => void;
}

export interface StdinContextValue {
  stdin: typeof Deno.stdin;
  isRawModeSupported: boolean;
  setRawMode: (value: boolean) => void;
}

export const StdoutContext = createContext<StdoutContextValue | null>(null);
export const StderrContext = createContext<StderrContextValue | null>(null);
export const StdinContext = createContext<StdinContextValue | null>(null);
