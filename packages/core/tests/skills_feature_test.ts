/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { assertEquals, assertRejects } from "@std/assert";
import { parseConfig, SkillsFeature, ToolExecutionError } from "../mod.ts";

Deno.test("SkillsFeature discovers flat and packaged project skills", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${directory}/review.md`,
      "---\nname: code-review\ndescription: Review a patch.\n---\nReview carefully.",
    );
    await Deno.mkdir(`${directory}/release`);
    await Deno.writeTextFile(
      `${directory}/release/SKILL.md`,
      "---\ndescription: Publish a release.\n---\nPublish only after validation.",
    );
    await Deno.mkdir(`${directory}/not-a-skill`);

    const tools = await new SkillsFeature(directory).createTools();
    const list = tools.find((tool) => tool.name === "skills_list")!;
    const load = tools.find((tool) => tool.name === "skills_load")!;

    assertEquals(JSON.parse(await list.execute({} as never, {}) as string), [
      { name: "code-review", description: "Review a patch." },
      { name: "release", description: "Publish a release." },
    ]);
    assertEquals(
      await load.execute({} as never, { name: "code-review" }) as string,
      "---\nname: code-review\ndescription: Review a patch.\n---\nReview carefully.",
    );
    await assertRejects(
      () => load.execute({} as never, { name: "missing" }),
      ToolExecutionError,
      "Call skills_list",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SkillsFeature treats a missing project skill directory as empty", async () => {
  const directory = await Deno.makeTempDir();
  await Deno.remove(directory, { recursive: true });
  const list = (await new SkillsFeature(directory).createTools()).find((tool) =>
    tool.name === "skills_list"
  )!;
  assertEquals(await list.execute({} as never, {}), "[]");
});

Deno.test("skills configuration defaults and accepts a project-relative directory", () => {
  const source = `
models:
  local:
    provider: ollama
    model: test
agents:
  - type: test
    model: local
`;
  assertEquals(parseConfig(source).skills.directory, ".agentzoo_skills");
  assertEquals(
    parseConfig(`${source}skills:\n  directory: instructions\n`).skills
      .directory,
    "instructions",
  );
});
