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
    expect(canonicalizePeople(["Adam-Hammo", "andrew"])).toEqual([
      "adam-hammo",
      "andrew",
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
adam:
  aliases: [Adam-Hammo, "adam hamilton"]
andrew:
  aliases: [mootpointer]
`);
    expect(canonicalizePeople(["Adam-Hammo", "mootpointer"])).toEqual([
      "adam",
      "andrew",
    ]);
  });

  it("is case-insensitive on input", async () => {
    const { canonicalizePeople } = await loadWith(`
andrew:
  aliases: [mootpointer]
`);
    expect(canonicalizePeople(["MOOTPOINTER", "MootPointer"])).toEqual(["andrew"]);
  });

  it("treats canonical name as its own alias", async () => {
    const { canonicalizePeople } = await loadWith(`
adam: {}
`);
    expect(canonicalizePeople(["adam", "ADAM"])).toEqual(["adam"]);
  });

  it("passes unknown names through (lowercased) without dropping", async () => {
    const { canonicalizePeople } = await loadWith(`
adam: {}
`);
    expect(canonicalizePeople(["unknown_person", "Adam"])).toEqual([
      "unknown_person",
      "adam",
    ]);
  });

  it("drops names listed in _drop", async () => {
    const { canonicalizePeople } = await loadWith(`
_drop: [claude, bot]
adam: {}
`);
    expect(canonicalizePeople(["claude", "Adam", "Bot"])).toEqual(["adam"]);
  });

  it("dedupes after canonicalization", async () => {
    const { canonicalizePeople } = await loadWith(`
adam:
  aliases: [Adam-Hammo]
`);
    expect(canonicalizePeople(["adam", "Adam-Hammo", "ADAM"])).toEqual(["adam"]);
  });

  it("throws when an alias maps to two different canonicals", async () => {
    writeFileSync(
      yamlPath,
      `
adam:
  aliases: [shared]
andrew:
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
adam: {}
`);
    expect(canonicalizePeople(["_meta", "adam"])).toEqual(["_meta", "adam"]);
  });
});
