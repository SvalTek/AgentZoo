// deno-lint-ignore-file no-explicit-any
import ReactReconciler from "npm:react-reconciler@0.29.2";
import {
  createNode,
  createTextNode,
  appendChildNode,
  insertBeforeNode,
  removeChildNode,
  setAttribute,
  setStyle,
  type DOMElement,
  type DOMNode,
  type NodeType,
} from "./dom.ts";

export interface HostConfig {
  onRender: () => void;
  isPrimaryRenderer?: boolean;
}

// Timer tracking for proper cleanup
const activeTimers = new Set<ReturnType<typeof setTimeout>>();

export function clearAllTimers(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

function trackedSetTimeout(callback: () => void, delay?: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    activeTimers.delete(timer);
    callback();
  }, delay);
  activeTimers.add(timer);
  return timer;
}

function trackedClearTimeout(timer: ReturnType<typeof setTimeout>): void {
  activeTimers.delete(timer);
  clearTimeout(timer);
}

type Container = DOMElement;
type Instance = DOMElement;
type TextInstance = ReturnType<typeof createTextNode>;
type Props = Record<string, any>;

interface HostContext {
  isInsideText: boolean;
}

const ROOT_CONTEXT: HostContext = { isInsideText: false };

export function createReconciler(hostConfig: HostConfig) {
  const reconciler = ReactReconciler<
    NodeType,
    Props,
    Container,
    Instance,
    TextInstance,
    any,
    any,
    any,
    HostContext,
    any,
    any,
    any,
    any
  >({
    // Host config
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: hostConfig.isPrimaryRenderer ?? true,

    // Create instances
    createInstance(type: NodeType, props: Props, _rootContainer: Container, hostContext: HostContext): Instance {
      // If we're inside a text component and this is another text component,
      // convert it to virtual-text (no yoga node, just styling)
      let actualType = type;
      if (hostContext.isInsideText && type === "ink-text") {
        actualType = "ink-virtual-text";
      }

      const node = createNode(actualType);

      // Apply props
      for (const [key, value] of Object.entries(props)) {
        if (key === "children") continue;
        if (key === "style") {
          setStyle(node, value);
        } else if (key === "internal_static") {
          node.internal_static = true;
        } else if (key === "internal_transform") {
          node.internal_transform = value;
        } else {
          setAttribute(node, key, value);
        }
      }

      return node;
    },

    createTextInstance(text: string): TextInstance {
      return createTextNode(text);
    },

    // Tree operations
    appendInitialChild(parentInstance: Instance, child: DOMNode): void {
      appendChildNode(parentInstance, child);
    },

    appendChild(parentInstance: Instance, child: DOMNode): void {
      appendChildNode(parentInstance, child);
    },

    appendChildToContainer(container: Container, child: DOMNode): void {
      appendChildNode(container, child);
    },

    insertBefore(
      parentInstance: Instance,
      child: DOMNode,
      beforeChild: DOMNode
    ): void {
      insertBeforeNode(parentInstance, child, beforeChild);
    },

    insertInContainerBefore(
      container: Container,
      child: DOMNode,
      beforeChild: DOMNode
    ): void {
      insertBeforeNode(container, child, beforeChild);
    },

    removeChild(parentInstance: Instance, child: DOMNode): void {
      removeChildNode(parentInstance, child);
    },

    removeChildFromContainer(container: Container, child: DOMNode): void {
      removeChildNode(container, child);
    },

    // Updates
    prepareUpdate(
      _instance: Instance,
      _type: NodeType,
      oldProps: Props,
      newProps: Props
    ): Props | null {
      const updatePayload: Props = {};
      let hasUpdate = false;

      for (const key of Object.keys(newProps)) {
        if (key === "children") continue;
        if (oldProps[key] !== newProps[key]) {
          updatePayload[key] = newProps[key];
          hasUpdate = true;
        }
      }

      for (const key of Object.keys(oldProps)) {
        if (key === "children") continue;
        if (!(key in newProps)) {
          updatePayload[key] = undefined;
          hasUpdate = true;
        }
      }

      return hasUpdate ? updatePayload : null;
    },

    commitUpdate(
      instance: Instance,
      updatePayload: Props,
      _type: NodeType,
      _oldProps: Props,
      _newProps: Props
    ): void {
      for (const [key, value] of Object.entries(updatePayload)) {
        if (key === "style") {
          setStyle(instance, value);
        } else {
          setAttribute(instance, key, value);
        }
      }

      hostConfig.onRender();
    },

    commitTextUpdate(
      textInstance: TextInstance,
      _oldText: string,
      newText: string
    ): void {
      textInstance.nodeValue = newText;
      hostConfig.onRender();
    },

    // Finalization
    finalizeInitialChildren(): boolean {
      return false;
    },

    prepareForCommit(): null {
      return null;
    },

    resetAfterCommit(): void {
      hostConfig.onRender();
    },

    // Context
    getRootHostContext(): HostContext {
      return ROOT_CONTEXT;
    },

    getChildHostContext(parentHostContext: HostContext, type: NodeType): HostContext {
      // When entering an ink-text, mark context as inside text
      // This causes nested ink-text to become ink-virtual-text
      if (type === "ink-text" || type === "ink-virtual-text") {
        return { isInsideText: true };
      }
      // ink-box inside text is an error in original Ink, but we'll just pass through
      return parentHostContext;
    },

    // Text content
    shouldSetTextContent(): boolean {
      return false;
    },

    // Portal support (not needed)
    getPublicInstance(instance: Instance | TextInstance): Instance | TextInstance {
      return instance;
    },

    preparePortalMount(): void {},

    // Scheduling - use tracked versions for cleanup
    scheduleTimeout: trackedSetTimeout,
    cancelTimeout: trackedClearTimeout,
    noTimeout: -1,

    // Misc
    getCurrentEventPriority: () => 16, // DefaultEventPriority
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: () => {},
    afterActiveInstanceBlur: () => {},
    prepareScopeUpdate: () => {},
    getInstanceFromScope: () => null,
    detachDeletedInstance: () => {},

    // Required methods
    clearContainer(container: Container): void {
      container.childNodes = [];
    },

    // Microtasks
    supportsMicrotasks: true,
    scheduleMicrotask:
      typeof queueMicrotask === "function"
        ? queueMicrotask
        : (fn: () => void) => Promise.resolve().then(fn),

    // Not used but required
    hideInstance: () => {},
    hideTextInstance: () => {},
    unhideInstance: () => {},
    unhideTextInstance: () => {},

    // Required new methods
    setCurrentUpdatePriority: () => {},
    getCurrentUpdatePriority: () => 16,
    resolveUpdatePriority: () => 16,
    resetFormInstance: () => {},
    requestPostPaintCallback: () => {},
    maySuspendCommit: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => {},
    suspendInstance: () => {},
    waitForCommitToBeReady: () => null,
    NotPendingTransition: null,
  });

  return reconciler;
}
