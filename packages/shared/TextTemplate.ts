// deno-lint-ignore-file no-explicit-any no-this-alias

// This callable Function/Proxy compatibility surface necessarily crosses
// dynamic boundaries; its public API remains typed below.

/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of AgentZoo.
 *
 * AgentZoo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * AgentZoo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AgentZoo.  If not, see <https://www.gnu.org/licenses/>.
*/
interface TemplateArgs {
  [key: string]: any;
}

type Scope = {
  context: TemplateArgs;
  locals: Map<string, unknown>;
  temporary: Map<string, unknown>[];
};

type Node =
  | { type: "text"; value: string }
  | {
    type: "if";
    key: string;
    negate: boolean;
    yes: Node[];
    no: Node[];
    line: number;
  }
  | {
    type: "for";
    item: string;
    source: string;
    body: Node[];
    line: number;
  }
  | { type: "with"; source: string; body: Node[]; line: number }
  | { type: "set"; key: string; value: unknown }
  | { type: "inc" | "dec"; key: string; line: number };

const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_-]*";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function directive(line: string): string | undefined {
  const trimmed = line.trim();
  return trimmed.startsWith("{#") && trimmed.endsWith("}")
    ? trimmed.slice(2, -1).trim()
    : undefined;
}

function parseLiteral(value: string, line: number): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid string literal on line ${line}`);
    }
  }

  throw new Error(
    `Invalid SET value on line ${line}; expected a string, number, boolean, or null`,
  );
}

function parseTemplate(source: string): Node[] {
  const lines: string[] = [];
  let lineStart = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      lines.push(source.slice(lineStart, index + 1));
      lineStart = index + 1;
    }
  }
  if (lineStart < source.length || source.length === 0) {
    lines.push(source.slice(lineStart));
  }

  let cursor = 0;

  function parseBlock(
    expectedEnd: "IF" | "FOR" | "WITH" | undefined,
  ): { nodes: Node[]; elseNodes?: Node[] } {
    const nodes: Node[] = [];
    let elseNodes: Node[] | undefined;

    while (cursor < lines.length) {
      const line = lines[cursor++];
      const lineNumber = cursor;
      const raw = directive(line);

      if (raw === undefined) {
        (elseNodes ?? nodes).push({ type: "text", value: line });
        continue;
      }

      if (raw === "END") {
        if (!expectedEnd) {
          throw new Error(`#END without an open block on line ${lineNumber}`);
        }
        return { nodes, elseNodes };
      }

      if (raw === "ELSE") {
        if (expectedEnd !== "IF") {
          throw new Error(
            `{#ELSE} is only valid in an IF block on line ${lineNumber}`,
          );
        }
        if (elseNodes) {
          throw new Error(`Duplicate {#ELSE} on line ${lineNumber}`);
        }
        elseNodes = [];
        continue;
      }

      let match = raw.match(new RegExp(`^IF\\s+(!?)(${IDENTIFIER})$`));
      if (match) {
        const [, negate, key] = match;
        const parsed = parseBlock("IF");
        (elseNodes ?? nodes).push({
          type: "if",
          key,
          negate: negate === "!",
          yes: parsed.nodes,
          no: parsed.elseNodes ?? [],
          line: lineNumber,
        });
        continue;
      }

      match = raw.match(
        new RegExp(
          `^FOR\\s+(${IDENTIFIER})\\s+IN\\s+(${IDENTIFIER})$`,
        ),
      );
      if (match) {
        const [, item, sourceName] = match;
        const parsed = parseBlock("FOR");
        if (parsed.elseNodes) {
          throw new Error(
            `{#ELSE} is not valid in a FOR block on line ${lineNumber}`,
          );
        }
        (elseNodes ?? nodes).push({
          type: "for",
          item,
          source: sourceName,
          body: parsed.nodes,
          line: lineNumber,
        });
        continue;
      }

      match = raw.match(new RegExp(`^WITH\\s+(${IDENTIFIER})$`));
      if (match) {
        const [, sourceName] = match;
        const parsed = parseBlock("WITH");
        if (parsed.elseNodes) {
          throw new Error(
            `{#ELSE} is not valid in a WITH block on line ${lineNumber}`,
          );
        }
        (elseNodes ?? nodes).push({
          type: "with",
          source: sourceName,
          body: parsed.nodes,
          line: lineNumber,
        });
        continue;
      }

      match = raw.match(new RegExp(`^SET\\s+(${IDENTIFIER})\\s*:\\s*(.+)$`));
      if (match) {
        const [, key, value] = match;
        (elseNodes ?? nodes).push({
          type: "set",
          key,
          value: parseLiteral(value.trim(), lineNumber),
        });
        continue;
      }

      match = raw.match(new RegExp(`^(INC|DEC)\\s+(${IDENTIFIER})$`));
      if (match) {
        const [, operation, key] = match;
        (elseNodes ?? nodes).push({
          type: operation.toLowerCase() as "inc" | "dec",
          key,
          line: lineNumber,
        });
        continue;
      }

      if (/^(IF|FOR|WITH|SET|INC|DEC)\b/.test(raw)) {
        throw new Error(`Invalid directive on line ${lineNumber}: {#${raw}}`);
      }

      throw new Error(`Unknown directive on line ${lineNumber}: {#${raw}}`);
    }

    if (expectedEnd) {
      throw new Error(`Unclosed {#${expectedEnd}} block`);
    }

    return { nodes, elseNodes };
  }

  return parseBlock(undefined).nodes;
}

