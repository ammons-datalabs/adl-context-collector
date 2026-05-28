import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db.js", () => ({
  query: vi.fn(),
}));
vi.mock("../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) => {
    const map: Record<string, string> = {
      "adam-hammo": "adam",
      mootpointer: "andrew",
    };
    const drop = new Set(["claude"]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const n of names ?? []) {
      const lower = n.toLowerCase();
      if (drop.has(lower)) continue;
      const c = map[lower] ?? lower;
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }),
}));

describe("migratePeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates rows whose canonicalized people array differs", async () => {
    const { query } = await import("../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM captures")) {
        return {
          rows: [
            { id: 1, people: ["Adam-Hammo", "andrew"] }, // -> ['adam', 'andrew']
            { id: 2, people: ["andrew"] }, // unchanged
            { id: 3, people: ["claude", "adam"] }, // claude dropped
          ],
        };
      }
      if (sql.includes("FROM facts")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { migratePeople } = await import("../migrate-people.js");
    const summary = await migratePeople({ dryRun: false });

    const updateCalls = (query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("UPDATE captures"),
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][1]).toEqual([["adam", "andrew"], 1]);
    expect(updateCalls[1][1]).toEqual([["adam"], 3]);
    expect(summary.capturesChanged).toBe(2);
    expect(summary.capturesUnchanged).toBe(1);
  });

  it("dry-run does not issue UPDATEs", async () => {
    const { query } = await import("../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM captures")) {
        return { rows: [{ id: 1, people: ["Adam-Hammo"] }] };
      }
      return { rows: [] };
    });

    const { migratePeople } = await import("../migrate-people.js");
    const summary = await migratePeople({ dryRun: true });

    const updateCalls = (query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("UPDATE"),
    );
    expect(updateCalls).toHaveLength(0);
    expect(summary.capturesChanged).toBe(1);
  });

  it("is idempotent — second run sees no changes", async () => {
    const { query } = await import("../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM captures")) {
        return { rows: [{ id: 1, people: ["adam", "andrew"] }] };
      }
      return { rows: [] };
    });

    const { migratePeople } = await import("../migrate-people.js");
    const summary = await migratePeople({ dryRun: false });

    const updateCalls = (query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("UPDATE"),
    );
    expect(updateCalls).toHaveLength(0);
    expect(summary.capturesUnchanged).toBe(1);
  });
});
