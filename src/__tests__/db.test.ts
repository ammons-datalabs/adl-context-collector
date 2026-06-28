import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const release = vi.fn();
  const client = { query: clientQuery, release };
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(async () => ({ rows: [] })); // getPool() init probe
  return { clientQuery, release, client, connect, poolQuery };
});

vi.mock("pg", () => {
  function Pool() {
    return { query: h.poolQuery, connect: h.connect };
  }
  return { default: { Pool, types: { setTypeParser: vi.fn() } } };
});
vi.mock("pgvector", () => ({ default: { fromSql: () => {} }, fromSql: () => {} }));

describe("withTransaction", () => {
  beforeEach(() => {
    h.clientQuery.mockReset();
    h.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    h.release.mockReset();
    h.connect.mockReset();
    h.connect.mockResolvedValue(h.client);
  });

  it("runs BEGIN, the callback, COMMIT, then releases on success", async () => {
    const { withTransaction } = await import("../db.js");
    const result = await withTransaction(async (c) => {
      await c.query("DELETE x");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(h.clientQuery.mock.calls.map((c) => c[0])).toEqual([
      "BEGIN",
      "DELETE x",
      "COMMIT",
    ]);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledWith();
  });

  it("rolls back and rethrows the original error when the callback throws", async () => {
    const { withTransaction } = await import("../db.js");
    await expect(
      withTransaction(async () => {
        throw new Error("fn failed");
      })
    ).rejects.toThrow("fn failed");
    expect(h.clientQuery.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledWith();
  });

  it("destroys the connection when ROLLBACK itself fails", async () => {
    h.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      if (sql === "BEGIN") return { rows: [] };
      throw new Error("fn failed");
    });
    const { withTransaction } = await import("../db.js");
    await expect(
      withTransaction(async (c) => {
        await c.query("INSERT y");
        return "x";
      })
    ).rejects.toThrow("fn failed");
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
