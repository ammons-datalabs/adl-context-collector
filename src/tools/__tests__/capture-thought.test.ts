import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js", () => ({
  query: vi.fn(),
}));
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

describe("captureThought people canonicalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores canonicalized people array", async () => {
    const { query } = await import("../../db.js");
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      domain: "platform",
      type: "thought",
      topics: [],
      people: ["mootpointer", "andrew"],
      action_items: [],
      dates: null,
    });
    (query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM captures")) return { rows: [] };
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.startsWith("INSERT INTO captures")) {
        return { rows: [{ id: 99, captured_at: new Date() }] };
      }
      return { rows: [] };
    });

    const { captureThought } = await import("../capture-thought.js");
    await captureThought({ content: "hi" });

    const insertCall = (query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("INSERT INTO captures"),
    );
    expect(insertCall).toBeDefined();
    const peopleArg = insertCall![1][4]; // $5 = people
    expect(peopleArg).toEqual(["andrew"]); // both inputs collapsed and deduped
  });
});
