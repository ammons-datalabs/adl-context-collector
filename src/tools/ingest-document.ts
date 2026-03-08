import { stat } from "fs/promises";
import { ingestFile, ingestDirectory } from "../ingestion/index.js";
import type { IngestOptions } from "../ingestion/types.js";

export async function ingestDocument(args: {
  path: string;
  domain?: string;
  recursive?: boolean;
  dry_run?: boolean;
}) {
  const options: IngestOptions = {
    domain: args.domain,
    recursive: args.recursive ?? false,
    dryRun: args.dry_run ?? false,
  };

  let fileStat;
  try {
    fileStat = await stat(args.path);
  } catch {
    return {
      content: [
        { type: "text" as const, text: `File not found: ${args.path}` },
      ],
    };
  }

  if (fileStat.isFile()) {
    const result = await ingestFile(args.path, options);
    const prefix = options.dryRun ? "[DRY RUN] " : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `${prefix}${result.status}: ${result.filePath}\nChunks: ${result.chunkCount}${result.failedChunks > 0 ? ` (${result.failedChunks} failed)` : ""}${result.skippedDuplicates > 0 ? ` (${result.skippedDuplicates} duplicate)` : ""}${result.error ? `\nError: ${result.error}` : ""}`,
        },
      ],
    };
  }

  if (fileStat.isDirectory()) {
    const result = await ingestDirectory(args.path, options);
    const prefix = options.dryRun ? "[DRY RUN] " : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `${prefix}Ingested directory: ${args.path}\nFiles: ${result.ingested} ingested, ${result.skipped} skipped, ${result.failed} failed\nTotal chunks: ${result.totalChunks}${result.fileResults.filter((f) => f.failedChunks > 0).length > 0 ? `\n\nPartial failures:\n${result.fileResults.filter((f) => f.failedChunks > 0).map((f) => `  ${f.filePath}: ${f.failedChunks}/${f.chunkCount} chunks failed`).join("\n")}` : ""}`,
        },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Not a file or directory: ${args.path}` },
    ],
  };
}
