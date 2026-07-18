import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { resolveRoots } from "../roots.js";
import type { CollectorConfig } from "../../config.js";

function baseConfig(overrides: Partial<CollectorConfig>): CollectorConfig {
  return {
    serverName: "t", vaultRoot: "/vault", peopleFile: null, categories: [],
    embedder: { url: "", model: "", dimensions: 1, apiKey: null },
    metadataExtractor: { enabled: false, url: "", model: "", apiKey: null },
    tools: {} as CollectorConfig["tools"],
    indexSync: null, additionalRoots: null,
    ...overrides,
  };
}

describe("resolveRoots", () => {
  it("returns the single main root with indexSync globs when no additionalRoots", () => {
    const roots = resolveRoots(baseConfig({
      indexSync: { include: ["projects/*"], exclude: ["templates"], extensions: [".md"] },
    }));
    expect(roots).toEqual([
      { vaultRoot: resolve("/vault"), include: ["projects/*"], exclude: ["templates"], extensions: [".md"] },
    ]);
  });

  it("applies default globs to the main root when indexSync is null", () => {
    const roots = resolveRoots(baseConfig({ indexSync: null }));
    expect(roots).toEqual([
      { vaultRoot: resolve("/vault"), include: ["**"], exclude: [], extensions: [".md", ".pdf", ".txt"] },
    ]);
  });

  it("appends additional roots after the main root", () => {
    const roots = resolveRoots(baseConfig({
      additionalRoots: [{ root: "/team", include: ["**"], exclude: ["**/.git/**"] }],
    }));
    expect(roots).toHaveLength(2);
    expect(roots[1]).toEqual({
      vaultRoot: resolve("/team"), include: ["**"], exclude: ["**/.git/**"],
      extensions: [".md", ".pdf", ".txt"],
    });
  });

  it("defaults an additional root's omitted globs to ['**'] / [] / default extensions", () => {
    const roots = resolveRoots(baseConfig({ additionalRoots: [{ root: "/team" }] }));
    expect(roots[1]).toEqual({
      vaultRoot: resolve("/team"), include: ["**"], exclude: [], extensions: [".md", ".pdf", ".txt"],
    });
  });

  it("throws when vaultRoot is null", () => {
    expect(() => resolveRoots(baseConfig({ vaultRoot: null }))).toThrow(/vaultRoot/);
  });
});
