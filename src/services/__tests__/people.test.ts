import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(),
}));

describe("canonicalizePeople", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("passes names through unchanged when no peopleFile is configured", async () => {
    const { loadConfig } = await import("../../config.js");
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      vaultRoot: null,
      peopleFile: null,
    });
    const { canonicalizePeople } = await import("../people.js");
    expect(canonicalizePeople(["Morgan-K", "alex"])).toEqual([
      "morgan-k",
      "alex",
    ]);
  });
});

describe("canonicalizePeople with people.yaml", () => {
  let tmpDir: string;
  let yamlPath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "people-test-"));
    yamlPath = join(tmpDir, "people.yaml");
  });

  async function loadWith(yamlContent: string) {
    writeFileSync(yamlPath, yamlContent);
    const { loadConfig } = await import("../../config.js");
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      vaultRoot: tmpDir,
      peopleFile: "people.yaml",
    });
    const mod = await import("../people.js");
    mod._resetPeopleCacheForTests();
    return mod;
  }

  it("collapses aliases to canonical names", async () => {
    const { canonicalizePeople } = await loadWith(`
morgan:
  aliases: [Morgan-K, "morgan king"]
alex:
  aliases: [kitekeeper]
`);
    expect(canonicalizePeople(["Morgan-K", "kitekeeper"])).toEqual([
      "morgan",
      "alex",
    ]);
  });

  it("is case-insensitive on input", async () => {
    const { canonicalizePeople } = await loadWith(`
alex:
  aliases: [kitekeeper]
`);
    expect(canonicalizePeople(["KITEKEEPER", "KiteKeeper"])).toEqual(["alex"]);
  });

  it("treats canonical name as its own alias", async () => {
    const { canonicalizePeople } = await loadWith(`
morgan: {}
`);
    expect(canonicalizePeople(["morgan", "MORGAN"])).toEqual(["morgan"]);
  });

  it("passes unknown names through (lowercased) without dropping", async () => {
    const { canonicalizePeople } = await loadWith(`
morgan: {}
`);
    expect(canonicalizePeople(["unknown_person", "Morgan"])).toEqual([
      "unknown_person",
      "morgan",
    ]);
  });

  it("drops names listed in _drop", async () => {
    const { canonicalizePeople } = await loadWith(`
_drop: [claude, bot]
morgan: {}
`);
    expect(canonicalizePeople(["claude", "Morgan", "Bot"])).toEqual(["morgan"]);
  });

  it("dedupes after canonicalization", async () => {
    const { canonicalizePeople } = await loadWith(`
morgan:
  aliases: [Morgan-K]
`);
    expect(canonicalizePeople(["morgan", "Morgan-K", "MORGAN"])).toEqual(["morgan"]);
  });

  it("throws when an alias maps to two different canonicals", async () => {
    writeFileSync(
      yamlPath,
      `
morgan:
  aliases: [shared]
alex:
  aliases: [shared]
`,
    );
    const { loadConfig } = await import("../../config.js");
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      vaultRoot: tmpDir,
      peopleFile: "people.yaml",
    });
    const mod = await import("../people.js");
    mod._resetPeopleCacheForTests();
    expect(() => mod.canonicalizePeople(["shared"])).toThrow(
      /alias 'shared' maps to both/,
    );
  });

  it("ignores reserved underscore-prefixed keys other than _drop", async () => {
    const { canonicalizePeople } = await loadWith(`
_meta: anything
morgan: {}
`);
    expect(canonicalizePeople(["_meta", "morgan"])).toEqual(["_meta", "morgan"]);
  });
});
