import { assertEquals, assertRejects } from "@std/assert";
import { TextTemplate } from "../TextTemplate.ts";

Deno.test("preserves replacement and positional behavior", async () => {
  const template = new TextTemplate("Hello {name}: ${...} / $1 / $2");
  assertEquals(
    await template({ name: "Alice" }, "one", "two"),
    "Hello Alice: one two / one / two",
  );
});

Deno.test("preserves multiline text", async () => {
  const template = new TextTemplate("Hello\n{name}\nWorld");
  assertEquals(await template({ name: "Alice" }), "Hello\nAlice\nWorld");
});

Deno.test("renders IF, negation, ELSE, and nested blocks", async () => {
  const template = new TextTemplate(
    "{#IF enabled}\nyes\n{#ELSE}\nno\n{#END}\n{#IF !enabled}\noff\n{#END}",
  );
  assertEquals(await template({ enabled: true }), "yes\n");
  assertEquals(await template({ enabled: false }), "no\noff\n");
});

Deno.test("renders FOR", async () => {
  const template = new TextTemplate(
    "{#FOR user IN users}\n{user};\n{#END}",
  );
  assertEquals(
    await template({ users: ["Alice", "Bob"] }),
    "Alice;\nBob;\n",
  );
});

Deno.test("WITH exposes direct object properties", async () => {
  const template = new TextTemplate(
    "{#FOR user IN users}\n{#WITH user}\n{id}:{username};\n{#END}\n{#END}",
  );
  assertEquals(
    await template({
      users: [
        { id: 10, username: "Alice" },
        { id: 20, username: "Bob" },
      ],
    }),
    "10:Alice;\n20:Bob;\n",
  );
});

Deno.test("SET, INC, and DEC operate on render-local state", async () => {
  const template = new TextTemplate(
    "{#SET idx: 0}\n{#INC idx}\n{#INC idx}\n{idx}|\n{#DEC idx}\n{idx}",
  );
  assertEquals(await template(), "2|\n1");
});

Deno.test("context values are read-only and take precedence over SET", async () => {
  const template = new TextTemplate('{#SET greeting: "local"}\n{greeting}');
  assertEquals(await template({ greeting: "context" }), "context");
});

Deno.test("temporary bindings are read-only", async () => {
  const template = new TextTemplate(
    '{#FOR item IN items}\n{#SET item: "changed"}\n{item}\n{#END}',
  );
  assertEquals(await template({ items: ["original"] }), "original\n");
});

Deno.test("missing FOR collections render zero iterations", async () => {
  const template = new TextTemplate("{#FOR item IN items}\n{item}\n{#END}");
  assertEquals(await template(), "");
});

Deno.test("does not reparse inserted values", async () => {
  const template = new TextTemplate("{body}");
  assertEquals(
    await template({ body: "{#IF enabled}secret{#END}" }),
    "{#IF enabled}secret{#END}",
  );
});

Deno.test("reports malformed blocks", async () => {
  await assertRejects(
    () =>
      new TextTemplate("{#IF enabled}\nmissing end").render({ enabled: true }),
    Error,
    "Unclosed {#IF} block",
  );

  await assertRejects(
    () => new TextTemplate("{#ELSE}").render(),
    Error,
    "#ELSE",
  );

  await assertRejects(
    () =>
      new TextTemplate("{#FOR item IN value}\n{item}\n{#END}").render({
        value: "not an array",
      }),
    Error,
    "requires an array",
  );
});
