import { describe, it, expect } from "vitest";
import { parseFrontmatterOverrides } from "../frontmatter.js";

describe("parseFrontmatterOverrides", () => {
  it("extracts type from leading YAML frontmatter", () => {
    const content = "---\ntype: review\n---\n\n# Title\nbody";
    expect(parseFrontmatterOverrides(content)).toEqual({ type: "review" });
  });

  it("returns an empty object when there is no frontmatter", () => {
    expect(parseFrontmatterOverrides("# Title\n\nbody")).toEqual({});
  });

  it("ignores keys other than type", () => {
    const content = "---\ntype: review\ntopics: [a, b]\n---\nbody";
    expect(parseFrontmatterOverrides(content)).toEqual({ type: "review" });
  });

  it("returns an empty object on malformed YAML", () => {
    const content = "---\ntype: ': :[ broken\n---\nbody";
    expect(parseFrontmatterOverrides(content)).toEqual({});
  });

  it("ignores a non-string type value", () => {
    const content = "---\ntype:\n  - nested\n---\nbody";
    expect(parseFrontmatterOverrides(content)).toEqual({});
  });
});
