<p align="center">
  <h1 align="center">deno-ink</h1>
  <p align="center">
    <b>React for CLIs.</b> Build and test your CLI output using components.
  </p>
</p>

<p align="center">
  <a href="https://jsr.io/@deno-ink/core"><img src="https://jsr.io/badges/@deno-ink/core" alt="JSR" /></a>
  <a href="https://github.com/whatiskadudoing/deno-ink/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://deno.land"><img src="https://img.shields.io/badge/deno-2.x-black.svg?logo=deno" alt="Deno" /></a>
</p>

---

Deno-native port of [Ink](https://github.com/vadimdemedes/ink) — the popular React renderer for building beautiful, interactive command-line interfaces. Use React components and Flexbox layouts to create rich terminal UIs.

## Why deno-ink?

- **React for the terminal** — Use the same component-based architecture you love from React
- **Flexbox layouts** — Build complex layouts using familiar CSS-like Flexbox properties (powered by Yoga)
- **Rich components** — Box, Text, Spinner, TextInput, SelectInput, ProgressBar, and more
- **Full hook support** — useInput, useFocus, useApp, and all React hooks work out of the box
- **TypeScript-first** — Built with TypeScript, fully typed API
- **Deno-native** — No Node.js required, works with Deno 2.x

## Installation

```typescript
import { render, Box, Text } from "jsr:@deno-ink/core";
```

Or add to your `deno.json`:

```json
{
  "imports": {
    "@deno-ink/core": "jsr:@deno-ink/core"
  }
}
```

## Quick Start

```tsx
import React from "npm:react";
import { render, Box, Text } from "jsr:@deno-ink/core";

function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>
        Hello from deno-ink!
      </Text>
      <Text>Build beautiful CLI apps with React</Text>
    </Box>
  );
}

const { waitUntilExit } = await render(<App />);
await waitUntilExit();
```

Run with:

```bash
deno run --allow-all app.tsx
```

## Features

### Components

| Component | Description |
|-----------|-------------|
| `<Box>` | Flexbox container for layouts |
| `<Text>` | Styled text with colors, bold, italic, underline |
| `<Spinner>` | Animated loading spinners (25+ styles) |
| `<TextInput>` | Single-line text input |
| `<SelectInput>` | Arrow-key navigable selection menu |
| `<ProgressBar>` | Visual progress indicator |
| `<Badge>` | Colored status badges |
| `<StatusMessage>` | Success/error/warning/info messages |
| `<ConfirmInput>` | Y/n confirmation prompts |
| `<Static>` | Render static content above dynamic output |
| `<Transform>` | Transform text output |
| `<Newline>` | Insert line breaks |
| `<Spacer>` | Flexible space filler |

### Hooks

| Hook | Description |
|------|-------------|
| `useInput` | Handle keyboard input |
| `useApp` | Access app instance (exit, etc.) |
| `useFocus` | Make components focusable |
| `useFocusManager` | Control focus programmatically |
| `useStdout` | Direct stdout access |
| `useStderr` | Direct stderr access |
| `useStdin` | Raw stdin access |

### Flexbox Layout

Full Flexbox support with Yoga WASM:

```tsx
<Box
  flexDirection="column"
  justifyContent="center"
  alignItems="center"
  width="100%"
  height={10}
  padding={1}
  borderStyle="round"
  borderColor="cyan"
>
  <Text>Centered content</Text>
</Box>
```

## Examples

### Interactive Counter

```tsx
import React, { useState } from "npm:react";
import { render, Box, Text, useInput, useApp } from "jsr:@deno-ink/core";

function Counter() {
  const [count, setCount] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.upArrow) setCount((c) => c + 1);
    if (key.downArrow) setCount((c) => c - 1);
  });

  return (
    <Box flexDirection="column">
      <Text>Count: <Text color="green" bold>{count}</Text></Text>
      <Text dimColor>↑/↓ to change, q to quit</Text>
    </Box>
  );
}

await render(<Counter />);
```

### Loading Spinner

```tsx
import React from "npm:react";
import { render, Box, Text, Spinner } from "jsr:@deno-ink/core";

function Loading() {
  return (
    <Box>
      <Spinner type="dots" color="cyan" />
      <Text> Loading...</Text>
    </Box>
  );
}

await render(<Loading />);
```

### Selection Menu

```tsx
import React from "npm:react";
import { render, SelectInput } from "jsr:@deno-ink/core";

function Menu() {
  const items = [
    { label: "JavaScript", value: "js" },
    { label: "TypeScript", value: "ts" },
    { label: "Python", value: "py" },
  ];

  return (
    <SelectInput
      items={items}
      onSelect={(item) => console.log("Selected:", item.value)}
    />
  );
}

await render(<Menu />);
```

## Documentation

- [Components](#components-1)
- [Hooks](#hooks-1)
- [Style Properties](#style-properties)
- [Utilities](#utilities)
- [TypeScript Types](#typescript-types)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Components](#components)
  - [Box](#box)
  - [Text](#text)
  - [Newline](#newline)
  - [Spacer](#spacer)
  - [Spinner](#spinner)
  - [Static](#static)
  - [Transform](#transform)
  - [ErrorBoundary](#errorboundary)
  - [TextInput](#textinput)
  - [SelectInput](#selectinput)
  - [ProgressBar](#progressbar)
  - [Badge](#badge)
  - [StatusMessage](#statusmessage)
  - [ConfirmInput](#confirminput)
- [Hooks](#hooks-1)
  - [useInput](#useinput)
  - [useApp](#useapp)
  - [useFocus](#usefocus)
  - [useFocusManager](#usefocusmanager)
  - [useStdout](#usestdout)
  - [useStderr](#usestderr)
  - [useStdin](#usestdin)
  - [useIsScreenReaderEnabled](#useisscreenreaderenabled)
- [Style Properties](#style-properties)
- [Utilities](#utilities)
- [TypeScript Types](#typescript-types)

---

## Components

### Box

A flex container component for layout. Supports all flexbox properties.

```tsx
import { Box, Text } from "jsr:@deno-ink/core";

// Horizontal layout (default)
<Box>
  <Text>Left</Text>
  <Text>Right</Text>
</Box>

// Vertical layout
<Box flexDirection="column">
  <Text>Top</Text>
  <Text>Bottom</Text>
</Box>

// With borders
<Box borderStyle="round" borderColor="cyan" padding={1}>
  <Text>Boxed content</Text>
</Box>

// Centered content
<Box justifyContent="center" alignItems="center" width={40} height={10}>
  <Text>Centered</Text>
</Box>
```

**Props:** All [Style Properties](#style-properties) plus:

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Child elements |

### Text

Renders text with styling options.

```tsx
import { Text } from "jsr:@deno-ink/core";

<Text>Plain text</Text>
<Text color="green">Green text</Text>
<Text backgroundColor="red">Red background</Text>
<Text bold>Bold text</Text>
<Text italic>Italic text</Text>
<Text underline>Underlined text</Text>
<Text strikethrough>Strikethrough</Text>
<Text inverse>Inverted colors</Text>
<Text dimColor>Dimmed text</Text>

// Combine styles
<Text color="cyan" bold underline>
  Styled text
</Text>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Text content |
| `color` | `string` | Text color (named or hex) |
| `backgroundColor` | `string` | Background color |
| `dimColor` | `boolean` | Dim the color |
| `bold` | `boolean` | Bold text |
| `italic` | `boolean` | Italic text |
| `underline` | `boolean` | Underlined text |
| `strikethrough` | `boolean` | Strikethrough text |
| `inverse` | `boolean` | Swap foreground/background |
| `wrap` | `"wrap" \| "truncate" \| "truncate-middle" \| "truncate-start"` | Text wrapping mode |

### Newline

Inserts one or more newlines.

```tsx
import { Text, Newline } from "jsr:@deno-ink/core";

<Text>
  Line 1
  <Newline />
  Line 2
  <Newline count={2} />
  Line 4
</Text>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `count` | `number` | `1` | Number of newlines |

### Spacer

A flexible spacer that expands to fill available space.

```tsx
import { Box, Text, Spacer } from "jsr:@deno-ink/core";

<Box width={40}>
  <Text>Left</Text>
  <Spacer />
  <Text>Right</Text>
</Box>
```

### Spinner

An animated loading spinner with multiple styles.

```tsx
import { Box, Text, Spinner } from "jsr:@deno-ink/core";

<Box>
  <Spinner type="dots" color="cyan" />
  <Text> Loading...</Text>
</Box>

// Different spinner types
<Spinner type="line" />
<Spinner type="arc" />
<Spinner type="bouncingBar" />
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `SpinnerName` | `"dots"` | Spinner animation type |
| `color` | `string` | - | Spinner color |

**Available Spinner Types:**

`dots`, `dots2`, `dots3`, `line`, `line2`, `pipe`, `simpleDots`, `simpleDotsScrolling`, `star`, `star2`, `flip`, `hamburger`, `growVertical`, `growHorizontal`, `balloon`, `balloon2`, `noise`, `bounce`, `boxBounce`, `boxBounce2`, `triangle`, `arc`, `circle`, `squareCorners`, `circleQuarters`, `circleHalves`, `squish`, `toggle`, `toggle2`-`toggle13`, `arrow`, `arrow2`, `arrow3`, `bouncingBar`, `bouncingBall`, `pong`, `clock`, `earth`, `moon`, `runner`, `weather`

### Static

Renders items once and keeps them above dynamic content. Useful for logs or completed tasks.

```tsx
import { useState } from "npm:react";
import { Box, Text, Static } from "jsr:@deno-ink/core";

function App() {
  const [logs, setLogs] = useState<string[]>([]);

  return (
    <Box flexDirection="column">
      <Static items={logs}>
        {(log, index) => (
          <Text key={index} dimColor>
            {log}
          </Text>
        )}
      </Static>

      <Text>Dynamic content here</Text>
    </Box>
  );
}
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `items` | `T[]` | Array of items to render |
| `children` | `(item: T, index: number) => ReactNode` | Render function |
| `style` | `Styles` | Container styles |

### Transform

Applies a transformation function to text output.

```tsx
import { Text, Transform } from "jsr:@deno-ink/core";

// Add line numbers
<Transform transform={(text, index) => `${index + 1}: ${text}`}>
  <Text>First line</Text>
</Transform>

// Wrap in brackets
<Transform transform={(text) => `[${text}]`}>
  <Text>Bracketed</Text>
</Transform>

// Nested transforms work correctly
<Transform transform={(text) => `(${text})`}>
  <Transform transform={(text) => `{${text}}`}>
    <Text>nested</Text>
  </Transform>
</Transform>
// Output: ({nested})
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Content to transform |
| `transform` | `(text: string, index: number) => string` | Transform function |

### ErrorBoundary

Catches errors in child components and displays a fallback.

```tsx
import { Text, ErrorBoundary } from "jsr:@deno-ink/core";

<ErrorBoundary
  fallback={(error) => (
    <Text color="red">Error: {error.message}</Text>
  )}
  onError={(error, errorInfo) => {
    console.error("Caught error:", error);
  }}
>
  <MyComponent />
</ErrorBoundary>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Child components |
| `fallback` | `ReactNode \| ((error: Error, errorInfo: ErrorInfo) => ReactNode)` | Fallback content |
| `onError` | `(error: Error, errorInfo: ErrorInfo) => void` | Error callback |

### TextInput

A single-line text input component.

```tsx
import { useState } from "npm:react";
import { Box, Text, TextInput } from "jsr:@deno-ink/core";

function App() {
  const [value, setValue] = useState("");

  return (
    <Box>
      <Text>Enter name: </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(val) => console.log("Submitted:", val)}
        placeholder="Type here..."
      />
    </Box>
  );
}
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Current input value |
| `onChange` | `(value: string) => void` | - | Change handler |
| `onSubmit` | `(value: string) => void` | - | Submit handler (Enter) |
| `placeholder` | `string` | `""` | Placeholder text |
| `focus` | `boolean` | `true` | Whether input is focused |
| `mask` | `string` | - | Mask character (for passwords) |
| `showCursor` | `boolean` | `true` | Show cursor |
| `cursorChar` | `string` | `"\u2588"` | Cursor character |
| `color` | `string` | - | Text color |

### SelectInput

Select from a list of options using arrow keys.

```tsx
import { SelectInput } from "jsr:@deno-ink/core";

function App() {
  const items = [
    { label: "JavaScript", value: "js" },
    { label: "TypeScript", value: "ts" },
    { label: "Python", value: "py" },
  ];

  return (
    <SelectInput
      items={items}
      onSelect={(item) => console.log("Selected:", item.value)}
      onHighlight={(item) => console.log("Highlighted:", item.value)}
    />
  );
}
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `SelectInputItem<V>[]` | - | Items to display |
| `onSelect` | `(item: SelectInputItem<V>) => void` | - | Selection callback (Enter) |
| `onHighlight` | `(item: SelectInputItem<V>) => void` | - | Highlight callback |
| `isFocused` | `boolean` | `true` | Whether component is focused |
| `initialIndex` | `number` | `0` | Initially selected index |
| `limit` | `number` | `5` | Visible items (for scrolling) |
| `indicatorComponent` | `React.ComponentType<{ isSelected: boolean }>` | - | Custom indicator |
| `itemComponent` | `React.ComponentType<{ isSelected: boolean; label: string }>` | - | Custom item renderer |

**SelectInputItem:**

```typescript
interface SelectInputItem<V> {
  label: string;  // Display text
  value: V;       // Item value
  key?: string;   // Unique key (optional)
}
```

### ProgressBar

A visual progress indicator.

```tsx
import { ProgressBar } from "jsr:@deno-ink/core";

// Basic usage
<ProgressBar value={50} />

// Custom width and color
<ProgressBar value={75} width={30} color="cyan" />

// Custom characters
<ProgressBar value={50} character="=" backgroundCharacter="-" />

// Custom max value (e.g., for file downloads)
<ProgressBar value={5} maxValue={10} />
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | - | Current progress value |
| `maxValue` | `number` | `100` | Maximum value |
| `width` | `number` | `20` | Width in characters |
| `color` | `string` | `"green"` | Filled portion color |
| `backgroundColor` | `string` | - | Empty portion color |
| `character` | `string` | `"█"` | Filled character |
| `backgroundCharacter` | `string` | `"░"` | Empty character |

### Badge

A colored status badge component.

```tsx
import { Badge } from "jsr:@deno-ink/core";

<Badge>INFO</Badge>
<Badge color="green">SUCCESS</Badge>
<Badge color="red">ERROR</Badge>
<Badge color="yellow">WARNING</Badge>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Badge text content |
| `color` | `string` | `"blue"` | Background color |

### StatusMessage

Display status messages with variant-specific icons and colors.

```tsx
import { StatusMessage } from "jsr:@deno-ink/core";

<StatusMessage variant="success">Operation completed</StatusMessage>
<StatusMessage variant="error">Something went wrong</StatusMessage>
<StatusMessage variant="warning">Proceed with caution</StatusMessage>
<StatusMessage variant="info">For your information</StatusMessage>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Message content |
| `variant` | `"success" \| "error" \| "warning" \| "info"` | Message type |

**Variants:**

| Variant | Symbol | Color |
|---------|--------|-------|
| `success` | ✔ | green |
| `error` | ✖ | red |
| `warning` | ⚠ | yellow |
| `info` | ℹ | blue |

### ConfirmInput

A Y/n confirmation prompt component.

```tsx
import { useState } from "npm:react";
import { Box, Text, ConfirmInput } from "jsr:@deno-ink/core";

function App() {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  if (confirmed !== null) {
    return <Text>{confirmed ? "Confirmed!" : "Cancelled"}</Text>;
  }

  return (
    <Box>
      <Text>Continue? </Text>
      <ConfirmInput
        onConfirm={() => setConfirmed(true)}
        onCancel={() => setConfirmed(false)}
      />
    </Box>
  );
}
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onConfirm` | `() => void` | - | Called when user confirms (Y/y/Enter if default true) |
| `onCancel` | `() => void` | - | Called when user cancels (N/n/Enter if default false) |
| `defaultValue` | `boolean` | `true` | Default selection (affects Enter behavior and display) |
| `isDisabled` | `boolean` | `false` | Disable input handling |

---

## Hooks

### useInput

Handle keyboard input.

```tsx
import { useInput } from "jsr:@deno-ink/core";

function App() {
  useInput((input, key) => {
    if (input === "q") {
      // User pressed 'q'
    }

    if (key.upArrow) {
      // Up arrow pressed
    }

    if (key.return) {
      // Enter pressed
    }

    if (key.ctrl && input === "c") {
      // Ctrl+C
    }
  }, { isActive: true });

  return <Text>Press keys...</Text>;
}
```

**Key Object:**

```typescript
interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isActive` | `boolean` | `true` | Enable/disable input handling |

### useApp

Access the Ink app instance to programmatically exit.

```tsx
import { useEffect } from "npm:react";
import { useApp, Text } from "jsr:@deno-ink/core";

function App() {
  const { exit } = useApp();

  useEffect(() => {
    // Exit after 5 seconds
    const timer = setTimeout(() => exit(), 5000);
    return () => clearTimeout(timer);
  }, []);

  return <Text>Exiting in 5 seconds...</Text>;
}

// Exit with error
exit(new Error("Something went wrong"));
```

**Returns:**

```typescript
interface AppContextValue {
  exit: (error?: Error) => void;
}
```

### useFocus

Make a component focusable and track focus state.

```tsx
import { useFocus, Box, Text } from "jsr:@deno-ink/core";

function Button({ label }: { label: string }) {
  const { isFocused, focus } = useFocus({ autoFocus: true });

  return (
    <Box borderStyle={isFocused ? "bold" : "single"}>
      <Text color={isFocused ? "cyan" : undefined}>
        {label}
      </Text>
    </Box>
  );
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isActive` | `boolean` | `true` | Enable focus for this component |
| `autoFocus` | `boolean` | `false` | Auto-focus on mount |
| `id` | `string` | auto-generated | Unique focus ID |

**Returns:**

```typescript
interface UseFocusResult {
  isFocused: boolean;  // Whether component is focused
  focus: () => void;   // Programmatically focus
}
```

### useFocusManager

Control focus programmatically across components.

```tsx
import { useFocusManager, useInput, Box } from "jsr:@deno-ink/core";

function App() {
  const { focusNext, focusPrevious, focus, enableFocus, disableFocus } = useFocusManager();

  useInput((input, key) => {
    if (key.tab) {
      if (key.shift) {
        focusPrevious();
      } else {
        focusNext();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Button label="Button 1" />
      <Button label="Button 2" />
      <Button label="Button 3" />
    </Box>
  );
}
```

**Returns:**

```typescript
interface UseFocusManagerResult {
  enableFocus: () => void;      // Enable focus management
  disableFocus: () => void;     // Disable focus management
  focusNext: () => void;        // Focus next component
  focusPrevious: () => void;    // Focus previous component
  focus: (id: string) => void;  // Focus specific component by ID
}
```

### useStdout

Access stdout for direct writing.

```tsx
import { useEffect } from "npm:react";
import { useStdout, Text } from "jsr:@deno-ink/core";

function App() {
  const { write, stdout } = useStdout();

  useEffect(() => {
    write("Direct stdout message\n");
  }, []);

  return <Text>Check stdout</Text>;
}
```

**Returns:**

```typescript
interface StdoutContextValue {
  stdout: typeof Deno.stdout;
  write: (data: string) => void;
}
```

### useStderr

Access stderr for direct error writing.

```tsx
import { useEffect } from "npm:react";
import { useStderr, Text } from "jsr:@deno-ink/core";

function App() {
  const { write, stderr } = useStderr();

  useEffect(() => {
    write("Error message\n");
  }, []);

  return <Text>Check stderr</Text>;
}
```

**Returns:**

```typescript
interface StderrContextValue {
  stderr: typeof Deno.stderr;
  write: (data: string) => void;
}
```

### useStdin

Access stdin and raw mode control.

```tsx
import { useEffect } from "npm:react";
import { useStdin, Text } from "jsr:@deno-ink/core";

function App() {
  const { setRawMode, isRawModeSupported, stdin } = useStdin();

  useEffect(() => {
    if (isRawModeSupported) {
      setRawMode(true);
      return () => setRawMode(false);
    }
  }, []);

  return <Text>Raw mode: {isRawModeSupported ? "supported" : "not supported"}</Text>;
}
```

**Returns:**

```typescript
interface StdinContextValue {
  stdin: typeof Deno.stdin;
  isRawModeSupported: boolean;
  setRawMode: (value: boolean) => void;
}
```

### useIsScreenReaderEnabled

Check if screen reader mode is enabled.

```tsx
import { useIsScreenReaderEnabled, Text } from "jsr:@deno-ink/core";

function App() {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  return (
    <Text>
      Screen reader: {isScreenReaderEnabled ? "enabled" : "disabled"}
    </Text>
  );
}
```

Screen reader mode can be enabled via:
- The `isScreenReaderEnabled` option in `render()`
- The `INK_SCREEN_READER=1` environment variable

**Returns:** `boolean` - Whether screen reader mode is active

---

## Style Properties

The `Box` component accepts all these style properties:

### Positioning

| Property | Type | Description |
|----------|------|-------------|
| `position` | `"absolute" \| "relative"` | Position type |

### Dimensions

| Property | Type | Description |
|----------|------|-------------|
| `width` | `number \| string` | Width (number or percentage) |
| `height` | `number \| string` | Height (number or percentage) |
| `minWidth` | `number \| string` | Minimum width |
| `minHeight` | `number \| string` | Minimum height |
| `maxWidth` | `number \| string` | Maximum width |
| `maxHeight` | `number \| string` | Maximum height |

### Flexbox

| Property | Type | Description |
|----------|------|-------------|
| `flexGrow` | `number` | Flex grow factor |
| `flexShrink` | `number` | Flex shrink factor |
| `flexBasis` | `number \| string` | Flex basis |
| `flexDirection` | `"row" \| "column" \| "row-reverse" \| "column-reverse"` | Flex direction (default: `"row"`) |
| `flexWrap` | `"nowrap" \| "wrap" \| "wrap-reverse"` | Flex wrap |
| `alignItems` | `"flex-start" \| "flex-end" \| "center" \| "stretch"` | Align items |
| `alignSelf` | `"auto" \| "flex-start" \| "flex-end" \| "center" \| "stretch"` | Align self |
| `justifyContent` | `"flex-start" \| "flex-end" \| "center" \| "space-between" \| "space-around" \| "space-evenly"` | Justify content |

### Spacing

| Property | Type | Description |
|----------|------|-------------|
| `margin` | `number` | Margin on all sides |
| `marginTop` | `number` | Top margin |
| `marginBottom` | `number` | Bottom margin |
| `marginLeft` | `number` | Left margin |
| `marginRight` | `number` | Right margin |
| `marginX` | `number` | Horizontal margin |
| `marginY` | `number` | Vertical margin |
| `padding` | `number` | Padding on all sides |
| `paddingTop` | `number` | Top padding |
| `paddingBottom` | `number` | Bottom padding |
| `paddingLeft` | `number` | Left padding |
| `paddingRight` | `number` | Right padding |
| `paddingX` | `number` | Horizontal padding |
| `paddingY` | `number` | Vertical padding |
| `gap` | `number` | Gap between children |
| `rowGap` | `number` | Row gap |
| `columnGap` | `number` | Column gap |

### Display

| Property | Type | Description |
|----------|------|-------------|
| `display` | `"flex" \| "none"` | Display type |

### Border

| Property | Type | Description |
|----------|------|-------------|
| `borderStyle` | `"single" \| "double" \| "round" \| "bold" \| "singleDouble" \| "doubleSingle" \| "classic" \| CustomBorder` | Border style |
| `borderTop` | `boolean` | Show top border |
| `borderBottom` | `boolean` | Show bottom border |
| `borderLeft` | `boolean` | Show left border |
| `borderRight` | `boolean` | Show right border |
| `borderColor` | `string` | Border color |
| `borderTopColor` | `string` | Top border color |
| `borderBottomColor` | `string` | Bottom border color |
| `borderLeftColor` | `string` | Left border color |
| `borderRightColor` | `string` | Right border color |
| `borderDimColor` | `boolean` | Dim border color |

**Custom Border:**

```typescript
interface CustomBorder {
  topLeft: string;
  top: string;
  topRight: string;
  left: string;
  bottomLeft: string;
  bottom: string;
  bottomRight: string;
  right: string;
}
```

---

## Utilities

### measureText

Measure text dimensions with caching.

```typescript
import { measureText, widestLine, clearMeasureCache } from "jsr:@deno-ink/core";

const { width, height } = measureText("Hello\nWorld");
// width: 5, height: 2

const maxWidth = widestLine("Short\nLonger line");
// maxWidth: 11

// Clear cache if needed
clearMeasureCache();
```

### measureElement

Measure the dimensions of a rendered element.

```tsx
import { useRef, useEffect } from "npm:react";
import { Box, Text, measureElement } from "jsr:@deno-ink/core";

function App() {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      const { width, height } = measureElement(ref);
      console.log(`Element size: ${width}x${height}`);
    }
  }, []);

  return (
    <Box ref={ref} padding={1}>
      <Text>Measured content</Text>
    </Box>
  );
}
```

**Returns:**

```typescript
interface ElementDimensions {
  width: number;
  height: number;
}
```

### CI Detection

Utilities for detecting CI environments and capabilities.

```typescript
import { isCI, shouldUseColors, isInteractive } from "jsr:@deno-ink/core";

// Check if running in CI environment
if (isCI()) {
  console.log("Running in CI");
}

// Check if colors should be used (respects FORCE_COLOR, NO_COLOR)
if (shouldUseColors()) {
  // Use colored output
}

// Check if terminal is interactive
if (isInteractive()) {
  // Enable interactive features
}
```

**Functions:**

| Function | Returns | Description |
|----------|---------|-------------|
| `isCI()` | `boolean` | Detects CI environments (GitHub Actions, GitLab CI, CircleCI, Travis, Jenkins, etc.) |
| `shouldUseColors()` | `boolean` | Checks if colors should be used (respects FORCE_COLOR, NO_COLOR env vars) |
| `isInteractive()` | `boolean` | Returns `false` in CI, otherwise checks if stdin is a TTY |

### Spinners

Access spinner definitions directly.

```typescript
import { spinners, type SpinnerName, type SpinnerDefinition } from "jsr:@deno-ink/core";

const dotsSpinner = spinners.dots;
// { interval: 80, frames: ["...", "...", ...] }
```

---

## TypeScript Types

All types are exported for TypeScript users:

```typescript
import type {
  // Render
  InkOptions,
  InkInstance,

  // Components
  BoxProps,
  TextProps,
  NewlineProps,
  SpinnerProps,
  StaticProps,
  TransformProps,
  ErrorBoundaryProps,
  ErrorBoundaryState,
  TextInputProps,
  SelectInputProps,
  SelectInputItem,
  ProgressBarProps,
  BadgeProps,
  StatusMessageProps,
  StatusMessageVariant,
  ConfirmInputProps,

  // Hooks
  Key,
  InputHandler,
  UseFocusOptions,
  UseFocusResult,
  UseFocusManagerResult,

  // Styles
  Styles,

  // Contexts
  AppContextValue,
  FocusContextValue,
  StdoutContextValue,
  StderrContextValue,
  StdinContextValue,
  AccessibilityContextValue,

  // Utilities
  ElementDimensions,

  // Spinners
  SpinnerName,
  SpinnerDefinition,
} from "jsr:@deno-ink/core";
```

---

## Render Options

```typescript
interface InkOptions {
  stdout?: typeof Deno.stdout;  // Custom stdout stream
  stdin?: typeof Deno.stdin;    // Custom stdin stream
  stderr?: typeof Deno.stderr;  // Custom stderr stream
  exitOnCtrlC?: boolean;        // Exit on Ctrl+C (default: true)
  debug?: boolean;              // Enable debug mode (default: false)
  maxFps?: number;              // Maximum frames per second (default: 60)
  patchConsole?: boolean;       // Intercept console.log during render (default: true)
  isScreenReaderEnabled?: boolean;  // Enable screen reader mode
  onRender?: (info: { renderTime: number }) => void;  // Render callback with timing
}

interface InkInstance {
  rerender: (node: ReactNode) => void;  // Re-render with new element
  unmount: () => void;                   // Unmount and cleanup
  waitUntilExit: () => Promise<void>;   // Wait for app to exit
  clear: () => void;                     // Clear the output
}
```

---

## Credits

This is a Deno port of [Ink](https://github.com/vadimdemedes/ink) by [Vadim Demedes](https://github.com/vadimdemedes). All credit for the original design and API goes to the Ink team.

## Related

- [Ink](https://github.com/vadimdemedes/ink) - The original React renderer for CLIs (Node.js)
- [Yoga](https://yogalayout.dev/) - Flexbox layout engine
- [React](https://react.dev/) - The library for web and native user interfaces

## License

MIT
