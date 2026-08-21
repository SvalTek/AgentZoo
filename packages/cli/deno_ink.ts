/**
 * Compatibility shim for @deno-ink/core 0.2.1.
 *
 * That release pins every ink-text Yoga node to its unwrapped natural width.
 * The renderer subsequently uses that same width to wrap, so text can escape
 * a narrower parent Box. Keep the public package API, but replace that one
 * layout step with Yoga's normal constrained text measurement.
 */

import type { Node as YogaNode, Yoga } from "npm:yoga-wasm-web@0.3.3";
import stringWidth from "npm:string-width@7.2.0";

// JSR intentionally does not expose its internal modules as typed subpaths.
// Keep the compatibility boundary runtime-only rather than copying the package.
const { Ink } = await import(
  "https://jsr.io/@deno-ink/core/0.2.1/src/ink.ts"
) as unknown as {
  Ink: { prototype: InkInternals };
};
const { wrapText } = await import(
  "https://jsr.io/@deno-ink/core/0.2.1/src/output.ts"
) as unknown as {
  wrapText(text: string, width: number): string;
};
const { applyStyles } = await import(
  "https://jsr.io/@deno-ink/core/0.2.1/src/styles.ts"
) as unknown as {
  applyStyles(node: YogaNode, style: Record<string, unknown>, yoga: Yoga): void;
};

interface InkInternals {
  yoga: Yoga | null;
  rebuildYogaTree(node: InkNode, parentYogaNode: YogaNode | null): void;
}

interface InkNode {
  nodeName: string;
  nodeValue?: string;
  childNodes: InkNode[];
  yogaNode?: YogaNode;
  style: Record<string, unknown>;
}

const ink = Ink.prototype as unknown as InkInternals;

ink.rebuildYogaTree = function (node, parentYogaNode): void {
  if (!this.yoga) return;

  if (!node.yogaNode) node.yogaNode = this.yoga.Node.create();
  const yogaNode = node.yogaNode;
  applyStyles(yogaNode, node.style, this.yoga);

  if (node.nodeName === "ink-text") {
    const text = textContent(node);
    yogaNode.setMeasureFunc((availableWidth, widthMode) => {
      const naturalWidth = widestLine(text);
      const constrained = widthMode !== this.yoga!.MEASURE_MODE_UNDEFINED &&
        Number.isFinite(availableWidth) && availableWidth > 0;
      const width = constrained
        ? Math.min(naturalWidth, Math.floor(availableWidth))
        : naturalWidth;
      const renderedWidth = Math.max(1, width);
      return {
        width: widthMode === this.yoga!.MEASURE_MODE_EXACTLY
          ? Math.floor(availableWidth)
          : width,
        height: wrapText(text, renderedWidth).split("\n").length,
      };
    });
    // Nested Text is virtual styling content. A measured Yoga leaf cannot have
    // Yoga children; rendering still obtains the combined text from the DOM.
    while (yogaNode.getChildCount() > 0) {
      yogaNode.removeChild(yogaNode.getChild(0));
    }
    return;
  }

  while (yogaNode.getChildCount() > 0) {
    yogaNode.removeChild(yogaNode.getChild(0));
  }
  let childIndex = 0;
  for (const child of node.childNodes) {
    if (isTextNode(child)) continue;
    this.rebuildYogaTree(child, yogaNode);
    if (child.yogaNode) yogaNode.insertChild(child.yogaNode, childIndex++);
  }

  void parentYogaNode;
};

function textContent(node: InkNode): string {
  return isTextNode(node)
    ? node.nodeValue ?? ""
    : node.childNodes.map(textContent).join("");
}

function isTextNode(node: InkNode): boolean {
  return node.nodeName === "#text";
}

function widestLine(text: string): number {
  return text.split("\n").reduce(
    (width, line) => Math.max(width, stringWidth(line)),
    0,
  );
}

/** Counts the same visual rows that this compatibility renderer will produce. */
export function wrappedLineCount(text: string, width: number): number {
  return wrappedLines(text, width).length;
}

/** Returns the exact visual rows produced by the compatibility renderer. */
export function wrappedLines(text: string, width: number): readonly string[] {
  return wrapText(text, Math.max(1, Math.floor(width))).split("\n");
}

export * from "jsr:@deno-ink/core@0.2.1";
