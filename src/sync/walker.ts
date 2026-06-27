import { readdir, stat } from "fs/promises";
import { resolve, extname } from "path";
import picomatch from "picomatch";

export interface VaultFile {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
}

export interface WalkOptions {
  include: string[];
  exclude: string[];
  extensions: string[];
}

export async function walkVault(
  vaultRoot: string,
  options: WalkOptions
): Promise<VaultFile[]> {
  const absRoot = resolve(vaultRoot);

  const includeGlobs = options.include.map((p) =>
    p === "**" ? "**" : p + "/**"
  );
  const excludeGlobs = [
    ...options.exclude.map((p) => p + "/**"),
    "**/node_modules/**",
  ];

  const includeMatchers = includeGlobs.map((g) => picomatch(g));
  const excludeMatchers = excludeGlobs.map((g) => picomatch(g));

  const extSet = new Set(options.extensions.map((e) => e.toLowerCase()));

  const entries = await readdir(absRoot, { recursive: true });
  const files: VaultFile[] = [];

  for (const entry of entries) {
    const relPath = entry.toString();

    // Skip dotfile/dotdir paths (any segment starting with '.')
    if (relPath.split("/").some((seg) => seg.startsWith("."))) continue;

    // Extension filter
    if (!extSet.has(extname(relPath).toLowerCase())) continue;

    // Exclude filter
    if (excludeMatchers.some((m) => m(relPath))) continue;

    // Include filter
    if (!includeMatchers.some((m) => m(relPath))) continue;

    const absPath = resolve(absRoot, relPath);
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) continue;

    files.push({
      relativePath: relPath,
      absolutePath: absPath,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  return files;
}
