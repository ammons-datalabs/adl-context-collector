import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js");
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1]),
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("../../services/hasher.js", () => ({
  hashContent: vi.fn().mockReturnValue("hash-abc"),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 1 },
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names ?? []) {
      const canonical = n === "mootpointer" ? "andrew" : n.toLowerCase();
      if (!seen.has(canonical)) {
        seen.add(canonical);
        out.push(canonical);
      }
    }
    return out;
  }),
}));

import * as dbModule from "../../db.js";
const db = dbModule as unknown as typeof import("../../__mocks__/db.js");

describe("captureThought people canonicalization", () => {
  beforeEach(() => {
    db.resetDbMock();
  });

  it("stores the canonicalized people array inside a transaction", async () => {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      domain: "platform",
      type: "thought",
      topics: [],
      people: ["mootpointer", "andrew"],
      action_items: [],
      dates: null,
    });
    db.query.mockResolvedValueOnce({ rows: [] }); // dup check → none
    db.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO captures")) {
        return { rows: [{ id: 99, captured_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const { captureThought } = await import("../capture-thought.js");
    await captureThought({ content: "hi" });

    const insert = db.clientQuery.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO captures")
    );
    expect(insert).toBeDefined();
    expect(insert![1][4]).toEqual(["andrew"]); // $5 people, collapsed + deduped

    const sqls = db.txSql();
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("COMMIT");
  });

  it("skips an existing thought without opening a transaction", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // dup check → exists

    const { captureThought } = await import("../capture-thought.js");
    const result = await captureThought({ content: "hi" });

    expect(result.content[0].text).toContain("already exists");
    expect(db.txSql()).toEqual([]);
  });
});
