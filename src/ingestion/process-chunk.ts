import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import { loadConfig } from "../config.js";
import { canonicalizePeople } from "../services/people.js";
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

    const { embedder } = loadConfig();
    const domain = domainOverride ?? metadata?.domain ?? null;

    const people = canonicalizePeople(metadata?.people);
    const peopleArg = people.length > 0 ? people : null;

    const captureResult = await query(
      `INSERT INTO captures
        (content, type, domain, topics, people, action_items, dates,
         source_file, source_section, source_type, chunk_index, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id`,
      [
        chunk.content,
        metadata?.type ?? null,
        domain,
        metadata?.topics ?? null,
        peopleArg,
        metadata?.action_items ?? null,
        metadata?.dates ? JSON.stringify(metadata.dates) : null,
        sourcePath,
        chunk.metadata.heading ?? chunk.metadata.sourceLabel ?? null,
        sourceType,
        chunk.index,
        contentHash,
      ]
    );

    if (captureResult.rowCount && captureResult.rowCount > 0) {
      const captureId = captureResult.rows[0].id;
      await query(
        `INSERT INTO capture_embeddings (capture_id, provider_url, model, dimensions, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (capture_id, provider_url, model) DO NOTHING`,
        [captureId, embedder.url, embedder.model, embedder.dimensions, JSON.stringify(embedding)]
      );
      return "inserted";
    }
    return "duplicate";
  } catch (err) {
    console.error("processChunk failed:", err);
    return "failed";
  }
}

/**
 * Process chunks with bounded concurrency.
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
