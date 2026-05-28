import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js", () => ({
  query: vi.fn(),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const n of names ?? []) {
      const c = n === "danielbreves" ? "daniel" : n.toLowerCase();
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }),
}));

describe("saveFact people canonicalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores canonicalized people in the fact row", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] }); // UPDATE supersede
    (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: 7 }],
    });

    const { saveFact } = await import("../save-fact.js");
    await saveFact({
      domain: "team",
      category: "status",
      key: "danielbreves_focus",
      value: "evidence-repo-ui",
      people: ["danielbreves", "daniel"],
    });

    const insertCall = (query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("INSERT INTO facts"),
    );
    expect(insertCall).toBeDefined();
    const peopleArg = insertCall![1][8]; // $9 = people
    expect(peopleArg).toEqual(["daniel"]);
  });
});
