import { query } from "../db.js";

export interface DeleteResult {
  capturesDeleted: number;
}

export async function deleteBySource(absPath: string): Promise<DeleteResult> {
  await query("BEGIN");
  try {
    const result = await query(
      "DELETE FROM captures WHERE source_file = $1",
      [absPath]
    );
    await query("DELETE FROM sources WHERE file_path = $1", [absPath]);
    await query("COMMIT");
    return { capturesDeleted: result.rowCount ?? 0 };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
