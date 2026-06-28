import { describe, it, expect, beforeEach, vi } from "vitest";

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
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) =>
    (names ?? []).map((n) => (n === "Adam-Hammo" ? "adam" : n.toLowerCase()))
  ),
}));

describe("prepareChunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts the canonicalized people array in captureArgs ($5)", async () => {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "note",
      domain: "platform",
      topics: ["t"],
      people: ["Adam-Hammo", "andrew"],
      action_items: [],
      dates: null,
    });

    const { prepareChunk } = await import("../process-chunk.js");
    const prepared = await prepareChunk(
      { content: "hello", index: 0, metadata: {} } as never,
      "test.md",
      "markdown_import" as never
    );

    expect(prepared).not.toBeNull();
    expect(prepared!.captureArgs[4]).toEqual(["adam", "andrew"]);
  });

  it("uses the type override instead of the LLM-extracted type ($2)", async () => {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "meeting",
      domain: "process",
      topics: ["t"],
      people: [],
      action_items: [],
      dates: null,
    });

    const { prepareChunk } = await import("../process-chunk.js");
    const prepared = await prepareChunk(
      { content: "hello", index: 0, metadata: {} } as never,
      "test.md",
      "markdown_import" as never,
      "process",
      "review"
    );

    expect(prepared!.captureArgs[1]).toBe("review");
  });

  it("returns null (soft fail) when embedding generation throws — no SQL", async () => {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "note",
      domain: "platform",
      topics: [],
      people: [],
      action_items: [],
      dates: null,
    });
    const { generateEmbedding } = await import("../../services/embedder.js");
    (generateEmbedding as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("api down")
    );

    const { prepareChunk } = await import("../process-chunk.js");
    const prepared = await prepareChunk(
      { content: "hello", index: 0, metadata: {} } as never,
      "test.md",
      "markdown_import" as never
    );

    expect(prepared).toBeNull();
  });
});

describe("persistChunk", () => {
  const prepared = {
    captureArgs: new Array(12).fill(null),
    embedding: [0.1],
    embedderUrl: "u",
    embedderModel: "m",
    embedderDimensions: 1,
  };

  it("inserts capture then embedding and returns 'inserted'", async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const { persistChunk } = await import("../process-chunk.js");
    const outcome = await persistChunk({ query: clientQuery } as never, prepared as never);

    expect(outcome).toBe("inserted");
    expect(clientQuery.mock.calls[0][0]).toContain("INSERT INTO captures");
    expect(clientQuery.mock.calls[1][0]).toContain("INSERT INTO capture_embeddings");
    expect(clientQuery.mock.calls[1][1][0]).toBe(7); // capture_id from RETURNING
  });

  it("returns 'duplicate' (no embedding insert) when capture hits ON CONFLICT", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const { persistChunk } = await import("../process-chunk.js");
    const outcome = await persistChunk({ query: clientQuery } as never, prepared as never);

    expect(outcome).toBe("duplicate");
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it("propagates a DB error (does not swallow)", async () => {
    const clientQuery = vi.fn().mockRejectedValueOnce(new Error("db down"));

    const { persistChunk } = await import("../process-chunk.js");
    await expect(
      persistChunk({ query: clientQuery } as never, prepared as never)
    ).rejects.toThrow("db down");
  });
});
