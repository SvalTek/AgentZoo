// deno-lint-ignore-file no-explicit-any
import type { Node as YogaNode } from "npm:yoga-wasm-web@0.3.3";
import type { Yoga } from "npm:yoga-wasm-web@0.3.3";

export interface Styles {
  // Positioning
  position?: "absolute" | "relative";

  // Dimensions
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;

  // Flex
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch";
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch";
  justifyContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly";

  // Spacing
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginX?: number;
  marginY?: number;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingX?: number;
  paddingY?: number;
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Display
  display?: "flex" | "none";

  // Border
  borderStyle?: "single" | "double" | "round" | "bold" | "singleDouble" | "doubleSingle" | "classic" | {
    topLeft: string;
    top: string;
    topRight: string;
    left: string;
    bottomLeft: string;
    bottom: string;
    bottomRight: string;
    right: string;
  };
  borderTop?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderRight?: boolean;
  borderColor?: string;
  borderTopColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderRightColor?: string;
  borderDimColor?: boolean;
}

export function applyStyles(
  yogaNode: YogaNode,
  style: Styles = {},
  yoga: Yoga
): void {
  // Position
  if (style.position === "absolute") {
    yogaNode.setPositionType(yoga.POSITION_TYPE_ABSOLUTE);
  }

  // Dimensions - reset to auto when undefined, set value when defined
  if (style.width !== undefined) {
    if (typeof style.width === "string" && style.width.endsWith("%")) {
      yogaNode.setWidthPercent(parseFloat(style.width));
    } else if (typeof style.width === "number") {
      yogaNode.setWidth(style.width);
    }
  } else {
    yogaNode.setWidthAuto();
  }

  if (style.height !== undefined) {
    if (typeof style.height === "string" && style.height.endsWith("%")) {
      yogaNode.setHeightPercent(parseFloat(style.height));
    } else if (typeof style.height === "number") {
      yogaNode.setHeight(style.height);
    }
  } else {
    yogaNode.setHeightAuto();
  }

  if (style.minWidth !== undefined) {
    if (typeof style.minWidth === "string" && style.minWidth.endsWith("%")) {
      yogaNode.setMinWidthPercent(parseFloat(style.minWidth));
    } else if (typeof style.minWidth === "number") {
      yogaNode.setMinWidth(style.minWidth);
    }
  }

  if (style.minHeight !== undefined) {
    if (typeof style.minHeight === "string" && style.minHeight.endsWith("%")) {
      yogaNode.setMinHeightPercent(parseFloat(style.minHeight));
    } else if (typeof style.minHeight === "number") {
      yogaNode.setMinHeight(style.minHeight);
    }
  }

  if (style.maxWidth !== undefined) {
    if (typeof style.maxWidth === "string" && style.maxWidth.endsWith("%")) {
      yogaNode.setMaxWidthPercent(parseFloat(style.maxWidth));
    } else if (typeof style.maxWidth === "number") {
      yogaNode.setMaxWidth(style.maxWidth);
    }
  }

  if (style.maxHeight !== undefined) {
    if (typeof style.maxHeight === "string" && style.maxHeight.endsWith("%")) {
      yogaNode.setMaxHeightPercent(parseFloat(style.maxHeight));
    } else if (typeof style.maxHeight === "number") {
      yogaNode.setMaxHeight(style.maxHeight);
    }
  }

  // Flex
  if (style.flexGrow !== undefined) {
    yogaNode.setFlexGrow(style.flexGrow);
  }

  // Set flexShrink (default to 1 to match CSS behavior, unlike Yoga's default of 0)
  yogaNode.setFlexShrink(style.flexShrink ?? 1);

  if (style.flexBasis !== undefined) {
    if (typeof style.flexBasis === "number") {
      yogaNode.setFlexBasis(style.flexBasis);
    }
  }

  // Set flex direction (default to row, unlike Yoga's default of column)
  const directions: Record<string, any> = {
    row: yoga.FLEX_DIRECTION_ROW,
    column: yoga.FLEX_DIRECTION_COLUMN,
    "row-reverse": yoga.FLEX_DIRECTION_ROW_REVERSE,
    "column-reverse": yoga.FLEX_DIRECTION_COLUMN_REVERSE,
  };
  const flexDir = style.flexDirection ?? "row";
  yogaNode.setFlexDirection(directions[flexDir]);

  if (style.flexWrap !== undefined) {
    const wraps: Record<string, any> = {
      nowrap: yoga.WRAP_NO_WRAP,
      wrap: yoga.WRAP_WRAP,
      "wrap-reverse": yoga.WRAP_WRAP_REVERSE,
    };
    yogaNode.setFlexWrap(wraps[style.flexWrap]);
  }

  if (style.alignItems !== undefined) {
    const alignments: Record<string, any> = {
      "flex-start": yoga.ALIGN_FLEX_START,
      "flex-end": yoga.ALIGN_FLEX_END,
      center: yoga.ALIGN_CENTER,
      stretch: yoga.ALIGN_STRETCH,
    };
    yogaNode.setAlignItems(alignments[style.alignItems]);
  }

  if (style.alignSelf !== undefined) {
    const alignments: Record<string, any> = {
      auto: yoga.ALIGN_AUTO,
      "flex-start": yoga.ALIGN_FLEX_START,
      "flex-end": yoga.ALIGN_FLEX_END,
      center: yoga.ALIGN_CENTER,
      stretch: yoga.ALIGN_STRETCH,
    };
    yogaNode.setAlignSelf(alignments[style.alignSelf]);
  }

  if (style.justifyContent !== undefined) {
    const justifications: Record<string, any> = {
      "flex-start": yoga.JUSTIFY_FLEX_START,
      "flex-end": yoga.JUSTIFY_FLEX_END,
      center: yoga.JUSTIFY_CENTER,
      "space-between": yoga.JUSTIFY_SPACE_BETWEEN,
      "space-around": yoga.JUSTIFY_SPACE_AROUND,
      "space-evenly": yoga.JUSTIFY_SPACE_EVENLY,
    };
    yogaNode.setJustifyContent(justifications[style.justifyContent]);
  }

  // Margin
  const marginTop = style.marginTop ?? style.marginY ?? style.margin ?? 0;
  const marginBottom = style.marginBottom ?? style.marginY ?? style.margin ?? 0;
  const marginLeft = style.marginLeft ?? style.marginX ?? style.margin ?? 0;
  const marginRight = style.marginRight ?? style.marginX ?? style.margin ?? 0;

  yogaNode.setMargin(yoga.EDGE_TOP, marginTop);
  yogaNode.setMargin(yoga.EDGE_BOTTOM, marginBottom);
  yogaNode.setMargin(yoga.EDGE_LEFT, marginLeft);
  yogaNode.setMargin(yoga.EDGE_RIGHT, marginRight);

  // Padding
  const paddingTop = style.paddingTop ?? style.paddingY ?? style.padding ?? 0;
  const paddingBottom = style.paddingBottom ?? style.paddingY ?? style.padding ?? 0;
  const paddingLeft = style.paddingLeft ?? style.paddingX ?? style.padding ?? 0;
  const paddingRight = style.paddingRight ?? style.paddingX ?? style.padding ?? 0;

  yogaNode.setPadding(yoga.EDGE_TOP, paddingTop);
  yogaNode.setPadding(yoga.EDGE_BOTTOM, paddingBottom);
  yogaNode.setPadding(yoga.EDGE_LEFT, paddingLeft);
  yogaNode.setPadding(yoga.EDGE_RIGHT, paddingRight);

  // Gap
  if (style.gap !== undefined) {
    yogaNode.setGap(yoga.GUTTER_ALL, style.gap);
  }
  if (style.rowGap !== undefined) {
    yogaNode.setGap(yoga.GUTTER_ROW, style.rowGap);
  }
  if (style.columnGap !== undefined) {
    yogaNode.setGap(yoga.GUTTER_COLUMN, style.columnGap);
  }

  // Display
  if (style.display === "none") {
    yogaNode.setDisplay(yoga.DISPLAY_NONE);
  } else {
    yogaNode.setDisplay(yoga.DISPLAY_FLEX);
  }

  // Border (adds 1 to each side with border)
  if (style.borderStyle) {
    const borderTop = style.borderTop !== false ? 1 : 0;
    const borderBottom = style.borderBottom !== false ? 1 : 0;
    const borderLeft = style.borderLeft !== false ? 1 : 0;
    const borderRight = style.borderRight !== false ? 1 : 0;

    yogaNode.setBorder(yoga.EDGE_TOP, borderTop);
    yogaNode.setBorder(yoga.EDGE_BOTTOM, borderBottom);
    yogaNode.setBorder(yoga.EDGE_LEFT, borderLeft);
    yogaNode.setBorder(yoga.EDGE_RIGHT, borderRight);
  }
}
