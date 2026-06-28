import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js");
vi.mock("../process-chunk.js", () => ({
  prepareChunks: vi.fn().mockResolvedValue({ prepared: [{}], failed: 0 }),
  persistChunks: vi.fn().mockResolvedValue({ duplicates: 0 }),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: {
      url: "https://api.openai.com/v1/embeddings",
      model: "text-embedding-3-small",
      dimensions: 1536,
      apiKey: "env:OPENAI_API_KEY",
    },
    metadataExtractor: { enabled: true },
  }),
}));

// Content must exceed MIN_CHUNK_CHARS (200) so chunkMarkdown yields one chunk.
const TEST_CONTENT = "# Test\n" + "Lorem ipsum dolor sit amet. ".repeat(20);
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    readFile: vi.fn().mockImplementation((_path: string, encoding?: string) =>
      encoding ? Promise.resolve(TEST_CONTENT) : Promise.resolve(Buffer.from(TEST_CONTENT))
    ),
  };
});

import * as dbModule from "../../db.js";
const db = dbModule as unknown as typeof import("../../__mocks__/db.js");

describe("ingestFile transaction safety", () => {
  beforeEach(async () => {
    db.resetDbMock();
    const { prepareChunks, persistChunks } = await import("../process-chunk.js");
    (prepareChunks as ReturnType<typeof vi.fn>).mockReset();
    (prepareChunks as ReturnType<typeof vi.fn>).mockResolvedValue({ prepared: [{}], failed: 0 });
    (persistChunks as ReturnType<typeof vi.fn>).mockReset();
    (persistChunks as ReturnType<typeof vi.fn>).mockResolvedValue({ duplicates: 0 });
  });

  it("wraps re-ingestion in BEGIN/DELETE/COMMIT on the transaction client", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: "oldhash" }] }); // SELECT
    const { ingestFile } = await import("../index.js");
    const result = await ingestFile("/tmp/test.md");

    expect(result.status).toBe("ingested");
    const sqls = db.txSql();
    const begin = sqls.indexOf("BEGIN");
    const del = sqls.findIndex((s) => s.includes("DELETE"));
    const commit = sqls.indexOf("COMMIT");
    expect(begin).toBe(0);
    expect(del).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(del);
  });

  it("rolls back and rejects when processing throws", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: "oldhash" }] });
    const { persistChunks } = await import("../process-chunk.js");
    (persistChunks as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connection lost")
    );

    const { ingestFile } = await import("../index.js");
    await expect(ingestFile("/tmp/test.md")).rejects.toThrow("connection lost");

    const sqls = db.txSql();
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
  });

  it("uses a transaction even for new-file ingestion (no DELETE)", async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // new file
    const { ingestFile } = await import("../index.js");
    const result = await ingestFile("/tmp/test.md");

    expect(result.status).toBe("ingested");
    const sqls = db.txSql();
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("COMMIT");
    expect(sqls.some((s) => s.includes("DELETE"))).toBe(false);
  });

  it("returns failed WITHOUT opening a transaction when all chunks fail", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const { prepareChunks } = await import("../process-chunk.js");
    (prepareChunks as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prepared: [], failed: 1 });

    const { ingestFile } = await import("../index.js");
    const result = await ingestFile("/tmp/test.md");

    expect(result.status).toBe("failed");
    expect(db.txSql()).toEqual([]);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("dry-run on a changed file neither deletes nor opens a transaction", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: "oldhash" }] }); // changed
    const { ingestFile } = await import("../index.js");
    const result = await ingestFile("/tmp/test.md", { dryRun: true });

    expect(result.status).toBe("ingested");
    expect(db.txSql()).toEqual([]);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});
