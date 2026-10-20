// deno-lint-ignore-file no-explicit-any
import type { Node as YogaNode } from "npm:yoga-wasm-web@0.3.3";

export type NodeType =
  | "ink-root"
  | "ink-box"
  | "ink-text"
  | "ink-virtual-text"
  | "#text";

export type DOMNodeAttribute = string | number | boolean | undefined;

export interface DOMElement {
  nodeName: NodeType;
  attributes: Record<string, DOMNodeAttribute>;
  childNodes: DOMNode[];
  parentNode: DOMElement | null;
  yogaNode?: YogaNode;
  style: Record<string, any>;
  internal_static?: boolean;
  internal_transform?: (text: string, index: number) => string;
}

export interface TextNode {
  nodeName: "#text";
  nodeValue: string;
  parentNode: DOMElement | null;
  yogaNode?: undefined;
}

export type DOMNode = DOMElement | TextNode;

export function createNode(nodeName: NodeType): DOMElement {
  return {
    nodeName,
    attributes: {},
    childNodes: [],
    parentNode: null,
    style: {},
  };
}

export function createTextNode(text: string): TextNode {
  return {
    nodeName: "#text",
    nodeValue: text,
    parentNode: null,
  };
}

export function appendChildNode(node: DOMElement, childNode: DOMNode): void {
  if (childNode.parentNode) {
    removeChildNode(childNode.parentNode, childNode);
  }

  childNode.parentNode = node;
  node.childNodes.push(childNode);
}

export function insertBeforeNode(
  node: DOMElement,
  newChildNode: DOMNode,
  beforeChildNode: DOMNode
): void {
  if (newChildNode.parentNode) {
    removeChildNode(newChildNode.parentNode, newChildNode);
  }

  newChildNode.parentNode = node;
  const index = node.childNodes.indexOf(beforeChildNode);
  if (index >= 0) {
    node.childNodes.splice(index, 0, newChildNode);
  } else {
    node.childNodes.push(newChildNode);
  }
}

export function removeChildNode(node: DOMElement, childNode: DOMNode): void {
  childNode.parentNode = null;
  const index = node.childNodes.indexOf(childNode);
  if (index >= 0) {
    node.childNodes.splice(index, 1);
  }
}

export function setAttribute(
  node: DOMElement,
  key: string,
  value: DOMNodeAttribute
): void {
  node.attributes[key] = value;
}

export function setStyle(node: DOMElement, style: Record<string, any>): void {
  node.style = style;
}

export function isTextNode(node: DOMNode): node is TextNode {
  return node.nodeName === "#text";
}

export function isElement(node: DOMNode): node is DOMElement {
  return node.nodeName !== "#text";
}

// Squash all text nodes into a single string
// This combines multiple text nodes and applies any internal_transform functions
export function squashTextNodes(node: DOMElement): string {
  let text = "";

  for (let index = 0; index < node.childNodes.length; index++) {
    const childNode = node.childNodes[index];
    if (!childNode) continue;

    let nodeText = "";

    if (isTextNode(childNode)) {
      nodeText = childNode.nodeValue;
    } else if (
      childNode.nodeName === "ink-text" ||
      childNode.nodeName === "ink-virtual-text"
    ) {
      nodeText = squashTextNodes(childNode);

      // Apply internal_transform if present on the child node
      // This is used by the Transform component
      if (
        nodeText.length > 0 &&
        typeof childNode.internal_transform === "function"
      ) {
        nodeText = childNode.internal_transform(nodeText, index);
      }
    }

    text += nodeText;
  }

  return text;
}
