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
          "List available project skills with their names and descriptions, plus any skill files that could not be read. Call this before loading a skill.",
        parameters: ListSkillsParameters,
        execute: async () => {
          const { skills, problems } = await this.discover();
          return JSON.stringify({
            skills: [...skills.values()]
              .sort((left, right) => left.name.localeCompare(right.name))
              .map(({ name, description }) => ({ name, description })),
            problems,
          });
        },
      }),
      tool<AgentRunDeps, typeof LoadSkillParameters>({
        name: "skills_load",
        description:
          "Load the complete instructions for a project skill discovered with skills_list.",
        parameters: LoadSkillParameters,
        execute: async (_context, { name }) => {
          const { skills } = await this.discover();
          const skill = skills.get(name);
          if (!skill) {
            const available = [...skills.keys()].sort();
            throw actionableToolError([
              `Skill "${name}" was not found in the project skill directory.`,
              available.length
                ? `Available skills: ${available.join(", ")}.`
                : "No skills are currently available.",
              "Call skills_list to see the skills currently available.",
            ]);
          }
          return skill.content;
        },
      }),
    ];
  }

  private async discover(): Promise<{
    skills: Map<string, Skill>;
    problems: Array<{ path: string; error: string }>;
  }> {
    const empty = {
      skills: new Map<string, Skill>(),
      problems: [] as Array<{ path: string; error: string }>,
    };
    let root: string;
    try {
      root = await Deno.realPath(this.#directory);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return empty;
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
    const sources = new Map<string, string>();
    const problems: Array<{ path: string; error: string }> = [];
    for (const path of paths.sort()) {
      try {
        const canonical = await Deno.realPath(path);
        if (!isWithin(root, canonical)) continue;
        const content = await Deno.readTextFile(canonical);
        const frontmatter = parseFrontmatter(content, canonical);
        const name = frontmatter.name || skillName(path);
        const previous = sources.get(name);
        if (previous) {
          problems.push({
            path: canonical,
            error:
              `Duplicate skill "${name}" is also defined by ${previous}; rename one of them.`,
          });
          continue;
        }
        sources.set(name, canonical);
        skills.set(name, {
          name,
          description: frontmatter.description ||
            "(no description in frontmatter)",
          content,
        });
      } catch (error) {
        // One broken or unreadable file must not hide the valid skills.
        problems.push({
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { skills, problems };
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
