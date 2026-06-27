import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { walkVault } from "../walker.js";

describe("walkVault", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  async function createFixture(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "walker-test-"));
    // meetings/notes.md
    await mkdir(join(tmpDir, "meetings"), { recursive: true });
    await writeFile(join(tmpDir, "meetings/notes.md"), "# Notes");
    // projects/foo/slack/thread.md
    await mkdir(join(tmpDir, "projects/foo/slack"), { recursive: true });
    await writeFile(join(tmpDir, "projects/foo/slack/thread.md"), "thread");
    // projects/foo/github/status.json (wrong extension)
    await mkdir(join(tmpDir, "projects/foo/github"), { recursive: true });
    await writeFile(join(tmpDir, "projects/foo/github/status.json"), "{}");
    // projects/bar/plans/roadmap.md
    await mkdir(join(tmpDir, "projects/bar/plans"), { recursive: true });
    await writeFile(join(tmpDir, "projects/bar/plans/roadmap.md"), "# Plan");
    // .hidden/secret.md (dotfile dir)
    await mkdir(join(tmpDir, ".hidden"), { recursive: true });
    await writeFile(join(tmpDir, ".hidden/secret.md"), "secret");
    // templates/template.md (excluded)
    await mkdir(join(tmpDir, "templates"), { recursive: true });
    await writeFile(join(tmpDir, "templates/template.md"), "template");
    // root.txt (not in include)
    await writeFile(join(tmpDir, "root.txt"), "root");
    return tmpDir;
  }

  it("returns files matching include patterns and filters excludes", async () => {
    const root = await createFixture();
    const files = await walkVault(root, {
      include: ["meetings", "projects/*/slack", "projects/*/plans"],
      exclude: ["templates"],
      extensions: [".md"],
    });

    const relPaths = files.map((f) => f.relativePath).sort();
    expect(relPaths).toEqual([
      "meetings/notes.md",
      "projects/bar/plans/roadmap.md",
      "projects/foo/slack/thread.md",
    ]);
  });

  it("excludes dotfile directories implicitly", async () => {
    const root = await createFixture();
    const files = await walkVault(root, {
      include: ["**"],
      exclude: [],
      extensions: [".md"],
    });

    const relPaths = files.map((f) => f.relativePath);
    expect(relPaths).not.toContain(".hidden/secret.md");
  });

  it("filters by extension", async () => {
    const root = await createFixture();
    const files = await walkVault(root, {
      include: ["**"],
      exclude: [],
      extensions: [".json"],
    });

    const relPaths = files.map((f) => f.relativePath);
    expect(relPaths).toContain("projects/foo/github/status.json");
    expect(relPaths.every((p) => p.endsWith(".json"))).toBe(true);
  });

  it("includes mtime for each file", async () => {
    const root = await createFixture();
    const files = await walkVault(root, {
      include: ["**"],
      exclude: [],
      extensions: [".md"],
    });

    for (const f of files) {
      expect(f.mtimeMs).toBeGreaterThan(0);
      expect(f.absolutePath).toMatch(/^\//);
    }
  });

  it("returns all files when include is ['**']", async () => {
    const root = await createFixture();
    const files = await walkVault(root, {
      include: ["**"],
      exclude: [],
      extensions: [".md", ".txt"],
    });

    const relPaths = files.map((f) => f.relativePath).sort();
    expect(relPaths).toContain("root.txt");
    expect(relPaths).toContain("templates/template.md");
    expect(relPaths).not.toContain(".hidden/secret.md");
  });
});
