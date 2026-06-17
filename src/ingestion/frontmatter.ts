import yaml from "js-yaml";

export interface FrontmatterOverrides {
  type?: string;
}

/**
 * Extract a `type` override from a markdown file's leading YAML frontmatter.
 * Returns an empty object when there is no frontmatter, it can't be parsed, or
 * `type` isn't present as a string.
 *
 * Generated documents use this to declare their type deterministically rather
 * than relying on the LLM metadata extractor (which, for example, mistakes
 * threaded review conversations for meeting notes).
 */
export function parseFrontmatterOverrides(content: string): FrontmatterOverrides {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end < 1) return {};

  let doc: unknown;
  try {
    doc = yaml.load(lines.slice(1, end).join("\n"));
  } catch {
    return {};
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};

  const rec = doc as Record<string, unknown>;
  const out: FrontmatterOverrides = {};
  if (typeof rec.type === "string" && rec.type.trim()) out.type = rec.type.trim();
  return out;
}
