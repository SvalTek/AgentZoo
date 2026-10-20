// deno-lint-ignore-file no-explicit-any
import cliBoxes from "npm:cli-boxes@3.0.0";
import stringWidth from "npm:string-width@7.2.0";
import type { DOMElement, DOMNode } from "./dom.ts";
import { isTextNode, squashTextNodes } from "./dom.ts";
import { Output, wrapText, truncateText } from "./output.ts";
import {
  colorize,
  bold,
  dim,
  italic,
  underline,
  inverse,
  strikethrough,
} from "./colors.ts";

interface RenderContext {
  output: Output;
  offsetX: number;
  offsetY: number;
}

// Apply text styles
function applyTextStyles(
  text: string,
  style: Record<string, any>
): string {
  let result = text;

  if (style.dimColor) {
    result = dim(result);
  }

  if (style.color) {
    result = colorize(result, style.color, "foreground");
  }

  if (style.backgroundColor) {
    result = colorize(result, style.backgroundColor, "background");
  }

  if (style.bold) {
    result = bold(result);
  }

  if (style.italic) {
    result = italic(result);
  }

  if (style.underline) {
    result = underline(result);
  }

  if (style.strikethrough) {
    result = strikethrough(result);
  }

  if (style.inverse) {
    result = inverse(result);
  }

  return result;
}

// Get border box characters (supports named styles or custom objects)
function getBorderBox(borderStyle: any): {
  topLeft: string;
  top: string;
  topRight: string;
  left: string;
  bottomLeft: string;
  bottom: string;
  bottomRight: string;
  right: string;
} {
  // Custom border style object
  if (typeof borderStyle === "object" && borderStyle !== null) {
    return borderStyle;
  }

  // Named border style
  const boxStyle = cliBoxes[borderStyle as keyof typeof cliBoxes];
  return (boxStyle && "topLeft" in boxStyle) ? boxStyle : cliBoxes.single;
}

// Render a border around content
function renderBorder(
  output: Output,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Record<string, any>
): void {
  const box = getBorderBox(style.borderStyle || "single");

  const showTop = style.borderTop !== false;
  const showBottom = style.borderBottom !== false;
  const showLeft = style.borderLeft !== false;
  const showRight = style.borderRight !== false;

  const topColor = style.borderTopColor || style.borderColor;
  const bottomColor = style.borderBottomColor || style.borderColor;
  const leftColor = style.borderLeftColor || style.borderColor;
  const rightColor = style.borderRightColor || style.borderColor;
  const applyDim = style.borderDimColor === true;

  // Helper to apply color and dim
  // Note: Apply color FIRST, then dim (matches original Ink behavior)
  const applyBorderStyle = (text: string, color?: string): string => {
    let result = text;
    if (color) {
      result = colorize(result, color, "foreground");
    }
    if (applyDim) {
      result = dim(result);
    }
    return result;
  };

  // Determine corner characters based on which borders are shown
  const getTopLeftChar = () => {
    if (!showTop && !showLeft) return "";
    if (!showTop) return box.left;
    if (!showLeft) return box.top;
    return box.topLeft;
  };

  const getTopRightChar = () => {
    if (!showTop && !showRight) return "";
    if (!showTop) return box.right;
    if (!showRight) return box.top;
    return box.topRight;
  };

  const getBottomLeftChar = () => {
    if (!showBottom && !showLeft) return "";
    if (!showBottom) return box.left;
    if (!showLeft) return box.bottom;
    return box.bottomLeft;
  };

  const getBottomRightChar = () => {
    if (!showBottom && !showRight) return "";
    if (!showBottom) return box.right;
    if (!showRight) return box.bottom;
    return box.bottomRight;
  };

  // Top border
  if (showTop && height > 0) {
    const topLeft = showLeft ? getTopLeftChar() : "";
    const topRight = showRight ? getTopRightChar() : "";
    const topRepeat = Math.max(0, width - (showLeft ? 1 : 0) - (showRight ? 1 : 0));
    let topBorder = topLeft + box.top.repeat(topRepeat) + topRight;
    topBorder = applyBorderStyle(topBorder, topColor);
    output.write(x, y, topBorder);
  }

  // Left and right borders - calculate positioning based on which borders are shown
  const verticalBorderStartY = showTop ? 1 : 0;
  let verticalBorderHeight = height;
  if (showTop) verticalBorderHeight -= 1;
  if (showBottom) verticalBorderHeight -= 1;

  for (let row = 0; row < verticalBorderHeight; row++) {
    if (showLeft) {
      let leftChar = box.left;
      leftChar = applyBorderStyle(leftChar, leftColor);
      output.write(x, y + verticalBorderStartY + row, leftChar);
    }
    if (showRight) {
      let rightChar = box.right;
      rightChar = applyBorderStyle(rightChar, rightColor);
      output.write(x + width - 1, y + verticalBorderStartY + row, rightChar);
    }
  }

  // Bottom border
  if (showBottom && height > 1) {
    const bottomLeft = showLeft ? getBottomLeftChar() : "";
    const bottomRight = showRight ? getBottomRightChar() : "";
    const bottomRepeat = Math.max(0, width - (showLeft ? 1 : 0) - (showRight ? 1 : 0));
    let bottomBorder = bottomLeft + box.bottom.repeat(bottomRepeat) + bottomRight;
    bottomBorder = applyBorderStyle(bottomBorder, bottomColor);
    output.write(x, y + height - 1, bottomBorder);
  }
}

