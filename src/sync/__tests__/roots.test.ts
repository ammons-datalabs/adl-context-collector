import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";
import { resolveRoots, syncAllRoots } from "../roots.js";
import type { CollectorConfig } from "../../config.js";

vi.mock("../orchestrator.js", () => ({ syncVaultIndex: vi.fn() }));
import { syncVaultIndex } from "../orchestrator.js";

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

describe("syncAllRoots", () => {
  const mk = (n: number) => ({
    scanned: n, newCount: n, changedCount: 0, deletedCount: 0,
    unchangedCount: 0, failedCount: 0, failures: [],
  });

  beforeEach(() => {
    vi.mocked(syncVaultIndex).mockReset();
  });

  it("calls syncVaultIndex once per root with merged options, preserving order", async () => {
    vi.mocked(syncVaultIndex)
      .mockResolvedValueOnce(mk(1)).mockResolvedValueOnce(mk(2));

    const roots = [
      { vaultRoot: "/a", include: ["**"], exclude: [], extensions: [".md"] },
      { vaultRoot: "/b", include: ["docs"], exclude: ["x"], extensions: [".md"] },
    ];
    const onProgress = vi.fn();
    const results = await syncAllRoots(
      roots,
      { dryRun: false, force: false, verbose: false },
      onProgress,
    );

    expect(syncVaultIndex).toHaveBeenCalledTimes(2);
    expect(syncVaultIndex).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ vaultRoot: "/a", dryRun: false, force: false, verbose: false }),
      expect.any(Function));
    expect(syncVaultIndex).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ vaultRoot: "/b", include: ["docs"] }),
      expect.any(Function));
    expect(results.map((r) => r.newCount)).toEqual([1, 2]);
  });

  it("records a root-level failure and still runs later roots when one root rejects", async () => {
    vi.mocked(syncVaultIndex)
      .mockResolvedValueOnce(mk(1))
      .mockRejectedValueOnce(new Error("ENOENT: no such dir"))
      .mockResolvedValueOnce(mk(3));

    const roots = [
      { vaultRoot: "/a", include: ["**"], exclude: [], extensions: [".md"] },
      { vaultRoot: "/bad", include: ["**"], exclude: [], extensions: [".md"] },
      { vaultRoot: "/c", include: ["**"], exclude: [], extensions: [".md"] },
    ];
    const results = await syncAllRoots(
      roots,
      { dryRun: false, force: false, verbose: false },
    );

    expect(syncVaultIndex).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    expect(results[0].newCount).toBe(1);
    expect(results[2].newCount).toBe(3);
    expect(results[1].failedCount).toBe(1);
    expect(results[1].failures).toEqual([{ path: "/bad", error: "ENOENT: no such dir" }]);
  });
});
