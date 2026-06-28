import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import { loadConfig } from "../config.js";
import { canonicalizePeople } from "../services/people.js";
import type { PoolClient } from "pg";
import type { Chunk, SourceType } from "./types.js";

export interface PreparedChunk {
  captureArgs: unknown[];
  embedding: number[];
  embedderUrl: string;
  embedderModel: string;
  embedderDimensions: number;
}

// PREPARE: embedding + metadata + arg arrays. No SQL. A failure here is a soft,
// skippable failure (the transaction never sees it).
export async function prepareChunk(
  chunk: Chunk,
  sourcePath: string,
  sourceType: SourceType,
  domainOverride?: string,
  typeOverride?: string
): Promise<PreparedChunk | null> {
  try {
    const contentHash = hashContent(chunk.content);

    const [embedding, metadata] = await Promise.all([
      generateEmbedding(chunk.content),
      extractMetadata(chunk.content),
    ]);

    const { embedder } = loadConfig();
    const domain = domainOverride ?? metadata?.domain ?? null;
    const type = typeOverride ?? metadata?.type ?? null;

    const people = canonicalizePeople(metadata?.people);
    const peopleArg = people.length > 0 ? people : null;

    const captureArgs = [
      chunk.content,
      type,
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
    ];

    return {
      captureArgs,
      embedding,
      embedderUrl: embedder.url,
      embedderModel: embedder.model,
      embedderDimensions: embedder.dimensions,
    };
  } catch (err) {
    console.error("prepareChunk failed:", err);
    return null;
  }
}

// PERSIST: the two INSERTs on the transaction client. DB errors propagate so the
// transaction rolls back.
export async function persistChunk(
  client: PoolClient,
  prepared: PreparedChunk
): Promise<"inserted" | "duplicate"> {
  const captureResult = await client.query(
    `INSERT INTO captures
      (content, type, domain, topics, people, action_items, dates,
       source_file, source_section, source_type, chunk_index, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (content_hash) DO NOTHING
     RETURNING id`,
    prepared.captureArgs
  );

  if (captureResult.rowCount && captureResult.rowCount > 0) {
    const captureId = captureResult.rows[0].id;
    await client.query(
      `INSERT INTO capture_embeddings (capture_id, provider_url, model, dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (capture_id, provider_url, model) DO NOTHING`,
      [
        captureId,
        prepared.embedderUrl,
        prepared.embedderModel,
        prepared.embedderDimensions,
        JSON.stringify(prepared.embedding),
      ]
    );
    return "inserted";
  }
  return "duplicate";
}

// Concurrent prepare (embedding/metadata + arg arrays). No client, no SQL.
export async function prepareChunks(
  chunks: Chunk[],
  sourcePath: string,
  sourceType: SourceType,
  domainOverride?: string,
  typeOverride?: string,
  concurrency = 5
): Promise<{ prepared: PreparedChunk[]; failed: number }> {
  let failed = 0;
  const prepared: PreparedChunk[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((chunk) =>
        prepareChunk(chunk, sourcePath, sourceType, domainOverride, typeOverride)
      )
    );
    for (const r of results) {
      if (r === null) failed++;
      else prepared.push(r);
    }
  }
  return { prepared, failed };
}

// Sequential persist on the transaction client. DB errors propagate.
export async function persistChunks(
  client: PoolClient,
  prepared: PreparedChunk[]
): Promise<{ duplicates: number }> {
  let duplicates = 0;
  for (const p of prepared) {
    const outcome = await persistChunk(client, p);
    if (outcome === "duplicate") duplicates++;
  }
  return { duplicates };
}
