// deno-lint-ignore-file no-explicit-any
// ErrorBoundary component - catches errors in the component tree
import React from "npm:react@18.3.1";
import type { ReactNode, ErrorInfo, ComponentClass } from "npm:react@18.3.1";

export interface ErrorBoundaryProps {
  /**
   * Children to render.
   */
  children: ReactNode;

  /**
   * Fallback content to display when an error occurs.
   * Can be a React element or a function that receives the error.
   */
  fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo) => ReactNode);

  /**
   * Callback when an error is caught.
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// Use a factory function to create the class to avoid Deno's strict type checking issues
function createErrorBoundary(): ComponentClass<ErrorBoundaryProps, ErrorBoundaryState> {
  const Component = React.Component as any;

  return class ErrorBoundaryClass extends Component {
    state: ErrorBoundaryState = {
      hasError: false,
      error: null,
      errorInfo: null,
    };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
      return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
      this.setState({ errorInfo });

      if ((this as any).props.onError) {
        (this as any).props.onError(error, errorInfo);
      }
    }

    render(): ReactNode {
      if (this.state.hasError && this.state.error) {
        const { fallback } = (this as any).props as ErrorBoundaryProps;

        if (fallback === undefined) {
          // Default fallback
          return null;
        }

        if (typeof fallback === "function") {
          return (fallback as any)(this.state.error, this.state.errorInfo!);
        }

        return fallback;
      }

      return (this as any).props.children;
    }
  } as unknown as ComponentClass<ErrorBoundaryProps, ErrorBoundaryState>;
}

/**
 * Error boundary component that catches errors in its children.
 * Prevents the entire app from crashing when a component throws.
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   fallback={(error) => <Text color="red">Error: {error.message}</Text>}
 *   onError={(error) => console.error('Caught error:', error)}
 * >
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export const ErrorBoundary = createErrorBoundary();
