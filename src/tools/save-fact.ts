import { withTransaction } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { loadConfig } from "../config.js";
import { SOURCE_TYPES } from "../ingestion/types.js";
import { canonicalizePeople } from "../services/people.js";

export async function saveFact(args: {
  domain: string;
  category: string;
  key: string;
  value: string;
  value_numeric?: number;
  currency?: string;
  unit?: string;
  context?: string;
  people?: string[];
  as_of?: string;
}) {
  const asOf = args.as_of ?? new Date().toISOString().split("T")[0];
  const people = canonicalizePeople(args.people);
  const { embedder } = loadConfig();

  // Indexed text; kept in sync with the fact backfill query in migrate-embeddings.ts.
  const embedText =
    `${args.domain}/${args.category} - ${args.key}: ${args.value}` +
    (args.context ? `\n${args.context}` : "");

  // Embed before the transaction so an embedding-API failure aborts before any write.
  const embedding = await generateEmbedding(embedText);

  const factId = await withTransaction(async (client) => {
    // Mark previous value as superseded
    await client.query(
      `UPDATE facts SET valid_until = $1::date
       WHERE domain = $2 AND category = $3 AND key = $4 AND valid_until IS NULL`,
      [asOf, args.domain, args.category, args.key]
    );

    // Insert/update the current value; valid_until = NULL keeps a same-as_of re-save current.
    const result = await client.query(
      `INSERT INTO facts (domain, category, key, value, value_numeric, currency, unit, context, people, as_of, source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11)
       ON CONFLICT (domain, category, key, as_of) DO UPDATE
         SET value = EXCLUDED.value,
             value_numeric = EXCLUDED.value_numeric,
             currency = EXCLUDED.currency,
             unit = EXCLUDED.unit,
             context = EXCLUDED.context,
             people = EXCLUDED.people,
             valid_until = NULL,
             captured_at = NOW()
       RETURNING id`,
      [
        args.domain,
        args.category,
        args.key,
        args.value,
        args.value_numeric ?? null,
        args.currency ?? null,
        args.unit ?? null,
        args.context ?? null,
        people.length > 0 ? people : null,
        asOf,
        SOURCE_TYPES.CLAUDE_CAPTURE,
      ]
    );

    const id = result.rows[0].id;

    // Upsert the embedding. DO UPDATE so a same-as_of value change re-embeds
    // rather than keeping a stale vector.
    await client.query(
      `INSERT INTO fact_embeddings (fact_id, provider_url, model, dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (fact_id, provider_url, model) DO UPDATE
         SET embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions`,
      [id, embedder.url, embedder.model, embedder.dimensions, JSON.stringify(embedding)]
    );

    return id;
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Saved fact #${factId}: ${args.domain}/${args.category}/${args.key} = ${args.value}${args.currency ? ` ${args.currency}` : ""} (as of ${asOf})${people.length > 0 ? `\nPeople: ${people.join(", ")}` : ""}`,
      },
    ],
  };
}
