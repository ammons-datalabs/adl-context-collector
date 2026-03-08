import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";

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

  const domain = args.domain ?? metadata.domain;
  const captureType = args.type ?? metadata.type;

  const result = await query(
    `INSERT INTO captures (content, embedding, type, domain, topics, people, action_items, dates, source_type, content_hash)
     VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, 'claude_capture', $9)
     RETURNING id, captured_at`,
    [
      args.content,
      JSON.stringify(embedding),
      captureType,
      domain,
      metadata.topics,
      metadata.people,
      metadata.action_items,
      JSON.stringify(metadata.dates),
      contentHash,
    ]
  );

  const row = result.rows[0];
  return {
    content: [
      {
        type: "text" as const,
        text: `Saved capture #${row.id} at ${row.captured_at}\nDomain: ${domain} | Type: ${captureType}\nTopics: ${metadata.topics.join(", ") || "none"}\nPeople: ${metadata.people.join(", ") || "none"}${metadata.action_items.length > 0 ? `\nAction items: ${metadata.action_items.join("; ")}` : ""}`,
      },
    ],
  };
}
