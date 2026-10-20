// SelectInput component - select from a list of options
import React, { useState, useCallback, useEffect } from "npm:react@18.3.1";
import { Box } from "./Box.tsx";
import { Text } from "./Text.tsx";
import { useFocus } from "../hooks/use-focus.ts";
import { useInput, type Key } from "../hooks/use-input.ts";

export interface SelectInputItem<V> {
  /**
   * Display label for the item.
   */
  label: string;

  /**
   * Value of the item.
   */
  value: V;

  /**
   * Unique key for the item (defaults to value if it's a string).
   */
  key?: string;
}

export interface SelectInputProps<V> {
  /**
   * Items to display in the list.
   */
  items: SelectInputItem<V>[];

  /**
   * Callback when an item is highlighted (selected but not submitted).
   */
  onHighlight?: (item: SelectInputItem<V>) => void;

  /**
   * Callback when an item is selected (Enter pressed).
   */
  onSelect?: (item: SelectInputItem<V>) => void;

  /**
   * Whether the component is focused.
   * @default true
   */
  isFocused?: boolean;

  /**
   * Index of initially selected item.
   * @default 0
   */
  initialIndex?: number;

  /**
   * Number of items to display at once (for scrolling).
   * @default 5
   */
  limit?: number;

  /**
   * Character to show before the selected item.
   * @default ">"
   */
  indicatorComponent?: React.ComponentType<{ isSelected: boolean }>;

  /**
   * Component to render each item.
   */
  itemComponent?: React.ComponentType<{
    isSelected: boolean;
    label: string;
  }>;
}

// Default indicator component
function DefaultIndicator({ isSelected }: { isSelected: boolean }): React.ReactElement {
  return React.createElement(
    Box,
    { marginRight: 1 },
    React.createElement(Text, { color: isSelected ? "cyan" : undefined }, isSelected ? ">" : " ")
  );
}

// Default item component
function DefaultItem({
  isSelected,
  label,
}: {
  isSelected: boolean;
  label: string;
}): React.ReactElement {
  return React.createElement(Text, { color: isSelected ? "cyan" : undefined }, label);
}

/**
 * Select from a list of options.
 *
 * @example
 * ```tsx
 * function LanguageSelector() {
 *   const items = [
 *     { label: "JavaScript", value: "js" },
 *     { label: "TypeScript", value: "ts" },
 *     { label: "Python", value: "py" },
 *   ];
 *
 *   return (
 *     <SelectInput
 *       items={items}
 *       onSelect={(item) => console.log("Selected:", item.value)}
 *     />
 *   );
 * }
 * ```
 */
export function SelectInput<V>({
  items,
  onHighlight,
  onSelect,
  isFocused: isFocusedProp,
  initialIndex = 0,
  limit = 5,
  indicatorComponent: IndicatorComponent = DefaultIndicator,
  itemComponent: ItemComponent = DefaultItem,
}: SelectInputProps<V>): React.ReactElement {
  const { isFocused: hookFocused } = useFocus();
  const isFocused = isFocusedProp ?? hookFocused;

  const [selectedIndex, setSelectedIndex] = useState(
    Math.min(initialIndex, Math.max(0, items.length - 1))
  );
  const [scrollOffset, setScrollOffset] = useState(0);

  // Update highlighted item when selection changes
  useEffect(() => {
    if (items[selectedIndex] && onHighlight) {
      onHighlight(items[selectedIndex]);
    }
  }, [selectedIndex, items, onHighlight]);

  // Handle keyboard input
  useInput(
    useCallback(
      (_input: string, key: Key) => {
        if (items.length === 0) return;

        if (key.upArrow) {
          const newIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
          setSelectedIndex(newIndex);

          // Scroll up if needed
          if (newIndex < scrollOffset) {
            setScrollOffset(newIndex);
          } else if (newIndex === items.length - 1) {
            // Wrapped to bottom
            setScrollOffset(Math.max(0, items.length - limit));
          }
          return;
        }

        if (key.downArrow) {
          const newIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
          setSelectedIndex(newIndex);

          // Scroll down if needed
          if (newIndex >= scrollOffset + limit) {
            setScrollOffset(newIndex - limit + 1);
          } else if (newIndex === 0) {
            // Wrapped to top
            setScrollOffset(0);
          }
          return;
        }

        if (key.home) {
          setSelectedIndex(0);
          setScrollOffset(0);
          return;
        }

        if (key.end) {
          const lastIndex = items.length - 1;
          setSelectedIndex(lastIndex);
          setScrollOffset(Math.max(0, items.length - limit));
          return;
        }

        if (key.pageUp) {
          const newIndex = Math.max(0, selectedIndex - limit);
          setSelectedIndex(newIndex);
          setScrollOffset(Math.max(0, scrollOffset - limit));
          return;
        }

        if (key.pageDown) {
          const newIndex = Math.min(items.length - 1, selectedIndex + limit);
          setSelectedIndex(newIndex);
          const maxOffset = Math.max(0, items.length - limit);
          setScrollOffset(Math.min(maxOffset, scrollOffset + limit));
          return;
        }

        if (key.return && onSelect && items[selectedIndex]) {
          onSelect(items[selectedIndex]);
          return;
        }
      },
      [selectedIndex, items, onSelect, scrollOffset, limit]
    ),
    { isActive: isFocused }
  );

  // Calculate visible items
  const visibleItems = items.slice(scrollOffset, scrollOffset + limit);
  const hasScrollUp = scrollOffset > 0;
  const hasScrollDown = scrollOffset + limit < items.length;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    // Scroll up indicator
    hasScrollUp &&
      React.createElement(
        Box,
        null,
        React.createElement(Text, { dimColor: true }, "  ...")
      ),
    // Visible items
    ...visibleItems.map((item, index) => {
      const actualIndex = scrollOffset + index;
      const isSelected = actualIndex === selectedIndex;
      const key = item.key ?? (typeof item.value === "string" ? item.value : String(actualIndex));

      return React.createElement(
        Box,
        { key },
        React.createElement(IndicatorComponent, { isSelected }),
        React.createElement(ItemComponent, { isSelected, label: item.label })
      );
    }),
    // Scroll down indicator
    hasScrollDown &&
      React.createElement(
        Box,
        null,
        React.createElement(Text, { dimColor: true }, "  ...")
      )
  );
}
