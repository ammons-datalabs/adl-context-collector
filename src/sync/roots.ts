import { resolve } from "path";
import type { CollectorConfig } from "../config.js";
import { syncVaultIndex, type SyncResult } from "./orchestrator.js";

export interface RootSpec {
  vaultRoot: string;
  include: string[];
  exclude: string[];
  extensions: string[];
}

const DEFAULT_INCLUDE = ["**"];
const DEFAULT_EXCLUDE: string[] = [];
const DEFAULT_EXTENSIONS = [".md", ".pdf", ".txt"];

export function resolveRoots(config: CollectorConfig): RootSpec[] {
  if (!config.vaultRoot) {
    throw new Error("config must specify vaultRoot");
  }
  const main: RootSpec = {
    vaultRoot: resolve(config.vaultRoot),
    include: config.indexSync?.include ?? DEFAULT_INCLUDE,
    exclude: config.indexSync?.exclude ?? DEFAULT_EXCLUDE,
    extensions: config.indexSync?.extensions ?? DEFAULT_EXTENSIONS,
  };
  const extra: RootSpec[] = (config.additionalRoots ?? []).map((r) => ({
    vaultRoot: resolve(r.root),
    include: r.include ?? DEFAULT_INCLUDE,
    exclude: r.exclude ?? DEFAULT_EXCLUDE,
    extensions: r.extensions ?? DEFAULT_EXTENSIONS,
  }));
  return [main, ...extra];
}

export interface MultiSyncFlags {
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

export async function syncAllRoots(
  roots: RootSpec[],
  flags: MultiSyncFlags,
  onProgress?: (message: string) => void
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const root of roots) {
    onProgress?.(`\n=== Root: ${root.vaultRoot} ===`);
    try {
      results.push(await syncVaultIndex({ ...root, ...flags }, onProgress));
    } catch (err) {
      // A root-level failure (e.g. an unreadable or missing directory) must not
      // abort the remaining roots. Record it as a failed SyncResult so the
      // aggregate summary and exit code surface it, then carry on.
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.(`[error] root ${root.vaultRoot} → ${message}`);
      results.push({
        scanned: 0,
        newCount: 0,
        changedCount: 0,
        deletedCount: 0,
        unchangedCount: 0,
        failedCount: 1,
        failures: [{ path: root.vaultRoot, error: message }],
      });
    }
  }
  return results;
}
