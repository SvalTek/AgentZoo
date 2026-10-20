// Solution 2: Using @alcalzone/ansi-tokenize approach
// Custom implementation that tokenizes ANSI strings

const ESC = "\x1b";
const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

export interface StyledChar {
  char: string;
  styles: number[];
}

/**
 * Tokenize a string with ANSI codes into styled characters
 */
export function tokenize(input: string): StyledChar[] {
  const result: StyledChar[] = [];
  let currentStyles: number[] = [];
  let lastIndex = 0;

  // Reset regex
  ANSI_REGEX.lastIndex = 0;

  let match;
  while ((match = ANSI_REGEX.exec(input)) !== null) {
    // Add characters before this escape sequence
    const textBefore = input.slice(lastIndex, match.index);
    for (const char of textBefore) {
      result.push({ char, styles: [...currentStyles] });
    }

    // Parse the escape codes
    const codes = match[1].split(";").map((s) => parseInt(s) || 0);

    // Update current styles
    for (const code of codes) {
      if (code === 0) {
        currentStyles = [];
      } else {
        // Remove conflicting codes (e.g., different colors)
        if (code >= 30 && code <= 37) {
          currentStyles = currentStyles.filter((c) => c < 30 || c > 37);
        } else if (code >= 40 && code <= 47) {
          currentStyles = currentStyles.filter((c) => c < 40 || c > 47);
        } else if (code >= 90 && code <= 97) {
          currentStyles = currentStyles.filter((c) => c < 90 || c > 97);
        }
        if (!currentStyles.includes(code)) {
          currentStyles.push(code);
        }
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remaining = input.slice(lastIndex);
  for (const char of remaining) {
    result.push({ char, styles: [...currentStyles] });
  }

  return result;
}

/**
 * Convert styled characters back to an ANSI string
 */
export function styledCharsToString(chars: StyledChar[]): string {
  if (chars.length === 0) return "";

  let result = "";
  let currentStyles: number[] = [];

  for (const { char, styles } of chars) {
    // Check if styles changed
    const stylesChanged =
      styles.length !== currentStyles.length ||
      !styles.every((s, i) => currentStyles[i] === s);

    if (stylesChanged) {
      // Reset and apply new styles
      if (styles.length === 0) {
        result += `${ESC}[0m`;
      } else {
        result += `${ESC}[0m${ESC}[${styles.join(";")}m`;
      }
      currentStyles = [...styles];
    }

    result += char;
  }

  // Reset at end if we had styles
  if (currentStyles.length > 0) {
    result += `${ESC}[0m`;
  }

  return result;
}

/**
 * Get visible width of styled chars (excluding ANSI codes)
 */
export function getVisibleLength(chars: StyledChar[]): number {
  return chars.length;
}

/**
 * Slice styled chars at visual positions
 */
export function sliceStyledChars(
  chars: StyledChar[],
  start: number,
  end?: number
): StyledChar[] {
  return chars.slice(start, end);
}
