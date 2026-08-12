export interface SkillMeta {
  /** Unique skill identifier (parsed from frontmatter `name` or derived from filename). */
  name: string;
  /** Short description of what the skill does. */
  description: string;
}

export interface Skill extends SkillMeta {
  /** Full markdown content of the skill file. */
  content: string;
}

/**
 * Abstraction over skill storage. Implement this interface to load skills from
 * any source (filesystem, database, remote registry, etc.).
 *
 * The default implementation is `DirectorySkillLoader`.
 */
export interface SkillLoader {
  /** Return metadata for all available skills. */
  listSkills(): Promise<SkillMeta[]>;
  /** Return the full skill by name, or `null` if not found. */
  loadSkill(name: string): Promise<Skill | null>;
}

// denoCacheMetadata={"headers":{"content-encoding":"identity","date":"Thu, 11 Jun 2026 13:33:23 GMT","x-robots-tag":"noindex","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","etag":"\"8868502cc04286e3d4081bba86a8f1db\"","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=sypp68HkODObC6nEtEj9sKZnhiTi7keNeifHIrSYhR6E5Q%2B468mSIh56SYXIRdIf77%2BtbbQGJ2Ed%2BptSk4I7wQIYIzDrmFibQVpuRrwHFLvP4pqeO96ut%2FA%3D\"}]}","vary":"Origin","alt-svc":"h3=\":443\"; ma=86400","content-type":"text/typescript","cache-control":"public, max-age=31536000, immutable","x-jsr-backend":"modules","cf-ray":"a0a0fcb8681431aa-LHR","content-length":"774","access-control-allow-origin":"*","cross-origin-resource-policy":"cross-origin","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","access-control-expose-headers":"*","x-content-type-options":"nosniff","server":"cloudflare"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/community/skills/types.ts","time":1781184802}