// Main render function
export function renderNode(
  node: DOMNode,
  context: RenderContext
): void {
  if (isTextNode(node)) {
    return; // Text nodes are handled by their parent
  }

  const yogaNode = node.yogaNode;
  if (!yogaNode) return;

  // Check for display: none - skip rendering entirely
  // Yoga DISPLAY_NONE = 1
  if (yogaNode.getDisplay() === 1) {
    return;
  }

  const x = context.offsetX + yogaNode.getComputedLeft();
  const y = context.offsetY + yogaNode.getComputedTop();
  const width = yogaNode.getComputedWidth();
  const height = yogaNode.getComputedHeight();

  const style = node.style || {};

  // Render background
  if (style.backgroundColor) {
    for (let row = 0; row < height; row++) {
      const bgLine = colorize(" ".repeat(width), style.backgroundColor, "background");
      context.output.write(x, y + row, bgLine);
    }
  }

  // Render border
  if (style.borderStyle) {
    renderBorder(context.output, x, y, width, height, style);
  }

  // Handle text nodes
  if (node.nodeName === "ink-text") {
    const text = squashTextNodes(node);
    const paddingLeft = yogaNode.getComputedPadding(1 as any) || 0; // EDGE_LEFT
    const paddingTop = yogaNode.getComputedPadding(0 as any) || 0; // EDGE_TOP

    const borderLeft = style.borderStyle && style.borderLeft !== false ? 1 : 0;
    const borderTop = style.borderStyle && style.borderTop !== false ? 1 : 0;

    const innerX = x + paddingLeft + borderLeft;
    const innerY = y + paddingTop + borderTop;

    // Calculate available width for text
    const borderRight = style.borderStyle && style.borderRight !== false ? 1 : 0;
    const paddingRight = yogaNode.getComputedPadding(3 as any) || 0; // EDGE_RIGHT
    const availableWidth = width - paddingLeft - paddingRight - borderLeft - borderRight;

    // Process text based on wrap style
    let processedText = text;
    if (style.wrap === "truncate") {
      processedText = truncateText(text, availableWidth, "end");
    } else if (style.wrap === "truncate-middle") {
      processedText = truncateText(text, availableWidth, "middle");
    } else if (style.wrap === "truncate-start") {
      processedText = truncateText(text, availableWidth, "start");
    } else {
      // Default: wrap text
      processedText = wrapText(text, availableWidth);
    }

    // Apply the node's own internal_transform if present
    // Transforms are applied per-line, with the line index
    if (typeof node.internal_transform === "function") {
      const lines = processedText.split("\n");
      processedText = lines.map((line, index) => node.internal_transform!(line, index)).join("\n");
    }

    // Apply text styles
    const styledText = applyTextStyles(processedText, style);

    // Write each line
    const lines = styledText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      context.output.write(innerX, innerY + i, lines[i]);
    }

    return;
  }

  // Render children
  const childContext: RenderContext = {
    output: context.output,
    offsetX: x,
    offsetY: y,
  };

  for (const child of node.childNodes) {
    renderNode(child, childContext);
  }
}

// Calculate dimensions and render to string
export function renderToString(
  node: DOMElement,
  terminalWidth: number
): { output: string; height: number } {
  // Calculate layout
  const yogaNode = node.yogaNode;
  if (!yogaNode) {
    return { output: "", height: 0 };
  }

  yogaNode.calculateLayout(terminalWidth, undefined);

  const yogaHeight = Math.ceil(yogaNode.getComputedHeight());
  // Use a larger buffer to accommodate text wrapping (text may wrap to more lines than yoga calculates)
  // The actual output will be clipped to the computed yoga height
  const bufferHeight = Math.max(yogaHeight * 3, 100);
  const output = new Output({ width: terminalWidth, height: bufferHeight });

  renderNode(node, {
    output,
    offsetX: 0,
    offsetY: 0,
  });

  // Clip output to the computed yoga height
  return {
    output: output.get(yogaHeight),
    height: Math.min(output.getHeight(), yogaHeight),
  };
}