function lookup(
  scope: Scope,
  key: string,
): { found: boolean; value?: unknown } {
  for (let i = scope.temporary.length - 1; i >= 0; i--) {
    if (scope.temporary[i].has(key)) {
      return { found: true, value: scope.temporary[i].get(key) };
    }
  }

  if (Object.prototype.hasOwnProperty.call(scope.context, key)) {
    return { found: true, value: scope.context[key] };
  }

  if (scope.locals.has(key)) {
    return { found: true, value: scope.locals.get(key) };
  }

  return { found: false };
}

function visibleValues(scope: Scope): Map<string, unknown> {
  const values = new Map<string, unknown>();

  for (const [key, value] of Object.entries(scope.context)) {
    values.set(key, value);
  }

  for (const [key, value] of scope.locals) {
    if (!Object.prototype.hasOwnProperty.call(scope.context, key)) {
      values.set(key, value);
    }
  }

  for (const frame of scope.temporary) {
    for (const [key, value] of frame) {
      values.set(key, value);
    }
  }

  return values;
}

function replaceValues(text: string, scope: Scope): string {
  const values = visibleValues(scope);
  if (values.size === 0) return text;

  // Match every currently visible placeholder in one pass. Replacement values
  // are then expanded recursively, making nested placeholder resolution
  // independent of context insertion order while keeping inserted directives
  // inert: only placeholders are processed here, never template syntax.
  const pattern = new RegExp(
    `\\{(${[...values.keys()].map(escapeRegExp).join("|")})\\}`,
    "g",
  );

  const expand = (value: string, resolving: Set<string>): string =>
    value.replace(pattern, (match, key: string) => {
      if (resolving.has(key)) return match;

      const next = new Set(resolving);
      next.add(key);
      return expand(String(values.get(key)), next);
    });

  return expand(text, new Set());
}

async function renderNodes(
  nodes: Node[],
  scope: Scope,
): Promise<string> {
  let out = "";

  for (const node of nodes) {
    if (node.type === "text") {
      out += replaceValues(node.value, scope);
      continue;
    }

    if (node.type === "set") {
      if (!Object.prototype.hasOwnProperty.call(scope.context, node.key)) {
        const isTemporary = scope.temporary.some((frame) =>
          frame.has(node.key)
        );
        if (!isTemporary) scope.locals.set(node.key, node.value);
      }
      continue;
    }

    if (node.type === "inc" || node.type === "dec") {
      if (Object.prototype.hasOwnProperty.call(scope.context, node.key)) {
        continue;
      }
      if (scope.temporary.some((frame) => frame.has(node.key))) continue;

      const current = scope.locals.get(node.key);
      if (typeof current !== "number" || !Number.isFinite(current)) {
        throw new Error(
          `{#${node.type.toUpperCase()} ${node.key}} requires a numeric template local (line ${node.line})`,
        );
      }
      scope.locals.set(node.key, current + (node.type === "inc" ? 1 : -1));
      continue;
    }

    if (node.type === "if") {
      const value = lookup(scope, node.key).value;
      const active = node.negate ? !value : Boolean(value);
      out += await renderNodes(active ? node.yes : node.no, scope);
      continue;
    }

    if (node.type === "for") {
      const collection = lookup(scope, node.source).value;
      if (collection == null) continue;
      if (!Array.isArray(collection)) {
        throw new Error(
          `{#FOR ${node.item} IN ${node.source}} requires an array (line ${node.line})`,
        );
      }

      for (let index = 0; index < collection.length; index++) {
        const frame = new Map<string, unknown>();
        frame.set(node.item, collection[index]);
        scope.temporary.push(frame);
        out += await renderNodes(node.body, scope);
        scope.temporary.pop();
      }
      continue;
    }

    if (node.type === "with") {
      const value = lookup(scope, node.source).value;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(
          `{#WITH ${node.source}} requires a non-null object (line ${node.line})`,
        );
      }

      scope.temporary.push(
        new Map(Object.entries(value as Record<string, unknown>)),
      );
      out += await renderNodes(node.body, scope);
      scope.temporary.pop();
    }
  }

  return out;
}

