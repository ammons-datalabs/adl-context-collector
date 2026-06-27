import { resolve } from "path";
import { walkVault } from "./walker.js";
import {
  loadManifest,
  saveManifest,
  computeSyncPlan,
  EMPTY_MANIFEST,
  type Manifest,
} from "./manifest.js";
import { ingestFile } from "../ingestion/index.js";
import { deleteBySource } from "../ingestion/cleanup.js";
import type { VaultFile } from "./walker.js";

export interface SyncOptions {
  vaultRoot: string;
  include: string[];
  exclude: string[];
  extensions: string[];
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

export interface SyncResult {
  scanned: number;
  newCount: number;
  changedCount: number;
  deletedCount: number;
  unchangedCount: number;
  failedCount: number;
  failures: Array<{ path: string; error: string }>;
}

export async function syncVaultIndex(
  options: SyncOptions,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  const absRoot = resolve(options.vaultRoot);

  // 1. Walk vault
  const files = await walkVault(absRoot, {
    include: options.include,
    exclude: options.exclude,
    extensions: options.extensions,
  });
  onProgress?.(`Scanning... ${files.length} eligible files found`);

  // 2. Load manifest (skip on --force)
  const manifest = options.force
    ? EMPTY_MANIFEST
    : await loadManifest(absRoot);

  // 3. Compute sync plan
  const plan = computeSyncPlan(files, manifest);

  onProgress?.(
    `  ${plan.newFiles.length} new, ${plan.changedFiles.length} changed, ` +
    `${plan.deletedPaths.length} deleted, ${plan.unchangedPaths.length} unchanged`
  );

  if (options.dryRun) {
    return {
      scanned: files.length,
      newCount: plan.newFiles.length,
      changedCount: plan.changedFiles.length,
      deletedCount: plan.deletedPaths.length,
      unchangedCount: plan.unchangedPaths.length,
      failedCount: 0,
      failures: [],
    };
  }

  // 4. Process files
  const result: SyncResult = {
    scanned: files.length,
    newCount: 0,
    changedCount: 0,
    deletedCount: 0,
    unchangedCount: plan.unchangedPaths.length,
    failedCount: 0,
    failures: [],
  };

  // Build updated manifest from unchanged files
  const updatedFiles: Record<string, { mtime_ms: number }> = {};
  for (const relPath of plan.unchangedPaths) {
    updatedFiles[relPath] = manifest.files[relPath];
  }

  // Process new files
  for (const file of plan.newFiles) {
    await processFile(file, "new", options, result, updatedFiles, onProgress);
  }

  // Process changed files
  for (const file of plan.changedFiles) {
    await processFile(file, "changed", options, result, updatedFiles, onProgress);
  }

  // Delete removed files
  for (const relPath of plan.deletedPaths) {
    const absPath = resolve(absRoot, relPath);
    try {
      const delResult = await deleteBySource(absPath);
      result.deletedCount++;
      onProgress?.(`[deleted] ${relPath} → removed ${delResult.capturesDeleted} chunks`);
    } catch (err) {
      result.failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      result.failures.push({ path: relPath, error: msg });
      onProgress?.(`[error] ${relPath} → ${msg}`);
    }
  }

  // 5. Save updated manifest. Per-file mtimes always reflect the latest
  // successes so the next run can skip them; but last_run is the freshness
  // signal consumers (e.g. dashboards) use to decide "is the index current."
  // A run with failures hasn't actually achieved "everything indexed," so
  // last_run is preserved at its prior value until a clean run lands.
  await saveManifest(absRoot, {
    last_run:
      result.failedCount === 0 ? new Date().toISOString() : manifest.last_run,
    files: updatedFiles,
  });

  return result;
}

async function processFile(
  file: VaultFile,
  label: "new" | "changed",
  options: SyncOptions,
  result: SyncResult,
  updatedFiles: Record<string, { mtime_ms: number }>,
  onProgress?: (message: string) => void
): Promise<void> {
  try {
    // On --force, clean up existing data first
    if (options.force) {
      await deleteBySource(file.absolutePath);
    }

    const ingestResult = await ingestFile(file.absolutePath);

    if (label === "new") result.newCount++;
    else result.changedCount++;

    // Only update manifest for successful files
    updatedFiles[file.relativePath] = { mtime_ms: file.mtimeMs };

    onProgress?.(
      `[${label}] ${file.relativePath} → ${ingestResult.chunkCount} chunks` +
      (ingestResult.status === "skipped" ? " (unchanged content)" : "")
    );
  } catch (err) {
    result.failedCount++;
    const msg = err instanceof Error ? err.message : String(err);
    result.failures.push({ path: file.relativePath, error: msg });
    onProgress?.(`[error] ${file.relativePath} → ${msg}`);
    // Do NOT add to updatedFiles — will be retried next run
  }
}
