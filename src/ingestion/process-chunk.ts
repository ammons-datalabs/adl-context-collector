import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import type { Chunk, SourceType } from "./types.js";

export type ChunkResult = "inserted" | "duplicate" | "failed";

export async function processChunk(
  chunk: Chunk,
  sourcePath: string,
  sourceType: SourceType,
  domainOverride?: string
): Promise<ChunkResult> {
  try {
    const contentHash = hashContent(chunk.content);

    const [embedding, metadata] = await Promise.all([
      generateEmbedding(chunk.content),
      extractMetadata(chunk.content),
    ]);

    const domain = domainOverride ?? metadata.domain;

    const result = await query(
      `INSERT INTO captures
        (content, embedding, type, domain, topics, people, action_items, dates,
         source_file, source_section, source_type, chunk_index, content_hash)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id`,
      [
        chunk.content,
        JSON.stringify(embedding),
        metadata.type,
        domain,
        metadata.topics,
        metadata.people,
        metadata.action_items,
        JSON.stringify(metadata.dates),
        sourcePath,
        chunk.metadata.heading ?? chunk.metadata.sourceLabel ?? null,
        sourceType,
        chunk.index,
        contentHash,
      ]
    );

    return result.rowCount && result.rowCount > 0 ? "inserted" : "duplicate";
  } catch {
    return "failed";
  }
}

/**
 * Process chunks with bounded concurrency (#8).
 * Processes in batches of `concurrency` at a time.
 */
export async function processChunksBatch(
  chunks: Chunk[],
  sourcePath: string,
  sourceType: SourceType,
  domainOverride?: string,
  concurrency = 5
): Promise<{ failed: number; duplicates: number }> {
  let failed = 0;
  let duplicates = 0;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((chunk) =>
        processChunk(chunk, sourcePath, sourceType, domainOverride)
      )
    );
    for (const r of results) {
      if (r === "failed") failed++;
      if (r === "duplicate") duplicates++;
    }
  }

  return { failed, duplicates };
}
