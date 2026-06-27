import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VaultFile } from "../walker.js";
import type { SyncPlan } from "../manifest.js";
import type { IngestFileResult } from "../../ingestion/types.js";

vi.mock("../walker.js", () => ({ walkVault: vi.fn() }));
vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
  computeSyncPlan: vi.fn(),
  EMPTY_MANIFEST: { last_run: null, files: {} },
}));
vi.mock("../../ingestion/index.js", () => ({ ingestFile: vi.fn() }));
vi.mock("../../ingestion/cleanup.js", () => ({ deleteBySource: vi.fn() }));

function makeFile(rel: string, mtime = 1000): VaultFile {
  return { relativePath: rel, absolutePath: `/vault/${rel}`, mtimeMs: mtime };
}

function makeIngestResult(
  path: string,
  status: "ingested" | "skipped" | "failed" = "ingested",
  chunks = 3
): IngestFileResult {
  return {
    filePath: path,
    status,
    chunkCount: chunks,
    failedChunks: 0,
    skippedDuplicates: 0,
  };
}

describe("syncVaultIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingests new and changed files, deletes removed files", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { deleteBySource } = await import("../../ingestion/cleanup.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const newFile = makeFile("new.md", 100);
    const changedFile = makeFile("changed.md", 200);

    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([
      newFile,
      changedFile,
    ]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: null,
      files: {
        "changed.md": { mtime_ms: 100 },
        "deleted.md": { mtime_ms: 50 },
      },
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [newFile],
      changedFiles: [changedFile],
      deletedPaths: ["deleted.md"],
      unchangedPaths: [],
    } satisfies SyncPlan);
    (ingestFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeIngestResult("/vault/new.md"))
      .mockResolvedValueOnce(makeIngestResult("/vault/changed.md"));
    (deleteBySource as ReturnType<typeof vi.fn>).mockResolvedValue({
      capturesDeleted: 4,
    });
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    expect(result.newCount).toBe(1);
    expect(result.changedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(ingestFile).toHaveBeenCalledTimes(2);
    expect(deleteBySource).toHaveBeenCalledWith("/vault/deleted.md");
    expect(saveManifest).toHaveBeenCalledTimes(1);
  });

  it("skips writes in dry-run mode", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { deleteBySource } = await import("../../ingestion/cleanup.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const newFile = makeFile("new.md");
    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([newFile]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: null,
      files: {},
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [newFile],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: true,
      force: false,
      verbose: false,
    });

    expect(result.newCount).toBe(1);
    expect(ingestFile).not.toHaveBeenCalled();
    expect(deleteBySource).not.toHaveBeenCalled();
    expect(saveManifest).not.toHaveBeenCalled();
  });

  it("uses empty manifest and calls deleteBySource before ingest on --force", async () => {
    const { walkVault } = await import("../walker.js");
    const { saveManifest, computeSyncPlan } = await import("../manifest.js");
    const { ingestFile } = await import("../../ingestion/index.js");
    const { deleteBySource } = await import("../../ingestion/cleanup.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const file = makeFile("existing.md", 100);
    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([file]);
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [file],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });
    (deleteBySource as ReturnType<typeof vi.fn>).mockResolvedValue({
      capturesDeleted: 2,
    });
    (ingestFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeIngestResult("/vault/existing.md")
    );
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: true,
      verbose: false,
    });

    expect(result.newCount).toBe(1);
    expect(deleteBySource).toHaveBeenCalledWith("/vault/existing.md");
    expect(ingestFile).toHaveBeenCalledWith("/vault/existing.md");
  });

  it("tracks failures without stopping", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const good = makeFile("good.md");
    const bad = makeFile("bad.md");
    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([good, bad]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: null,
      files: {},
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [good, bad],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });
    (ingestFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeIngestResult("/vault/good.md"))
      .mockRejectedValueOnce(new Error("API timeout"));
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    expect(result.failedCount).toBe(1);
    expect(result.newCount).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe("bad.md");
  });

  it("does not advance last_run when any file fails (preserves prior value)", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const good = makeFile("good.md");
    const bad = makeFile("bad.md");
    const priorLastRun = "2026-05-20T10:00:00.000Z";

    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([good, bad]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: priorLastRun,
      files: {},
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [good, bad],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });
    (ingestFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeIngestResult("/vault/good.md"))
      .mockRejectedValueOnce(new Error("API timeout"));
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    const savedManifest = (saveManifest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(savedManifest.last_run).toBe(priorLastRun);
    // Per-file mtime for the successful file should still be recorded so
    // the next run can skip it; only the top-level freshness signal stays put.
    expect(savedManifest.files["good.md"]).toEqual({ mtime_ms: good.mtimeMs });
    expect(savedManifest.files["bad.md"]).toBeUndefined();
  });

  it("advances last_run on a clean run", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const good = makeFile("good.md");
    const priorLastRun = "2026-05-20T10:00:00.000Z";

    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([good]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: priorLastRun,
      files: {},
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [good],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });
    (ingestFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeIngestResult("/vault/good.md")
    );
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    const savedManifest = (saveManifest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(savedManifest.last_run).not.toBe(priorLastRun);
    expect(savedManifest.last_run).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("counts a resolved status:failed ingest as a failure, not a success", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { ingestFile } = await import("../../ingestion/index.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    const bad = makeFile("bad.md");
    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([bad]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: null,
      files: {},
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [bad],
      changedFiles: [],
      deletedPaths: [],
      unchangedPaths: [],
    });
    // ingestFile resolves (does not throw) with status "failed"
    (ingestFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      filePath: "/vault/bad.md",
      status: "failed",
      chunkCount: 2,
      failedChunks: 2,
      skippedDuplicates: 0,
      error: "all chunks failed",
    });
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    expect(result.failedCount).toBe(1);
    expect(result.newCount).toBe(0);
    expect(result.failures[0].path).toBe("bad.md");
    // mtime NOT recorded -> retried next run
    const saved = (saveManifest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(saved.files["bad.md"]).toBeUndefined();
  });

  it("retains the manifest entry when a deletion throws, so it retries next run", async () => {
    const { walkVault } = await import("../walker.js");
    const { loadManifest, saveManifest, computeSyncPlan } = await import(
      "../manifest.js"
    );
    const { deleteBySource } = await import("../../ingestion/cleanup.js");
    const { syncVaultIndex } = await import("../orchestrator.js");

    (walkVault as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (loadManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
      last_run: null,
      files: { "gone.md": { mtime_ms: 50 } },
    });
    (computeSyncPlan as ReturnType<typeof vi.fn>).mockReturnValue({
      newFiles: [],
      changedFiles: [],
      deletedPaths: ["gone.md"],
      unchangedPaths: [],
    });
    (deleteBySource as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB down")
    );
    (saveManifest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncVaultIndex({
      vaultRoot: "/vault",
      include: ["**"],
      exclude: [],
      extensions: [".md"],
      dryRun: false,
      force: false,
      verbose: false,
    });

    expect(result.failedCount).toBe(1);
    expect(result.failures[0].path).toBe("gone.md");
    const saved = (saveManifest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // entry retained so next run still sees it as a pending deletion
    expect(saved.files["gone.md"]).toEqual({ mtime_ms: 50 });
  });
});
