// Text measurement with caching (matches Ink's approach)
import stringWidth from "npm:string-width@7.2.0";

interface MeasuredText {
  width: number;
  height: number;
}

// Simple Map cache - matches Ink's implementation
const cache = new Map<string, MeasuredText>();

/**
 * Measure text dimensions with caching.
 * Returns the width of the widest line and the total number of lines.
 */
export function measureText(text: string): MeasuredText {
  if (text.length === 0) {
    return { width: 0, height: 0 };
  }

  // Check cache first
  const cached = cache.get(text);
  if (cached) {
    return cached;
  }

  // Calculate dimensions
  const lines = text.split("\n");
  let maxWidth = 0;

  for (const line of lines) {
    const lineWidth = stringWidth(line);
    if (lineWidth > maxWidth) {
      maxWidth = lineWidth;
    }
  }

  const dimensions: MeasuredText = {
    width: maxWidth,
    height: lines.length,
  };

  // Store in cache
  cache.set(text, dimensions);

  return dimensions;
}

/**
 * Get the widest line in a multi-line string.
 */
export function widestLine(text: string): number {
  return measureText(text).width;
}

/**
 * Clear the measurement cache.
 */
export function clearMeasureCache(): void {
  cache.clear();
}

/**
 * Get cache stats for debugging.
 */
export function getMeasureCacheStats(): { size: number } {
  return { size: cache.size };
}
