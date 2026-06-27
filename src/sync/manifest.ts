import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { VaultFile } from "./walker.js";

const MANIFEST_FILENAME = ".vault-index-manifest.json";

export interface ManifestEntry {
  mtime_ms: number;
}

export interface Manifest {
  last_run: string | null;
  files: Record<string, ManifestEntry>;
}

export const EMPTY_MANIFEST: Manifest = { last_run: null, files: {} };

export async function loadManifest(vaultRoot: string): Promise<Manifest> {
  const manifestPath = join(vaultRoot, MANIFEST_FILENAME);
  try {
    const raw = await readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...EMPTY_MANIFEST, files: {} };
    }
    throw err;
  }
}

export async function saveManifest(
  vaultRoot: string,
  manifest: Manifest
): Promise<void> {
  const manifestPath = join(vaultRoot, MANIFEST_FILENAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export interface SyncPlan {
  newFiles: VaultFile[];
  changedFiles: VaultFile[];
  deletedPaths: string[];
  unchangedPaths: string[];
}

export function computeSyncPlan(
  currentFiles: VaultFile[],
  manifest: Manifest
): SyncPlan {
  const newFiles: VaultFile[] = [];
  const changedFiles: VaultFile[] = [];
  const unchangedPaths: string[] = [];
  const manifestKeys = new Set(Object.keys(manifest.files));

  for (const file of currentFiles) {
    const entry = manifest.files[file.relativePath];
    if (!entry) {
      newFiles.push(file);
    } else if (file.mtimeMs !== entry.mtime_ms) {
      changedFiles.push(file);
    } else {
      unchangedPaths.push(file.relativePath);
    }
    manifestKeys.delete(file.relativePath);
  }

  return {
    newFiles,
    changedFiles,
    deletedPaths: [...manifestKeys],
    unchangedPaths,
  };
}
