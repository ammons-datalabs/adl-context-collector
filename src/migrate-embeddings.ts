import "dotenv/config";
import { parseArgs } from "node:util";
import { query } from "./db.js";
import { generateEmbedding } from "./services/embedder.js";
import { loadConfig } from "./config.js";

type EmbedTarget = {
  label: string;
  table: string; // embeddings table
  idCol: string; // fk column in the embeddings table
  indexPrefix: string; // preserve existing names: captures -> idx_embeddings
  ensureSchema?: () => Promise<void>;
  findMissing: (
    url: string,
    model: string,
    limit?: number
  ) => Promise<Array<{ id: number; text: string }>>;
};

async function runTarget(
  t: EmbedTarget,
  url: string,
  model: string,
  dims: number,
  concurrency: number,
  limit: number | undefined,
  createIndex: boolean
): Promise<void> {
  if (t.ensureSchema) await t.ensureSchema();

  const missing = await t.findMissing(url, model, limit);
  if (missing.length === 0) {
    console.log(`${t.label}: all rows already embedded for this model.`);
  } else {
    console.log(`${t.label}: ${missing.length} rows to embed.`);
    let completed = 0;
    let failed = 0;
    for (let i = 0; i < missing.length; i += concurrency) {
      const batch = missing.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (row) => {
          const embedding = await generateEmbedding(row.text);
          await query(
            `INSERT INTO ${t.table} (${t.idCol}, provider_url, model, dimensions, embedding)
             VALUES ($1, $2, $3, $4, $5::vector)
             ON CONFLICT (${t.idCol}, provider_url, model) DO NOTHING`,
            [row.id, url, model, dims, JSON.stringify(embedding)]
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
      console.log(
        `  [${Math.min(i + concurrency, missing.length)}/${missing.length}] ${completed} done, ${failed} failed`
      );
    }
    if (failed > 0) process.exitCode = 1;
  }

  if (createIndex) {
    const indexName = `${t.indexPrefix}_${model.replace(/[^a-z0-9]/g, "_")}_${dims}`;
    console.log(`${t.label}: creating HNSW index ${indexName}...`);
    await query(`
      CREATE INDEX IF NOT EXISTS ${indexName}
      ON ${t.table}
      USING hnsw ((embedding::vector(${dims})) vector_cosine_ops)
      WHERE provider_url = '${url}'
        AND model = '${model}'
    `);
  }
}

function buildTargets(): Record<string, EmbedTarget> {
  return {
    captures: {
      label: "captures",
      table: "capture_embeddings",
      idCol: "capture_id",
      indexPrefix: "idx_embeddings",
      findMissing: async (url, model, limit) => {
        const { rows } = await query(
          `SELECT c.id, c.content AS text
           FROM captures c
           LEFT JOIN capture_embeddings ce
             ON ce.capture_id = c.id AND ce.provider_url = $1 AND ce.model = $2
           WHERE ce.capture_id IS NULL
           ORDER BY c.id
           ${limit ? `LIMIT ${limit}` : ""}`,
          [url, model]
        );
        return rows as Array<{ id: number; text: string }>;
      },
    },
    facts: {
      label: "facts",
      table: "fact_embeddings",
      idCol: "fact_id",
      indexPrefix: "idx_fact_embeddings",
      ensureSchema: async () => {
        await query(`
          CREATE TABLE IF NOT EXISTS fact_embeddings (
            fact_id      BIGINT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
            provider_url TEXT NOT NULL,
            model        TEXT NOT NULL,
            dimensions   INTEGER NOT NULL,
            embedding    vector NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (fact_id, provider_url, model)
          )
        `);
      },
      findMissing: async (url, model, limit) => {
        // Text composition mirrors save-fact.ts exactly.
        const { rows } = await query(
          `SELECT f.id,
                  f.domain || '/' || f.category || ' - ' || f.key || ': ' || f.value
                    || COALESCE(E'\\n' || f.context, '') AS text
           FROM facts f
           LEFT JOIN fact_embeddings fe
             ON fe.fact_id = f.id AND fe.provider_url = $1 AND fe.model = $2
           WHERE fe.fact_id IS NULL AND f.valid_until IS NULL
           ORDER BY f.id
           ${limit ? `LIMIT ${limit}` : ""}`,
          [url, model]
        );
        return rows as Array<{ id: number; text: string }>;
      },
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      concurrency: { type: "string", default: "5" },
      limit: { type: "string" },
      target: { type: "string", default: "all" },
      "create-index": { type: "boolean", default: true },
    },
    strict: true,
  });

  const { embedder } = loadConfig();
  const concurrency = parseInt(values.concurrency!, 10);
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const target = values.target!;
  const createIndex = values["create-index"] !== false;

  if (!["captures", "facts", "all"].includes(target)) {
    console.error(`Invalid --target '${target}'. Use captures|facts|all.`);
    process.exit(1);
  }

  console.log("=== Embedding migration ===");
  console.log(`Provider: ${embedder.url}`);
  console.log(`Model: ${embedder.model} (${embedder.dimensions}d)`);
  console.log(`Target: ${target}\n`);

  const targets = buildTargets();
  const selected = target === "all" ? ["captures", "facts"] : [target];

  for (const name of selected) {
    await runTarget(
      targets[name],
      embedder.url,
      embedder.model,
      embedder.dimensions,
      concurrency,
      limit,
      createIndex
    );
  }

  console.log("\nDone.");
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
