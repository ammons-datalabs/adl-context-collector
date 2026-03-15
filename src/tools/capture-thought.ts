import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import { loadConfig } from "../config.js";
import { SOURCE_TYPES } from "../ingestion/types.js";

export async function captureThought(args: {
  content: string;
  domain?: string;
  type?: string;
}) {
  const contentHash = hashContent(args.content);

  // Check for duplicate
  const existing = await query(
    "SELECT id FROM captures WHERE content_hash = $1",
    [contentHash]
  );
  if (existing.rows.length > 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `This thought already exists (capture #${existing.rows[0].id}). Skipped.`,
        },
      ],
    };
  }

  // Generate embedding and extract metadata in parallel
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(args.content),
    extractMetadata(args.content),
  ]);

  const domain = args.domain ?? metadata?.domain ?? "general";
  const captureType = args.type ?? metadata?.type ?? "thought";

  const { embedder } = loadConfig();

  await query("BEGIN");
  try {
    const result = await query(
      `INSERT INTO captures (content, type, domain, topics, people, action_items, dates, source_type, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, captured_at`,
      [
        args.content,
        captureType,
        domain,
        metadata?.topics ?? [],
        metadata?.people ?? [],
        metadata?.action_items ?? [],
        metadata?.dates ? JSON.stringify(metadata.dates) : "{}",
        SOURCE_TYPES.CLAUDE_CAPTURE,
        contentHash,
      ]
    );

    const row = result.rows[0];
    await query(
      `INSERT INTO capture_embeddings (capture_id, provider_url, model, dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [row.id, embedder.url, embedder.model, embedder.dimensions, JSON.stringify(embedding)]
    );
    await query("COMMIT");

    const topics = metadata?.topics ?? [];
    const people = metadata?.people ?? [];
    const actionItems = metadata?.action_items ?? [];
    return {
      content: [
        {
          type: "text" as const,
          text: `Saved capture #${row.id} at ${row.captured_at}\nDomain: ${domain} | Type: ${captureType}\nTopics: ${topics.join(", ") || "none"}\nPeople: ${people.join(", ") || "none"}${actionItems.length > 0 ? `\nAction items: ${actionItems.join("; ")}` : ""}`,
        },
      ],
    };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
