import type { Skill, SkillLoader, SkillMeta } from "./types.ts";

/**
 * Parse YAML frontmatter from a markdown string.
 * Extracts `name` and `description` fields only.
 */
function parseFrontmatter(
  content: string,
): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

/**
 * Derive a skill name from a file path (strip directory and extension).
 */
function nameFromPath(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.md$/i, "");
}

/**
 * Loads skills from a directory on disk.
 *
 * Discovery rules (applied in order):
 * 1. `<dir>/<name>.md` — a flat markdown file; frontmatter name/description are
 *    used when present, otherwise the filename is used as the name.
 * 2. `<dir>/<name>/SKILL.md` — a skill packaged as a sub-directory; the
 *    subdirectory name is used when no frontmatter name is present.
 *
 * @example
 * ```ts
 * const loader = new DirectorySkillLoader("/path/to/skills");
 * const toolset = new SkillsToolset(loader);
 * ```
 */
export class DirectorySkillLoader implements SkillLoader {
  constructor(private readonly dir: string) {}

  async listSkills(): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];
    try {
      for await (const entry of Deno.readDir(this.dir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const filePath = `${this.dir}/${entry.name}`;
          const content = await Deno.readTextFile(filePath);
          const { name, description } = parseFrontmatter(content);
          skills.push({
            name: name ?? nameFromPath(entry.name),
            description: description ?? "",
          });
        } else if (entry.isDirectory) {
          const skillMdPath = `${this.dir}/${entry.name}/SKILL.md`;
          try {
            const content = await Deno.readTextFile(skillMdPath);
            const { name, description } = parseFrontmatter(content);
            skills.push({
              name: name ?? entry.name,
              description: description ?? "",
            });
          } catch {
            // No SKILL.md in this subdirectory — skip
          }
        }
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    return skills;
  }

  async loadSkill(name: string): Promise<Skill | null> {
    // Try flat file first
    const flatPath = `${this.dir}/${name}.md`;
    try {
      const content = await Deno.readTextFile(flatPath);
      const { name: fmName, description } = parseFrontmatter(content);
      return { name: fmName ?? name, description: description ?? "", content };
    } catch {
      // fall through
    }

    // Try subdirectory SKILL.md
    const dirPath = `${this.dir}/${name}/SKILL.md`;
    try {
      const content = await Deno.readTextFile(dirPath);
      const { name: fmName, description } = parseFrontmatter(content);
      return { name: fmName ?? name, description: description ?? "", content };
    } catch {
      // fall through
    }

    return null;
  }
}

// denoCacheMetadata={"headers":{"content-length":"3311","cf-ray":"a0a0fcb8680f31aa-LHR","cross-origin-resource-policy":"cross-origin","content-encoding":"identity","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex","etag":"\"a32ee8bef40807f22e2b7a605f44cc9e\"","content-type":"text/typescript","vary":"Origin","cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","server":"cloudflare","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=ccMRGybXVoX9SPaLQcmcwcrjYyfd4aYh57sbwNxoxIO9O4ViLde79aY9iPKWqaBJ1fWGiy0lzwKIgRxOU5s11WlbruIhDr0AarZkacxGzB9AzoxBC5c2Vd4%3D\"}]}","access-control-expose-headers":"*","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-jsr-backend":"modules","alt-svc":"h3=\":443\"; ma=86400","access-control-allow-origin":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/skills/directory_skill_loader.ts","time":1781184802}