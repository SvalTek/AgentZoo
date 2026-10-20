// Static component for persistent output (based on Ink's Static)
import React, {
  useState,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "npm:react@18.3.1";
import type { Styles } from "../styles.ts";

// deno-lint-ignore no-explicit-any
type AnyComponent = React.ComponentType<any>;

export interface StaticProps<T> {
  /**
   * Array of items to render
   */
  items: T[];

  /**
   * Custom styles for the container
   */
  style?: Styles;

  /**
   * Render function for each item
   */
  children?: (item: T, index: number) => ReactNode;
}

/**
 * Static component for rendering persistent output.
 * Items are rendered once and stay above the dynamic UI.
 */
export function Static<T>({
  items,
  children: render,
  style: customStyle,
}: StaticProps<T>): React.ReactElement | null {
  const [index, setIndex] = useState(0);

  // Only render new items since last render
  const itemsToRender = useMemo(() => {
    return items.slice(index);
  }, [items, index]);

  // Update index after render
  useLayoutEffect(() => {
    setIndex(items.length);
  }, [items.length]);

  const style: Styles = useMemo(
    () => ({
      position: "absolute",
      flexDirection: "column",
      ...customStyle,
    }),
    [customStyle]
  );

  // Return null if no render function or no items to render
  // This prevents empty frames after initial render
  if (!render || itemsToRender.length === 0) {
    return null;
  }

  const children = itemsToRender.map((item: T, itemIndex: number) => {
    return render(item, index + itemIndex);
  });

  // deno-lint-ignore no-explicit-any
  return React.createElement(
    "ink-box" as any,
    { style, internal_static: true },
    children
  );
}
