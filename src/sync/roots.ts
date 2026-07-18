import { resolve, sep } from "path";
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

// True when a and b are the same directory or one contains the other. Per-root
// manifests + absolute-path DB keys only isolate roots that are disjoint; a
// shared file under two roots can be deleted by one while the other still marks
// it indexed, so overlapping roots are rejected up front.
function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const aa = a.endsWith(sep) ? a : a + sep;
  const bb = b.endsWith(sep) ? b : b + sep;
  return aa.startsWith(bb) || bb.startsWith(aa);
}

export function resolveRoots(config: CollectorConfig): RootSpec[] {
  if (!config.vaultRoot || !config.vaultRoot.trim()) {
    throw new Error("config must specify a non-empty vaultRoot");
  }
  const additional = config.additionalRoots ?? [];
  if (!Array.isArray(additional)) {
    throw new Error("config additionalRoots must be an array");
  }
  const main: RootSpec = {
    vaultRoot: resolve(config.vaultRoot),
    include: config.indexSync?.include ?? DEFAULT_INCLUDE,
    exclude: config.indexSync?.exclude ?? DEFAULT_EXCLUDE,
    extensions: config.indexSync?.extensions ?? DEFAULT_EXTENSIONS,
  };
  const extra: RootSpec[] = additional.map((r) => {
    if (!r.root || !r.root.trim()) {
      throw new Error("each additionalRoots entry must have a non-empty root path");
    }
    return {
      vaultRoot: resolve(r.root),
      include: r.include ?? DEFAULT_INCLUDE,
      exclude: r.exclude ?? DEFAULT_EXCLUDE,
      extensions: r.extensions ?? DEFAULT_EXTENSIONS,
    };
  });
  const specs = [main, ...extra];
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      if (overlaps(specs[i].vaultRoot, specs[j].vaultRoot)) {
        throw new Error(
          `index roots must be disjoint: "${specs[i].vaultRoot}" overlaps "${specs[j].vaultRoot}"`
        );
      }
    }
  }
  return specs;
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
