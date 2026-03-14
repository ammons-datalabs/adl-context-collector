import { readFile, readdir } from "fs/promises";
import { join, basename, resolve } from "path";
import { createHash } from "crypto";
import { query } from "../db.js";
import { chunkMarkdown } from "./chunkers/markdown.js";
import { chunkText } from "./chunkers/text.js";
import { chunkPdfPages } from "./chunkers/pdf.js";
import { readPdf } from "./parsers/pdf-reader.js";
import { processChunksBatch } from "./process-chunk.js";
import {
  detectFormat,
  SOURCE_TYPES,
  type Chunk,
  type IngestOptions,
  type IngestFileResult,
  type IngestDirectoryResult,
  type SupportedFormat,
  type SourceType,
} from "./types.js";

async function hashFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

const FORMAT_TO_SOURCE_TYPE: Record<SupportedFormat, SourceType> = {
  pdf: SOURCE_TYPES.PDF,
  markdown: SOURCE_TYPES.MARKDOWN,
  text: SOURCE_TYPES.TEXT,
};

async function getChunks(
  filePath: string,
  format: SupportedFormat
): Promise<Chunk[]> {
  switch (format) {
    case "markdown": {
      const content = await readFile(filePath, "utf-8");
      return chunkMarkdown(content);
    }
    case "text": {
      const content = await readFile(filePath, "utf-8");
      return chunkText(content, basename(filePath));
    }
    case "pdf": {
      const { pages } = await readPdf(filePath);
      return chunkPdfPages(pages);
    }
  }
}

export async function ingestFile(
  filePath: string,
  options: IngestOptions = {}
): Promise<IngestFileResult> {
  const absPath = resolve(filePath);
  const format = detectFormat(absPath);

  if (!format) {
    return {
      filePath: absPath,
      status: "failed",
      chunkCount: 0,
      failedChunks: 0,
      skippedDuplicates: 0,
      error: `Unsupported file type: ${absPath}`,
    };
  }

  // Hash check for re-ingestion
  const fileHash = await hashFile(absPath);
  const existing = await query(
    "SELECT file_hash FROM sources WHERE file_path = $1",
    [absPath]
  );

  if (existing.rows.length > 0 && existing.rows[0].file_hash === fileHash) {
    return {
      filePath: absPath,
      status: "skipped",
      chunkCount: 0,
      failedChunks: 0,
      skippedDuplicates: 0,
    };
  }

  // If file changed, delete old chunks
  if (existing.rows.length > 0) {
    await query("DELETE FROM captures WHERE source_file = $1", [absPath]);
  }

  if (options.dryRun) {
    const chunks = await getChunks(absPath, format);
    return {
      filePath: absPath,
      status: "ingested",
      chunkCount: chunks.length,
      failedChunks: 0,
      skippedDuplicates: 0,
    };
  }

  const chunks = await getChunks(absPath, format);
  const { failed: failedChunks, duplicates: skippedDuplicates } =
    await processChunksBatch(
      chunks,
      absPath,
      FORMAT_TO_SOURCE_TYPE[format],
      options.domain
    );

  const insertedCount = chunks.length - failedChunks - skippedDuplicates;

  // Upsert sources table
  await query(
    `INSERT INTO sources (file_path, file_hash, capture_count, last_imported)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (file_path)
     DO UPDATE SET file_hash = $2, capture_count = $3, last_imported = NOW()`,
    [absPath, fileHash, insertedCount]
  );

  return {
    filePath: absPath,
    status: failedChunks === chunks.length ? "failed" : "ingested",
    chunkCount: chunks.length,
    failedChunks,
    skippedDuplicates,
  };
}

export async function ingestDirectory(
  dirPath: string,
  options: IngestOptions = {},
  onProgress?: (message: string) => void
): Promise<IngestDirectoryResult> {
  const absDir = resolve(dirPath);
  const result: IngestDirectoryResult = {
    totalFiles: 0,
    ingested: 0,
    skipped: 0,
    failed: 0,
    totalChunks: 0,
    fileResults: [],
  };

  const entries = await readdir(absDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(absDir, entry.name);
    if (entry.isFile() && detectFormat(fullPath)) {
      files.push(fullPath);
    } else if (entry.isDirectory() && options.recursive) {
      const subResult = await ingestDirectory(fullPath, options, onProgress);
      result.totalFiles += subResult.totalFiles;
      result.ingested += subResult.ingested;
      result.skipped += subResult.skipped;
      result.failed += subResult.failed;
      result.totalChunks += subResult.totalChunks;
      result.fileResults.push(...subResult.fileResults);
    }
  }

  result.totalFiles += files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileNum = result.fileResults.length + 1;
    onProgress?.(`[${fileNum}/${result.totalFiles}] Ingesting ${basename(file)}...`);

    const fileResult = await ingestFile(file, options);
    result.fileResults.push(fileResult);

    if (fileResult.status === "ingested") {
      result.ingested++;
      result.totalChunks += fileResult.chunkCount - fileResult.failedChunks - fileResult.skippedDuplicates;
    } else if (fileResult.status === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
    }

    onProgress?.(`  → ${fileResult.status}: ${fileResult.chunkCount} chunks`);
  }

  return result;
}
