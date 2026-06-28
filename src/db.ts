import pg from "pg";
import pgvector from "pgvector";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

let initialized = false;

export async function getPool(): Promise<pg.Pool> {
  if (!initialized) {
    const result = await pool.query(
      "SELECT typname, oid FROM pg_type WHERE typname IN ($1, $2, $3)",
      ["vector", "halfvec", "sparsevec"]
    );
    for (const row of result.rows) {
      if (row.typname === "vector" || row.typname === "halfvec") {
        pg.types.setTypeParser(row.oid, pgvector.fromSql);
      } else if (row.typname === "sparsevec") {
        pg.types.setTypeParser(row.oid, pgvector.fromSql);
      }
    }
    initialized = true;
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const p = await getPool();
  return p.query(text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      client.release(rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr))); // destroy a poisoned connection
      released = true;
    }
    throw err;
  } finally {
    if (!released) client.release();
  }
}
