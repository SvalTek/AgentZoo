// Custom color utilities that work properly in Deno terminals

// Use String.fromCharCode to ensure the escape character is correct
const ESC = String.fromCharCode(27) + "[";
const RESET = `${ESC}0m`;

// Foreground colors
const FG_COLORS: Record<string, string> = {
  black: "30",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  white: "37",
  gray: "90",
  grey: "90",
  brightRed: "91",
  brightGreen: "92",
  brightYellow: "93",
  brightBlue: "94",
  brightMagenta: "95",
  brightCyan: "96",
  brightWhite: "97",
};

// Background colors
const BG_COLORS: Record<string, string> = {
  black: "40",
  red: "41",
  green: "42",
  yellow: "43",
  blue: "44",
  magenta: "45",
  cyan: "46",
  white: "47",
  gray: "100",
  grey: "100",
  brightRed: "101",
  brightGreen: "102",
  brightYellow: "103",
  brightBlue: "104",
  brightMagenta: "105",
  brightCyan: "106",
  brightWhite: "107",
};

// Text styles
const STYLES: Record<string, [string, string]> = {
  bold: ["1", "22"],
  dim: ["2", "22"],
  italic: ["3", "23"],
  underline: ["4", "24"],
  inverse: ["7", "27"],
  strikethrough: ["9", "29"],
};

function hexToRgb(hex: string): [number, number, number] | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : null;
}

export function colorize(
  text: string,
  color: string | undefined,
  type: "foreground" | "background"
): string {
  if (!color || !text) return text;

  // Handle hex colors
  if (color.startsWith("#")) {
    const rgb = hexToRgb(color);
    if (rgb) {
      const [r, g, b] = rgb;
      const code = type === "background" ? `48;2;${r};${g};${b}` : `38;2;${r};${g};${b}`;
      return `${ESC}${code}m${text}${RESET}`;
    }
    return text;
  }

  // Handle rgb() colors
  if (color.startsWith("rgb(")) {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match;
      const code = type === "background" ? `48;2;${r};${g};${b}` : `38;2;${r};${g};${b}`;
      return `${ESC}${code}m${text}${RESET}`;
    }
    return text;
  }

  // Handle named colors
  const colorMap = type === "background" ? BG_COLORS : FG_COLORS;
  const code = colorMap[color];
  if (code) {
    return `${ESC}${code}m${text}${RESET}`;
  }

  return text;
}

export function applyStyle(text: string, style: string): string {
  const codes = STYLES[style];
  if (codes) {
    return `${ESC}${codes[0]}m${text}${ESC}${codes[1]}m`;
  }
  return text;
}

export function bold(text: string): string {
  return applyStyle(text, "bold");
}

export function dim(text: string): string {
  return applyStyle(text, "dim");
}

export function italic(text: string): string {
  return applyStyle(text, "italic");
}

export function underline(text: string): string {
  return applyStyle(text, "underline");
}

export function inverse(text: string): string {
  return applyStyle(text, "inverse");
}

export function strikethrough(text: string): string {
  return applyStyle(text, "strikethrough");
}

// Convenience functions for common colors
export function red(text: string): string {
  return colorize(text, "red", "foreground");
}

export function green(text: string): string {
  return colorize(text, "green", "foreground");
}

export function yellow(text: string): string {
  return colorize(text, "yellow", "foreground");
}

export function blue(text: string): string {
  return colorize(text, "blue", "foreground");
}

export function magenta(text: string): string {
  return colorize(text, "magenta", "foreground");
}

export function cyan(text: string): string {
  return colorize(text, "cyan", "foreground");
}

export function white(text: string): string {
  return colorize(text, "white", "foreground");
}

export function gray(text: string): string {
  return colorize(text, "gray", "foreground");
}

export function bgRed(text: string): string {
  return colorize(text, "red", "background");
}

export function bgGreen(text: string): string {
  return colorize(text, "green", "background");
}

export function bgYellow(text: string): string {
  return colorize(text, "yellow", "background");
}

export function bgBlue(text: string): string {
  return colorize(text, "blue", "background");
}

export function bgMagenta(text: string): string {
  return colorize(text, "magenta", "background");
}

export function bgCyan(text: string): string {
  return colorize(text, "cyan", "background");
}
