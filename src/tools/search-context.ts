import { query, withTransaction } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { loadConfig } from "../config.js";

// The caller cannot read server config, so the description states the behaviour it will
// actually get rather than naming the setting that decides it.
export function domainArgDescription(boost: number): string {
  return boost > 0
    ? "Prefer a domain: matching captures rank higher rather than others being excluded. Facts are still filtered to it."
    : "Filter to a specific domain.";
}

export async function searchContext(args: {
  query: string;
  domain?: string;
  limit?: number;
  min_similarity?: number;
}) {
  const limit = Math.min(args.limit ?? 5, 20);
  const factLimit = 5;
  const { embedder, search } = loadConfig();
  const minSim = args.min_similarity ?? search.min_similarity;
  const dims = embedder.dimensions;

  const embedding = await generateEmbedding(args.query);
  const vec = JSON.stringify(embedding);

  // Dimensions are interpolated into the cast (not parameterizable in SQL).
  // Safe: dims is always an integer from config.

  // Current facts, vector-ranked. to_char keeps as_of a clean YYYY-MM-DD string
  // (avoids node-pg returning a timezone-shifted Date).
  const factSql = `SELECT f.domain, f.category, f.key, f.value, f.context,
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
     LIMIT $6`;
  const factParams = [vec, embedder.url, embedder.model, args.domain ?? null, minSim, factLimit];

  // A capture's domain is model-assigned and only ~90% reproducible, so under a
  // boost a mismatch costs ranking rather than visibility. Facts keep the hard
  // filter above: their domain is chosen by the author at save_fact time.
  const boosting = args.domain != null && search.domain_boost > 0;
  const captureParams: unknown[] = [
    vec,
    embedder.url,
    embedder.model,
    args.domain ?? null,
    minSim,
    limit,
  ];
  if (boosting) captureParams.push(search.domain_boost);

  const distance = `ce.embedding::vector(${dims}) <=> $1::vector(${dims})`;
  const columns = `c.id, c.content, c.type, c.domain, c.topics, c.people,
            c.source_file, c.content_date,
            1 - (${distance}) AS similarity`;
  const from = `FROM captures c
     JOIN capture_embeddings ce ON ce.capture_id = c.id
     WHERE ce.provider_url = $2
       AND ce.model = $3`;
  const floor = `AND 1 - (${distance}) >= $5`;

  // Each arm orders by the bare distance so pgvector can still use the HNSW index; the
  // boost is applied once, outside, over at most 2x`limit` rows. Exact over the candidates,
  // since any row in the arms' top-N is in one arm, but the arms themselves are ANN.
  const captureSql = boosting
    ? `WITH candidates AS (
         (SELECT ${columns}
          ${from}
            AND c.domain = $4
            ${floor}
          ORDER BY ${distance}
          LIMIT $6)
         UNION
         (SELECT ${columns}
          ${from}
            ${floor}
          ORDER BY ${distance}
          LIMIT $6)
       )
       SELECT * FROM candidates
       ORDER BY similarity + CASE WHEN domain = $4 THEN $7::float8 ELSE 0 END DESC
       LIMIT $6`
    : `SELECT ${columns}
     ${from}
       AND ($4::text IS NULL OR c.domain = $4)
       ${floor}
     ORDER BY ${distance}
     LIMIT $6`;

  // A domain filter post-filters an ANN scan, so at the defaults a small domain comes back
  // short or empty. Neither setting alone fixed both queries; both stay transaction-local.
  const [factResult, captureResult] =
    args.domain != null
      ? await withTransaction(async (client) => {
          // SET does not take bind parameters; set_config does, with is_local = true.
          await client.query(
            "SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'strict_order', true)",
            [String(search.ef_search)]
          );
          return [
            await client.query(factSql, factParams),
            await client.query(captureSql, captureParams),
          ];
        })
      : [await query(factSql, factParams), await query(captureSql, captureParams)];

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
