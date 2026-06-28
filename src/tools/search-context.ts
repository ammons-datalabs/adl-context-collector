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
  const factLimit = 5;
  const minSim = args.min_similarity ?? 0.3;
  const { embedder } = loadConfig();
  const dims = embedder.dimensions;

  const embedding = await generateEmbedding(args.query);
  const vec = JSON.stringify(embedding);

  // Dimensions are interpolated into the cast (not parameterizable in SQL).
  // Safe: dims is always an integer from config.

  // Current facts, vector-ranked. to_char keeps as_of a clean YYYY-MM-DD string
  // (avoids node-pg returning a timezone-shifted Date).
  const factResult = await query(
    `SELECT f.domain, f.category, f.key, f.value, f.context,
            to_char(f.as_of, 'YYYY-MM-DD') AS as_of,
            1 - (fe.embedding::vector(${dims}) <=> $1::vector(${dims})) AS similarity
     FROM facts f
     JOIN fact_embeddings fe ON fe.fact_id = f.id
     WHERE fe.provider_url = $2
       AND fe.model = $3
       AND f.valid_until IS NULL
       AND ($4::text IS NULL OR f.domain = $4)
       AND 1 - (fe.embedding::vector(${dims}) <=> $1::vector(${dims})) >= $5
     ORDER BY fe.embedding::vector(${dims}) <=> $1::vector(${dims})
     LIMIT $6`,
    [vec, embedder.url, embedder.model, args.domain ?? null, minSim, factLimit]
  );

  const captureResult = await query(
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
    [vec, embedder.url, embedder.model, args.domain ?? null, minSim, limit]
  );

  const sections: string[] = [];

  if (factResult.rows.length > 0) {
    const factText = factResult.rows
      .map(
        (r: Record<string, unknown>, i: number) =>
          `${i + 1}. [${r.domain}/${r.category}] ${r.key} = ${r.value}  ` +
          `(as of ${r.as_of} · ${(Number(r.similarity) * 100).toFixed(1)}% match)` +
          (r.context ? `\n   ${r.context}` : "")
      )
      .join("\n");
    sections.push(`**Facts** (current)\n${factText}`);
  }

  if (captureResult.rows.length > 0) {
    const captureText = captureResult.rows
      .map(
        (r: Record<string, unknown>, i: number) =>
          `**${i + 1}. [${r.domain}/${r.type}] (${(Number(r.similarity) * 100).toFixed(1)}% match)**\n` +
          `${r.content}\n` +
          `_Topics: ${(r.topics as string[])?.join(", ") || "none"} | People: ${(r.people as string[])?.join(", ") || "none"} | Source: ${r.source_file || "capture"}_`
      )
      .join("\n\n---\n\n");
    sections.push(`**Captures**\n${captureText}`);
  }

  if (sections.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No matching captures or facts found." }],
    };
  }

  return { content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }] };
}
