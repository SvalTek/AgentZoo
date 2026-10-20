/**
 * Element measurement utility.
 * Measures the dimensions of rendered Box elements.
 */

import type { DOMElement } from "./dom.ts";

export interface ElementDimensions {
  /** Computed width of the element */
  width: number;
  /** Computed height of the element */
  height: number;
}

/**
 * Measure the dimensions of a Box element.
 *
 * @param ref A ref object pointing to a DOMElement
 * @returns The computed width and height of the element
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const ref = useRef(null);
 *   const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
 *
 *   useEffect(() => {
 *     setDimensions(measureElement(ref));
 *   }, []);
 *
 *   return (
 *     <Box ref={ref} padding={2}>
 *       <Text>Width: {dimensions.width}, Height: {dimensions.height}</Text>
 *     </Box>
 *   );
 * }
 * ```
 */
export function measureElement(
  ref: { current: DOMElement | null }
): ElementDimensions {
  if (!ref.current) {
    return { width: 0, height: 0 };
  }

  const node = ref.current;
  const yogaNode = node.yogaNode;

  if (!yogaNode) {
    return { width: 0, height: 0 };
  }

  return {
    width: yogaNode.getComputedWidth(),
    height: yogaNode.getComputedHeight(),
  };
}
