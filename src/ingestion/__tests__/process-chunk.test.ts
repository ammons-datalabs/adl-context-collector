import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js", () => ({
  query: vi.fn(),
}));
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("../../services/hasher.js", () => ({
  hashContent: vi.fn().mockReturnValue("hash-123"),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 3 },
    vaultRoot: null,
    peopleFile: null,
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) =>
    names.map((n) => (n === "Adam-Hammo" ? "adam" : n.toLowerCase())),
  ),
}));

describe("processChunk people canonicalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes canonicalized people array to INSERT", async () => {
    const { query } = await import("../../db.js");
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "note",
      domain: "platform",
      topics: ["t"],
      people: ["Adam-Hammo", "andrew"],
      action_items: [],
      dates: null,
    });
    (query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 1 }],
    });

    const { processChunk } = await import("../process-chunk.js");
    await processChunk(
      { content: "hello", index: 0, metadata: {} } as never,
      "test.md",
      "markdown_import" as never,
    );

    const insertCall = (query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO captures"),
    );
    expect(insertCall).toBeDefined();
    const peopleArg = insertCall![1][4]; // 5th param ($5) is people
    expect(peopleArg).toEqual(["adam", "andrew"]);
  });
});
