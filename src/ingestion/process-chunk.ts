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
  // A row this file already owns is refreshed; one another file owns keeps that owner's metadata.
  const captureResult = await client.query(
    `INSERT INTO captures
      (content, type, domain, topics, people, action_items, dates,
       source_file, source_section, source_type, chunk_index, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (content_hash) DO UPDATE SET
       type = EXCLUDED.type, domain = EXCLUDED.domain, topics = EXCLUDED.topics,
       people = EXCLUDED.people, action_items = EXCLUDED.action_items, dates = EXCLUDED.dates,
       source_section = EXCLUDED.source_section, source_type = EXCLUDED.source_type,
       chunk_index = EXCLUDED.chunk_index
     WHERE captures.source_file = EXCLUDED.source_file
     RETURNING id`,
    prepared.captureArgs
  );

  const owned = Boolean(captureResult.rowCount && captureResult.rowCount > 0);
  if (owned) {
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
  // Every chunk links its file, owned or not: release dropped this file's links, and a
  // duplicate's link is what keeps it findable after its owner changes.
  await client.query(
    `INSERT INTO capture_sources (capture_id, source_file)
     SELECT id, $2 FROM captures WHERE content_hash = $1
     ON CONFLICT DO NOTHING`,
    [prepared.contentHash, prepared.sourceFile]
  );
  return owned ? "inserted" : "duplicate";
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
): Promise<{ duplicates: number; linked: number }> {
  let duplicates = 0;
  const linked = new Set<string>();
  for (const p of prepared) {
    // A repeat within this file would refresh the row its first occurrence just wrote.
    if (linked.has(p.contentHash) || (await persistChunk(client, p)) === "duplicate") duplicates++;
    linked.add(p.contentHash);
  }
  return { duplicates, linked: linked.size };
}
