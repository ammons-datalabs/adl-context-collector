import "dotenv/config";
import { parseArgs } from "node:util";
import { query } from "./db.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const { embedder: configEmbedder } = loadConfig();

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "legacy-url": { type: "string", default: configEmbedder.url },
      "legacy-model": { type: "string", default: configEmbedder.model },
      "legacy-dims": { type: "string", default: String(configEmbedder.dimensions) },
    },
    strict: true,
  });

  const legacyUrl = values["legacy-url"]!;
  const legacyModel = values["legacy-model"]!;
  const legacyDims = parseInt(values["legacy-dims"]!, 10);

  console.log("=== context-collector schema migration ===\n");
  console.log(`Legacy embedder: ${legacyUrl}`);
  console.log(`Legacy model: ${legacyModel} (${legacyDims}d)\n`);

  // Step 1: Create capture_embeddings table
  console.log("Creating capture_embeddings table...");
  await query(`
    CREATE TABLE IF NOT EXISTS capture_embeddings (
      capture_id   BIGINT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      provider_url TEXT NOT NULL,
      model        TEXT NOT NULL,
      dimensions   INTEGER NOT NULL,
      embedding    vector NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (capture_id, provider_url, model)
    )
  `);

  // Step 2: Check if old embedding column exists
  const { rows: columns } = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'captures' AND column_name = 'embedding'
  `);

  if (columns.length === 0) {
    console.log("Column captures.embedding already removed — migration already complete.");
    process.exit(0);
  }

  // Step 3: Copy existing embeddings with legacy model metadata
  console.log("Copying existing embeddings to capture_embeddings...");
  const { rowCount: copied } = await query(
    `INSERT INTO capture_embeddings (capture_id, provider_url, model, dimensions, embedding)
     SELECT id, $1, $2, $3, embedding
     FROM captures
     WHERE embedding IS NOT NULL
     ON CONFLICT (capture_id, provider_url, model) DO NOTHING`,
    [legacyUrl, legacyModel, legacyDims]
  );
  console.log(`  Copied ${copied ?? 0} embeddings.`);

  // Step 4: Verify row counts
  const { rows: [{ expected }] } = await query(
    "SELECT count(*) as expected FROM captures WHERE embedding IS NOT NULL"
  );
  const { rows: [{ actual }] } = await query(
    "SELECT count(*) as actual FROM capture_embeddings WHERE provider_url = $1 AND model = $2",
    [legacyUrl, legacyModel]
  );
  if (Number(expected) !== Number(actual)) {
    console.error(`Row count mismatch: expected ${expected}, got ${actual}. Aborting.`);
    process.exit(1);
  }
  console.log(`  Verified: ${actual} rows match.`);

  // Step 5: Create HNSW index for legacy model
  const indexName = `idx_embeddings_${legacyModel.replace(/[^a-z0-9]/g, "_")}_${legacyDims}`;
  console.log(`Creating HNSW index: ${indexName}...`);
  await query(`
    CREATE INDEX IF NOT EXISTS ${indexName}
    ON capture_embeddings
    USING hnsw ((embedding::vector(${legacyDims})) vector_cosine_ops)
    WHERE provider_url = '${legacyUrl}'
      AND model = '${legacyModel}'
  `);

  // Step 6: Drop old column and index
  console.log("Dropping old captures.embedding column and index...");
  await query("DROP INDEX IF EXISTS idx_captures_embedding");
  await query("ALTER TABLE captures DROP COLUMN IF EXISTS embedding");

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
