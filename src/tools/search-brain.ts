import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";

export async function searchBrain(args: {
  query: string;
  domain?: string;
  limit?: number;
  min_similarity?: number;
}) {
  const limit = Math.min(args.limit ?? 5, 20);
  const minSim = args.min_similarity ?? 0.3;

  const embedding = await generateEmbedding(args.query);

  const result = await query(
    `SELECT id, content, type, domain, topics, people, source_file, content_date,
            1 - (embedding <=> $1::vector) AS similarity
     FROM captures
     WHERE ($2::text IS NULL OR domain = $2)
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [JSON.stringify(embedding), args.domain ?? null, minSim, limit]
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