export interface TextTemplate {
  (args?: TemplateArgs, ...positional: any[]): Promise<string>;

  template: string;
  render(args?: TemplateArgs, positional?: any[]): Promise<string>;

  toString(): string;
  clone(): TextTemplate;

  indent(level: number): TextTemplate;
  trimLines(): TextTemplate;
}

export class TextTemplate extends Function {
  public template: string;

  constructor(template: string) {
    super();
    const normalized = template.replace(/^\r?\n/, "");
    this.template = normalized.replace(/\r?\n$/, "");

    const self = this;

    const fn = async function (
      args: TemplateArgs = {},
      ...positional: any[]
    ) {
      return await self.render(args, positional);
    };

    const proxy = new Proxy(fn as any, {
      get(_t, prop) {
        const member = (self as any)[prop];
        return typeof member === "function" ? member.bind(self) : member;
      },
      set(_t, prop, value) {
        return Reflect.set(self as any, prop, value);
      },
      apply(target, _thisArg, argArray) {
        return target(...argArray);
      },
    });

    Object.setPrototypeOf(proxy, new.target.prototype);
    return proxy as any;
  }

  public async render(
    args: TemplateArgs = {},
    positional: any[] = [],
  ): Promise<string> {
    const entries = Object.entries(args);

    const resolvedEntries = await Promise.all(
      entries.map(async ([key, value]) => {
        let resolved = value;

        if (typeof value === "function") {
          const filtered = { ...args };
          delete (filtered as any)[key];
          resolved = value(filtered, ...positional);
        }

        resolved = await resolved;
        return [key, resolved] as const;
      }),
    );

    const scope: Scope = {
      context: Object.fromEntries(resolvedEntries),
      locals: new Map(),
      temporary: [],
    };

    let out = await renderNodes(parseTemplate(this.template), scope);

    // Preserve the original renderer's positional replacement stage.
    out = out.replace(/\$\{\.\.\.\}/g, positional.join(" "));
    out = out.replace(/\$(\d+)/g, (_, idx) => {
      const i = parseInt(idx, 10) - 1;
      return positional[i] !== undefined ? positional[i] : `$${idx}`;
    });

    return out;
  }

  public override toString(): string {
    throw new Error("Use await template() instead of toString()");
  }

  public [Symbol.toPrimitive](_hint: string) {
    return this.template;
  }

  public clone(): TextTemplate {
    return new (this.constructor as any)(this.template);
  }

  public indent(level: number): TextTemplate {
    const pad = " ".repeat(level);
    return new (this.constructor as any)(
      this.template
        .split("\n")
        .map((line) => (line.trim() ? pad + line : line))
        .join("\n"),
    );
  }

  public trimLines(): TextTemplate {
    return new (this.constructor as any)(
      this.template.split("\n").map((line) => line.trimEnd()).join("\n"),
    );
  }
}

// Example usage:
// const tmpl = new TextTemplate(`Hello, {name}!`);
// console.log(await tmpl({ name: "Alice" }));
// Output:
// "Hello, Alice!"
//----
// Templates can be combined and nested, they also support async functions and positional arguments
// This can be used to create complex templates that can be rendered dynamically.
// const greeting = new TextTemplate(`Hello, {name}!`);
// const farewell = new TextTemplate(`Goodbye, {name}!`);
// const combined = new TextTemplate(`${greeting}\n${farewell}`);
// console.log(await combined({ name: "Bob" }));

