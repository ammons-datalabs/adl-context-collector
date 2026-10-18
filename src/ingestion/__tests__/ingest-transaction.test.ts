import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js");
vi.mock("../process-chunk.js", () => ({
  prepareChunks: vi.fn().mockResolvedValue({ prepared: [{}], failed: 0 }),
  persistChunks: vi.fn().mockResolvedValue({ duplicates: 0, linked: 0 }),
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
    (persistChunks as ReturnType<typeof vi.fn>).mockResolvedValue({ duplicates: 1, linked: 3 });
  });

  it("locks, then releases before persisting, inside one transaction on re-ingestion", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: "oldhash" }] }); // SELECT
    const { ingestFile } = await import("../index.js");
    const { persistChunks } = await import("../process-chunk.js");
    const result = await ingestFile("/tmp/test.md");

    expect(result.status).toBe("ingested");
    const sqls = db.txSql();
    const del = sqls.findIndex((s) => s.includes("DELETE"));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(del).toBeGreaterThan(1);
    expect(sqls.indexOf("COMMIT")).toBeGreaterThan(del);
    expect(db.clientQuery.mock.invocationCallOrder[del]).toBeLessThan(
      (persistChunks as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    );
    const upsert = db.clientQuery.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO sources"));
    expect(upsert![1][2]).toBe(3); // capture_count = linked chunks, duplicates included
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

  it("reports skipped, not failed, when the file yields no chunks", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    // A .txt shorter than MIN_CHUNK_CHARS: chunkText yields nothing to index.
    const SHORT = "Blocked on the Keycloak realm import.";
    const { readFile } = await import("fs/promises");
    (readFile as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve(Buffer.from(SHORT)))
      .mockImplementationOnce(() => Promise.resolve(SHORT));

    const { ingestFile } = await import("../index.js");
    const result = await ingestFile("/tmp/note.txt");

    expect(result.status).toBe("skipped");
    expect(result.chunkCount).toBe(0);
    expect(result.failedChunks).toBe(0);
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
