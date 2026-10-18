import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import { loadConfig } from "../config.js";
import { validDomain } from "../types.js";
import { canonicalizePeople } from "../services/people.js";
import type { PoolClient } from "pg";
import type { Chunk, SourceType } from "./types.js";

export interface PreparedChunk {
  captureArgs: unknown[];
  sourceFile: string;
  contentHash: string;
  embedding: number[];
  embedderUrl: string;
  embedderModel: string;
  embedderDimensions: number;
}

// Postgres rejects 0x00 in text, so one byte fails the whole insert and, under the
// scheduled sync, fails it identically on every run. The file on disk keeps the raw byte.
const stripNul = (value: string): string => value.replace(/\0/g, "");

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
    const content = stripNul(chunk.content);
    const contentHash = hashContent(content);

    const { embedder } = loadConfig();

    // The local extractor classifies by nearest neighbours, so it needs the embedding
    // first and cannot run alongside it the way the remote call did.
    const embedding = await generateEmbedding(content);
    const metadata = await extractMetadata(content, embedding);
    // Only the extractor's guess is validated, and only for domain. An override is
    // author-set, so frontmatter `type:` may use a value outside the configured list.
    const domain = domainOverride ?? validDomain(metadata?.domain);
    const type = typeOverride ?? metadata?.type ?? null;

    const people = canonicalizePeople(metadata?.people);
    const peopleArg = people.length > 0 ? people : null;

    const section = chunk.metadata.heading ?? chunk.metadata.sourceLabel ?? null;
    const captureArgs = [
      content,
      type,
      domain,
      metadata?.topics ?? null,
      peopleArg,
      metadata?.action_items ?? null,
      metadata?.dates ? JSON.stringify(metadata.dates) : null,
      sourcePath,
      section === null ? null : stripNul(section),
      sourceType,
      chunk.index,
      contentHash,
    ];

    return {
      captureArgs,
      sourceFile: sourcePath,
      contentHash,
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

// PERSIST: the INSERTs on the transaction client. DB errors propagate so the
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

  const inserted = Boolean(captureResult.rowCount && captureResult.rowCount > 0);
  if (inserted) {
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
  }
  // A duplicate's capture belongs to another file; the link is what keeps it findable
  // from this one after that file changes.
  await client.query(
    `INSERT INTO capture_sources (capture_id, source_file)
     SELECT id, $2 FROM captures WHERE content_hash = $1
     ON CONFLICT DO NOTHING`,
    [prepared.contentHash, prepared.sourceFile]
  );
  return inserted ? "inserted" : "duplicate";
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
