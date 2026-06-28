import { withTransaction } from "../db.js";

export interface DeleteResult {
  capturesDeleted: number;
}

export async function deleteBySource(absPath: string): Promise<DeleteResult> {
  return withTransaction(async (client) => {
    const result = await client.query(
      "DELETE FROM captures WHERE source_file = $1",
      [absPath]
    );
    await client.query("DELETE FROM sources WHERE file_path = $1", [absPath]);
    return { capturesDeleted: result.rowCount ?? 0 };
  });
}
