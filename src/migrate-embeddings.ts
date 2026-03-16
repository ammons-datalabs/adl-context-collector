import "dotenv/config";
import { parseArgs } from "node:util";
import { query } from "./db.js";
import { generateEmbedding } from "./services/embedder.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      concurrency: { type: "string", default: "5" },
      limit: { type: "string" },
      "create-index": { type: "boolean", default: true },
    },
    strict: true,
  });

  const { embedder } = loadConfig();
  const concurrency = parseInt(values.concurrency!, 10);
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;

  console.log("=== Embedding migration ===");
  console.log(`Provider: ${embedder.url}`);
  console.log(`Model: ${embedder.model} (${embedder.dimensions}d)\n`);

  // Find captures missing embeddings for this model
  const { rows: missing } = await query(
    `SELECT c.id, c.content
     FROM captures c
     LEFT JOIN capture_embeddings ce
       ON ce.capture_id = c.id
       AND ce.provider_url = $1
       AND ce.model = $2
     WHERE ce.capture_id IS NULL
     ORDER BY c.id
     ${limit ? `LIMIT ${limit}` : ""}`,
    [embedder.url, embedder.model]
  );

  if (missing.length === 0) {
    console.log("All captures already have embeddings for this model.");
    process.exit(0);
  }

  console.log(`${missing.length} captures to embed.\n`);

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const embedding = await generateEmbedding(row.content);
        await query(
          `INSERT INTO capture_embeddings (capture_id, provider_url, model, dimensions, embedding)
           VALUES ($1, $2, $3, $4, $5::vector)
           ON CONFLICT (capture_id, provider_url, model) DO NOTHING`,
          [row.id, embedder.url, embedder.model, embedder.dimensions, JSON.stringify(embedding)]
        );
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") completed++;
      else {
        failed++;
        console.error(`  Failed: ${r.reason}`);
      }
    }

    console.log(`[${Math.min(i + concurrency, missing.length)}/${missing.length}] ${completed} done, ${failed} failed`);
  }

  // Optionally create HNSW index
  if (values["create-index"] !== false) {
    const indexName = `idx_embeddings_${embedder.model.replace(/[^a-z0-9]/g, "_")}_${embedder.dimensions}`;
    console.log(`\nCreating HNSW index: ${indexName}...`);
    await query(`
      CREATE INDEX IF NOT EXISTS ${indexName}
      ON capture_embeddings
      USING hnsw ((embedding::vector(${embedder.dimensions})) vector_cosine_ops)
      WHERE provider_url = '${embedder.url}'
        AND model = '${embedder.model}'
    `);
  }

  console.log(`\nDone: ${completed} embedded, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
