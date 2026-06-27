import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../../db.js", () => ({ query: queryMock }));

describe("deleteBySource", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("deletes captures and source record in a transaction", async () => {
    queryMock.mockResolvedValueOnce({}); // BEGIN
    queryMock.mockResolvedValueOnce({ rowCount: 5 }); // DELETE captures
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // DELETE sources
    queryMock.mockResolvedValueOnce({}); // COMMIT

    const { deleteBySource } = await import("../cleanup.js");
    const result = await deleteBySource("/vault/old-file.md");

    expect(result.capturesDeleted).toBe(5);
    const calls = queryMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("DELETE FROM captures");
    expect(calls[2]).toContain("DELETE FROM sources");
    expect(calls[3]).toBe("COMMIT");
  });

  it("rolls back on error", async () => {
    queryMock.mockResolvedValueOnce({}); // BEGIN
    queryMock.mockResolvedValueOnce({ rowCount: 3 }); // DELETE captures
    queryMock.mockRejectedValueOnce(new Error("DB error")); // DELETE sources fails
    queryMock.mockResolvedValueOnce({}); // ROLLBACK

    const { deleteBySource } = await import("../cleanup.js");
    await expect(deleteBySource("/vault/old-file.md")).rejects.toThrow(
      "DB error"
    );

    const calls = queryMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls).toContain("ROLLBACK");
  });

  it("returns 0 when no captures exist for the path", async () => {
    queryMock.mockResolvedValueOnce({}); // BEGIN
    queryMock.mockResolvedValueOnce({ rowCount: 0 }); // DELETE captures (none)
    queryMock.mockResolvedValueOnce({ rowCount: 0 }); // DELETE sources (none)
    queryMock.mockResolvedValueOnce({}); // COMMIT

    const { deleteBySource } = await import("../cleanup.js");
    const result = await deleteBySource("/vault/nonexistent.md");

    expect(result.capturesDeleted).toBe(0);
  });
});
