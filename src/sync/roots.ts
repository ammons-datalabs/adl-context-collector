import { resolve } from "path";
import type { CollectorConfig } from "../config.js";

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
