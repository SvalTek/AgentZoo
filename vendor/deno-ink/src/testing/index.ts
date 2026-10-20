// Testing utilities for deno-ink
// Similar to ink-testing-library
import React from "npm:react@18.3.1";
import type { ReactElement } from "npm:react@18.3.1";
import { createReconciler } from "../reconciler.ts";
import { createNode, type DOMElement, isTextNode } from "../dom.ts";
import { renderToString } from "../render-node.ts";
import { loadYoga, type Yoga, type Node as YogaNode } from "../yoga.ts";
import { applyStyles, type Styles } from "../styles.ts";
import stringWidth from "npm:string-width@7.2.0";
import { createFocusManager } from "../focus-manager.ts";
import { createInputManager } from "../hooks/use-input.ts";
import { InkProvider } from "../components/InkProvider.tsx";
import type { AppContextValue } from "../contexts/app-context.ts";
import type { StdoutContextValue, StderrContextValue, StdinContextValue } from "../contexts/std-context.ts";

export interface RenderResult {
  /**
   * The rendered output as a string.
   */
  lastFrame: () => string;

  /**
   * All rendered frames.
   */
  frames: string[];

  /**
   * Re-render with new element.
   */
  rerender: (element: ReactElement) => void;

  /**
   * Unmount the component.
   */
  unmount: () => void;

  /**
   * Simulate keyboard input.
   */
  stdin: {
    write: (data: string) => void;
  };

  /**
   * Captured stdout output.
   */
  stdout: {
    lastFrame: () => string;
  };

  /**
   * Captured stderr output.
   */
  stderr: {
    lastFrame: () => string;
  };
}

export interface RenderOptions {
  /**
   * Terminal width for rendering.
   * @default 80
   */
  columns?: number;

  /**
   * Terminal height for rendering.
   * @default 24
   */
  rows?: number;
}

/**
 * Render a component for testing.
 *
 * @example
 * ```typescript
 * import { render } from "deno-ink/testing";
 * import { Text } from "deno-ink";
 *
 * Deno.test("renders text", async () => {
 *   const { lastFrame } = await render(<Text>Hello</Text>);
 *   assertEquals(lastFrame(), "Hello");
 * });
 * ```
 */
export async function render(
  element: ReactElement,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const { columns = 80 } = options;

  const yoga = await loadYoga();
  const rootNode = createNode("ink-root");
  const frames: string[] = [];
  let stdoutOutput = "";
  let stderrOutput = "";

  const reconciler = createReconciler({
    onRender: () => {
      // Rebuild yoga tree and render
      rebuildYogaTree(rootNode, null, yoga);
      const { output } = renderToString(rootNode, columns);
      frames.push(output);
    },
  });

  // deno-lint-ignore no-explicit-any
  const container = reconciler.createContainer(
    rootNode,
    0, // LegacyRoot
    null,
    false,
    null,
    "",
    () => {},
    null
  );

  // Create managers
  const focusManager = createFocusManager();
  const inputManager = createInputManager();

  // Create context values
  const appContext: AppContextValue = {
    exit: () => {},
  };

  const stdoutContext: StdoutContextValue = {
    stdout: {
      writeSync: (data: Uint8Array) => {
        stdoutOutput += new TextDecoder().decode(data);
        return data.length;
      },
    // deno-lint-ignore no-explicit-any
    } as any,
    write: (data: string) => {
      stdoutOutput += data;
    },
  };

  const stderrContext: StderrContextValue = {
    stderr: {
      writeSync: (data: Uint8Array) => {
        stderrOutput += new TextDecoder().decode(data);
        return data.length;
      },
    // deno-lint-ignore no-explicit-any
    } as any,
    write: (data: string) => {
      stderrOutput += data;
    },
  };

  const stdinContext: StdinContextValue = {
    stdin: Deno.stdin,
    isRawModeSupported: false,
    setRawMode: () => {},
  };

  const inputContext = {
    subscribe: inputManager.subscribe,
    isRawModeSupported: false,
  };

  const renderElement = (el: ReactElement) => {
    const wrappedElement = React.createElement(
      InkProvider,
      {
        app: appContext,
        focusManager,
        stdout: stdoutContext,
        stderr: stderrContext,
        stdin: stdinContext,
        input: inputContext,
      },
      el
    );

    reconciler.updateContainer(wrappedElement, container, null, () => {});

    // Force a render
    rebuildYogaTree(rootNode, null, yoga);
    const { output } = renderToString(rootNode, columns);
    frames.push(output);
  };

  // Initial render
  renderElement(element);

  return {
    lastFrame: () => frames[frames.length - 1] ?? "",
    frames,
    rerender: (el: ReactElement) => {
      renderElement(el);
    },
    unmount: () => {
      reconciler.updateContainer(null, container, null, () => {});
    },
    stdin: {
      write: (data: string) => {
        inputManager.emit(data);
        // Force re-render after input
        rebuildYogaTree(rootNode, null, yoga);
        const { output } = renderToString(rootNode, columns);
        frames.push(output);
      },
    },
    stdout: {
      lastFrame: () => stdoutOutput,
    },
    stderr: {
      lastFrame: () => stderrOutput,
    },
  };
}

// Helper to rebuild yoga tree
function rebuildYogaTree(node: DOMElement, parentYogaNode: YogaNode | null, yoga: Yoga): void {
  if (!node.yogaNode) {
    node.yogaNode = yoga.Node.create();
  }

  const yogaNode = node.yogaNode;
  applyStyles(yogaNode, node.style as Styles, yoga);

  // Set up text measurement
  if (node.nodeName === "ink-text") {
    const text = getTextContent(node);
    const lines = text.split("\n");
    const maxWidth = Math.max(...lines.map((line) => stringWidth(line)));
    const height = lines.length;

    yogaNode.setWidth(maxWidth);
    yogaNode.setHeight(height);
  }

  // Rebuild children
  while (yogaNode.getChildCount() > 0) {
    yogaNode.removeChild(yogaNode.getChild(0));
  }

  let childIndex = 0;
  for (const child of node.childNodes) {
    if (!isTextNode(child)) {
      rebuildYogaTree(child, yogaNode, yoga);
      if (child.yogaNode) {
        yogaNode.insertChild(child.yogaNode, childIndex++);
      }
    }
  }
}

function getTextContent(node: DOMElement | { nodeValue: string }): string {
  if ("nodeValue" in node && typeof node.nodeValue === "string") {
    return node.nodeValue;
  }

  let text = "";
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      // deno-lint-ignore no-explicit-any
      text += getTextContent(child as any);
    }
  }
  return text;
}

/**
 * Wait for a certain number of frames to be rendered.
 *
 * @example
 * ```typescript
 * const { lastFrame, frames } = await render(<Counter />);
 * await waitForFrames(frames, 3);
 * ```
 */
export function waitForFrames(
  frames: string[],
  count: number,
  timeout = 1000
): Promise<void> {
  const startCount = frames.length;
  const targetCount = startCount + count;

  return new Promise((resolve, reject) => {
    const checkInterval = 10;
    let elapsed = 0;

    const check = () => {
      if (frames.length >= targetCount) {
        resolve();
        return;
      }

      elapsed += checkInterval;
      if (elapsed >= timeout) {
        reject(new Error(`Timeout waiting for ${count} frames (got ${frames.length - startCount})`));
        return;
      }

      setTimeout(check, checkInterval);
    };

    check();
  });
}

/**
 * Strip ANSI escape codes from a string.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
