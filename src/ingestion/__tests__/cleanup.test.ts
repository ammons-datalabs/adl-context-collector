import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js");

import * as dbModule from "../../db.js";
const db = dbModule as unknown as typeof import("../../__mocks__/db.js");

describe("deleteBySource", () => {
  beforeEach(() => {
    db.resetDbMock();
  });

  it("locks, releases the file's captures, then deletes its source record, in a transaction", async () => {
    db.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM captures")) return { rowCount: 5 };
      return { rows: [], rowCount: 0 };
    });

    const { deleteBySource } = await import("../cleanup.js");
    const result = await deleteBySource("/vault/old-file.md");

    expect(result.capturesDeleted).toBe(5);
    expect(db.txSql()).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("DELETE FROM capture_sources"),
      expect.stringContaining("UPDATE captures"),
      expect.stringContaining("DELETE FROM captures"),
      expect.stringContaining("DELETE FROM sources"),
      "COMMIT",
    ]);
  });

  it("rolls back on error", async () => {
    db.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM captures")) return { rowCount: 3 };
      if (sql.includes("DELETE FROM sources")) throw new Error("DB error");
      return { rows: [], rowCount: 0 };
    });

    const { deleteBySource } = await import("../cleanup.js");
    await expect(deleteBySource("/vault/old-file.md")).rejects.toThrow("DB error");
    expect(db.txSql()).toContain("ROLLBACK");
    expect(db.txSql()).not.toContain("COMMIT");
  });

  it("returns 0 when no captures exist for the path", async () => {
    db.clientQuery.mockImplementation(async () => ({ rowCount: 0, rows: [] }));

    const { deleteBySource } = await import("../cleanup.js");
    const result = await deleteBySource("/vault/nonexistent.md");

    expect(result.capturesDeleted).toBe(0);
  });
});
