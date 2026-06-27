import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadManifest,
  saveManifest,
  computeSyncPlan,
  EMPTY_MANIFEST,
} from "../manifest.js";
import type { VaultFile } from "../walker.js";

describe("loadManifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  it("returns empty manifest when file does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
    const manifest = await loadManifest(tmpDir);
    expect(manifest).toEqual(EMPTY_MANIFEST);
  });

  it("reads existing manifest", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
    const data = {
      last_run: "2026-03-22T23:00:00+10:00",
      files: { "meetings/notes.md": { mtime_ms: 1711100000000 } },
    };
    await writeFile(
      join(tmpDir, ".vault-index-manifest.json"),
      JSON.stringify(data)
    );

    const manifest = await loadManifest(tmpDir);
    expect(manifest.last_run).toBe("2026-03-22T23:00:00+10:00");
    expect(manifest.files["meetings/notes.md"].mtime_ms).toBe(1711100000000);
  });
});

describe("saveManifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  it("writes manifest to .vault-index-manifest.json", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
    const manifest = {
      last_run: "2026-03-22T23:00:00+10:00",
      files: { "test.md": { mtime_ms: 123456 } },
    };

    await saveManifest(tmpDir, manifest);

    const raw = await readFile(
      join(tmpDir, ".vault-index-manifest.json"),
      "utf-8"
    );
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(manifest);
  });
});

describe("computeSyncPlan", () => {
  function file(relPath: string, mtimeMs: number): VaultFile {
    return {
      relativePath: relPath,
      absolutePath: `/vault/${relPath}`,
      mtimeMs,
    };
  }

  it("marks all files as new when manifest is empty", () => {
    const files = [file("a.md", 100), file("b.md", 200)];
    const plan = computeSyncPlan(files, EMPTY_MANIFEST);

    expect(plan.newFiles).toHaveLength(2);
    expect(plan.changedFiles).toHaveLength(0);
    expect(plan.deletedPaths).toHaveLength(0);
    expect(plan.unchangedPaths).toHaveLength(0);
  });

  it("detects changed files by mtime", () => {
    const manifest = {
      last_run: null,
      files: { "a.md": { mtime_ms: 100 } },
    };
    const files = [file("a.md", 200)];

    const plan = computeSyncPlan(files, manifest);

    expect(plan.changedFiles).toHaveLength(1);
    expect(plan.changedFiles[0].relativePath).toBe("a.md");
  });

  it("detects deleted files", () => {
    const manifest = {
      last_run: null,
      files: {
        "a.md": { mtime_ms: 100 },
        "deleted.md": { mtime_ms: 50 },
      },
    };
    const files = [file("a.md", 100)];

    const plan = computeSyncPlan(files, manifest);

    expect(plan.deletedPaths).toEqual(["deleted.md"]);
    expect(plan.unchangedPaths).toEqual(["a.md"]);
  });

  it("marks unchanged files when mtime matches", () => {
    const manifest = {
      last_run: null,
      files: { "a.md": { mtime_ms: 100 } },
    };
    const files = [file("a.md", 100)];

    const plan = computeSyncPlan(files, manifest);

    expect(plan.unchangedPaths).toEqual(["a.md"]);
    expect(plan.newFiles).toHaveLength(0);
    expect(plan.changedFiles).toHaveLength(0);
  });
});
