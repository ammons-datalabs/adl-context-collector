import type { PoolClient } from "pg";
import { withTransaction } from "../db.js";
import { persistChunks, type PreparedChunk } from "./process-chunk.js";

export interface DeleteResult {
  capturesDeleted: number;
}

// Serialises every transaction that writes captures or links. Release reads the links
// other files hold, so a concurrent ingest or delete would otherwise lose or orphan one.
export async function lockIndexWrites(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('context-collector:index-writes'))");
}

// Drops a file's claim on its captures, except those whose hash is in `keep` (the chunks a
// re-ingest still holds). A released capture another file links to moves to that file.
export async function releaseSource(
  client: PoolClient,
  absPath: string,
  keep: string[] = []
): Promise<number> {
  await client.query("DELETE FROM capture_sources WHERE source_file = $1", [absPath]);
  await client.query(
    `UPDATE captures c SET source_file = l.source_file
       FROM (SELECT capture_id, min(source_file) AS source_file
               FROM capture_sources
              WHERE capture_id IN (SELECT id FROM captures
                                    WHERE source_file = $1 AND content_hash <> ALL($2::text[]))
              GROUP BY capture_id) l
      WHERE c.id = l.capture_id`,
    [absPath, keep]
  );
  const result = await client.query(
    "DELETE FROM captures WHERE source_file = $1 AND content_hash <> ALL($2::text[])",
    [absPath, keep]
  );
  return result.rowCount ?? 0;
}

// The write half of an ingest, run inside the caller's transaction.
export async function writeSource(
  client: PoolClient,
  path: string,
  fileHash: string,
  prepared: PreparedChunk[],
  existed: boolean
): Promise<{ duplicates: number; linked: number }> {
  await lockIndexWrites(client);
  if (existed) {
    await releaseSource(client, path, prepared.map((p) => p.contentHash));
  }
  const r = await persistChunks(client, prepared);
  await client.query(
    `INSERT INTO sources (file_path, file_hash, capture_count, last_imported)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (file_path)
     DO UPDATE SET file_hash = $2, capture_count = $3, last_imported = NOW()`,
    [path, fileHash, r.linked]
  );
  return r;
}

export async function deleteBySource(absPath: string): Promise<DeleteResult> {
  return withTransaction(async (client) => {
    await lockIndexWrites(client);
    const capturesDeleted = await releaseSource(client, absPath);
    await client.query("DELETE FROM sources WHERE file_path = $1", [absPath]);
    return { capturesDeleted };
  });
}
