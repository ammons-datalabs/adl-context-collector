import type { PoolClient } from "pg";
import { withTransaction } from "../db.js";

export interface DeleteResult {
  capturesDeleted: number;
}

// Drops a file's claim on its captures. A capture it owns that another file still links
// to moves to that file instead of being deleted; only captures nothing else holds go.
export async function releaseSource(client: PoolClient, absPath: string): Promise<number> {
  await client.query("DELETE FROM capture_sources WHERE source_file = $1", [absPath]);
  await client.query(
    `UPDATE captures c SET source_file = l.source_file
       FROM (SELECT capture_id, min(source_file) AS source_file
               FROM capture_sources
              WHERE capture_id IN (SELECT id FROM captures WHERE source_file = $1)
              GROUP BY capture_id) l
      WHERE c.id = l.capture_id`,
    [absPath]
  );
  const result = await client.query("DELETE FROM captures WHERE source_file = $1", [absPath]);
  return result.rowCount ?? 0;
}

export async function deleteBySource(absPath: string): Promise<DeleteResult> {
  return withTransaction(async (client) => {
    const capturesDeleted = await releaseSource(client, absPath);
    await client.query("DELETE FROM sources WHERE file_path = $1", [absPath]);
    return { capturesDeleted };
  });
}
