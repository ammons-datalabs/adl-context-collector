import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { loadConfig } from "../config.js";

export async function searchContext(args: {
  query: string;
  domain?: string;
  limit?: number;
  min_similarity?: number;
}) {
  const limit = Math.min(args.limit ?? 5, 20);
  const minSim = args.min_similarity ?? 0.3;
  const { embedder } = loadConfig();
  const dims = embedder.dimensions;

  const embedding = await generateEmbedding(args.query);

  // Dimensions are interpolated into the cast (not parameterizable in SQL).
  // This is safe: dims is always an integer from config.
  const result = await query(
    `SELECT c.id, c.content, c.type, c.domain, c.topics, c.people,
            c.source_file, c.content_date,
            1 - (ce.embedding::vector(${dims}) <=> $1::vector(${dims})) AS similarity
     FROM captures c
     JOIN capture_embeddings ce ON ce.capture_id = c.id
     WHERE ce.provider_url = $2
       AND ce.model = $3
       AND ($4::text IS NULL OR c.domain = $4)
       AND 1 - (ce.embedding::vector(${dims}) <=> $1::vector(${dims})) >= $5
     ORDER BY ce.embedding::vector(${dims}) <=> $1::vector(${dims})
     LIMIT $6`,
    [
      JSON.stringify(embedding),
      embedder.url,
      embedder.model,
      args.domain ?? null,
      minSim,
      limit,
    ]
  );

  if (result.rows.length === 0) {
    return { content: [{ type: "text" as const, text: "No matching captures found." }] };
  }

  const text = result.rows
    .map(
      (r: Record<string, unknown>, i: number) =>
        `**${i + 1}. [${r.domain}/${r.type}] (${(Number(r.similarity) * 100).toFixed(1)}% match)**\n` +
        `${r.content}\n` +
        `_Topics: ${(r.topics as string[])?.join(", ") || "none"} | People: ${(r.people as string[])?.join(", ") || "none"} | Source: ${r.source_file || "capture"}_`
    )
    .join("\n\n---\n\n");

  return { content: [{ type: "text" as const, text }] };
}