// TextTemplate block syntax
//
// Replacement:
//
// {name}
//
// Replaces {name} with the resolved value of name. Replacement names are
// simple identifiers. There is deliberately no dotted property access:
//
// {user.name}
//
// To access object properties, use WITH.
//
// IF:
//
// {#IF foo}
// ...
// {#END}
//
// IF renders its body when foo is truthy. Negation is supported:
//
// {#IF !foo}
// ...
// {#END}
//
// An alternative branch can be supplied with ELSE:
//
// {#IF foo}
// enabled
// {#ELSE}
// disabled
// {#END}
//
// IF performs lookup and truthiness testing only. It does not evaluate
// comparisons, boolean expressions, arithmetic, property paths, or calls.
//
// FOR:
//
// {#FOR user IN users}
// ...
// {#END}
//
// FOR iterates over an array. The loop variable is a temporary read-only
// binding and disappears when the block ends. Primitive values can be used
// directly:
//
// {#FOR name IN names}
// {name}
// {#END}
//
// For object values, use WITH:
//
// {#FOR user IN users}
// {#WITH user}
// User ID: {id}
// Username: {username}
// {#END}
// {#END}
//
// FOR does not support expressions, filtering, mapping, dotted access, or
// function calls.
//
// WITH:
//
// {#WITH user}
// User ID: {id}
// Username: {username}
// {#END}
//
// WITH temporarily exposes the direct properties of an object as
// replacement values. It is read-only and does not modify the object.
// Nested access uses nested WITH blocks rather than dotted paths:
//
// {#WITH user}
// Username: {username}
// {#WITH profile}
// Bio: {bio}
// {#END}
// {#END}
//
// SET:
//
// {#SET idx: 0}
// {#SET greeting: "Hello"}
//
// SET creates or updates template-local state for the current render.
// Supported literal values are strings, numbers, booleans, and null. SET
// does not evaluate expressions.
//
// The caller-supplied context is read-only. If SET targets a context name,
// it is a NOOP:
//
// {#SET greeting: "Goodbye"}
// {greeting}
//
// INC and DEC:
//
// {#INC idx}
// {#DEC idx}
//
// INC and DEC modify only numeric template-local state. They do not modify
// caller context values or temporary FOR/WITH bindings.
//
// Scope:
//
// 1. Template context is supplied by the caller and is read-only.
// 2. Template locals are created by SET and exist for one render.
// 3. Temporary bindings are introduced by FOR and WITH and are read-only.
//
// Temporary bindings take precedence while their block is active. Context
// values take precedence over template locals.
//
// Blocks may be nested. Replacement values may themselves contain placeholders;
// those placeholders are resolved recursively against the visible scope,
// independent of caller property order. Cyclic placeholder references remain
// literal. Inserted values are not reparsed as template source: a value
// containing "{#IF ...}" is emitted as text.
//
// Deliberate language limits:
//
// There is no dotted property access, expression evaluator, comparison
// operators, boolean expression language, arithmetic expressions, function
// calls, filtering, mapping, or object-path shorthand. Complex logic and
// transformation remain in TypeScript and are supplied through the context.
// Output:
// Hello, Bob!
// Goodbye, Bob!
//----
// This allows to create some powerful templates that can be used in various contexts, such as generating emails, reports, or code.
// The following example is a template that generates an email with dynamic content:
//
// const emailTemplate = new TextTemplate(`
// Dear {recipient},
// It has come to our attention that {issue} occurred on {date}.
// We are working to resolve this issue as soon as possible.
// Thank you for your patience.
// Best regards,
// {sender}
// `);
//
// Combine this with another template for the issue description:
//
// const issueTemplate = new TextTemplate(`
// The issue is described as follows:
// {description}
// `);
//
// Then use the issue template in the email template:
//
// const emailContent = await emailTemplate({
//   recipient: "John Doe",
//   issue: issueTemplate({ description: "The server went down due to unexpected traffic spikes." }),
//   date: "2024-06-01",
//   sender: "Support Team"
// })
// console.log(emailContent);
// Output:
// Dear John Doe,
// It has come to our attention that The issue is described as follows:
// The server went down due to unexpected traffic spikes. occurred on 2024-06-01.
// We are working to resolve this issue as soon as possible.
// Thank you for your patience.
// Best regards,
// Support Team
//----
// This demonstrates how the TextTemplate class can be used to create complex templates and nested content, including async functions and positional arguments.
//
// const greeting = new TextTemplate(`Hello, {name}!`);
// const farewell = new TextTemplate(`Goodbye, {name}!`);
// const combined = new TextTemplate(`${greeting}\n${farewell}`);
// console.log(await combined({ name: "Bob" }));
