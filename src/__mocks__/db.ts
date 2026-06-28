import { vi } from "vitest";

// withTransaction runs its callback against a fake client, funneling
// BEGIN/COMMIT/ROLLBACK and every statement through clientQuery.
export const clientQuery = vi.fn();
const fakeClient = { query: clientQuery };

export const query = vi.fn();
export const getPool = vi.fn();

export const withTransaction = vi.fn(
  async (fn: (c: typeof fakeClient) => Promise<unknown>) => {
    await clientQuery("BEGIN");
    try {
      const r = await fn(fakeClient);
      await clientQuery("COMMIT");
      return r;
    } catch (e) {
      await clientQuery("ROLLBACK");
      throw e;
    }
  }
);

export function resetDbMock() {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  clientQuery.mockReset();
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("INSERT")) return { rowCount: 1, rows: [{ id: 1 }] };
    return { rowCount: 0, rows: [] };
  });
  withTransaction.mockClear();
}

export function txSql(): string[] {
  return clientQuery.mock.calls.map((c) => c[0] as string);
}
