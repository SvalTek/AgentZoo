/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

import { isAbsolute, relative, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import { TextTemplate } from "@agent-zoo/shared";
import type { AgentRunDeps } from "./Agent.ts";
import type { Feature } from "./Feature.ts";
import { actionableToolError } from "./ToolSupport.ts";

const ListSkillsParameters = z.object({});
const LoadSkillParameters = z.object({
  name: z.string().min(1).describe("Name of the skill to load"),
});

interface Skill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

/** Project-owned Markdown instructions that agents can discover progressively. */
export class SkillsFeature implements Feature<AgentRunDeps> {
  readonly id = "skills";
  readonly description = "Discover and load project skills on demand.";
  readonly systemPrompt = new TextTemplate(`## Skills

Project skills are optional instructions you can load when they are relevant.
Call \`skills_list\` to discover their names and short descriptions, then call
\`skills_load\` only for the skill you need. Follow the loaded instructions for
the current task; do not assume an unloaded skill's contents.`);

  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    const { tool } = await import("@vibesjs/sdk");
    return [
      tool<AgentRunDeps, typeof ListSkillsParameters>({
        name: "skills_list",
        description:
          "List available project skills with their names and descriptions. Call this before loading a skill.",
        parameters: ListSkillsParameters,
        execute: async () => {
          const skills = await this.discover();
          return JSON.stringify(
            [...skills.values()]
              .sort((left, right) => left.name.localeCompare(right.name))
              .map(({ name, description }) => ({ name, description })),
          );
        },
      }),
      tool<AgentRunDeps, typeof LoadSkillParameters>({
        name: "skills_load",
        description:
          "Load the complete instructions for a project skill discovered with skills_list.",
        parameters: LoadSkillParameters,
        execute: async (_context, { name }) => {
          const skill = (await this.discover()).get(name);
          if (!skill) {
            throw actionableToolError([
              `Skill "${name}" was not found in the project skill directory.`,
              "Call skills_list to see the skills currently available.",
            ]);
          }
          return skill.content;
        },
      }),
    ];
  }

  private async discover(): Promise<Map<string, Skill>> {
    let root: string;
    try {
      root = await Deno.realPath(this.#directory);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return new Map();
      throw error;
    }

    const paths: string[] = [];
    for await (const entry of Deno.readDir(root)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        paths.push(`${root}/${entry.name}`);
      } else if (entry.isDirectory) {
        const candidate = `${root}/${entry.name}/SKILL.md`;
        try {
          if ((await Deno.lstat(candidate)).isFile) paths.push(candidate);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    }

    const skills = new Map<string, Skill>();
    for (const path of paths.sort()) {
      const canonical = await Deno.realPath(path);
      if (!isWithin(root, canonical)) continue;
      const content = await Deno.readTextFile(canonical);
      const frontmatter = parseFrontmatter(content, canonical);
      const name = frontmatter.name || skillName(path);
      if (skills.has(name)) {
        throw new Error(
          `Project skill directory contains duplicate skill "${name}"`,
        );
      }
      skills.set(name, { name, description: frontmatter.description, content });
    }
    return skills;
  }
}

function parseFrontmatter(
  content: string,
  path: string,
): { name: string; description: string } {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (block === undefined || block.trim() === "") {
    return { name: "", description: "" };
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(block);
  } catch (error) {
    throw new TypeError(
      `Project skill frontmatter is not valid YAML: ${path}`,
      { cause: error },
    );
  }
  if (
    frontmatter === null || typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    throw new TypeError(
      `Project skill frontmatter must be a YAML mapping: ${path}`,
    );
  }
  const fields = frontmatter as Record<string, unknown>;
  return {
    name: typeof fields.name === "string" ? fields.name.trim() : "",
    description: typeof fields.description === "string"
      ? fields.description.trim()
      : "",
  };
}

function skillName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.at(-1) === "SKILL.md"
    ? parts.at(-2)!
    : parts.at(-1)!.replace(/\.md$/i, "");
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!isAbsolute(path) && path !== ".." &&
    !path.startsWith("../") && !path.startsWith("..\\"));
}
