import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeIssue } from "./github-fixtures.js";

vi.mock("../../db.js");
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: vi.fn().mockResolvedValue({
    type: "technical",
    domain: "engineering",
    topics: ["testing"],
    people: [],
    action_items: [],
    dates: {},
  }),
}));
vi.mock("../../services/hasher.js", () => ({
  hashContent: vi.fn().mockReturnValue("fakehash123"),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: {
      url: "https://api.openai.com/v1/embeddings",
      model: "text-embedding-3-small",
      dimensions: 1536,
      apiKey: "env:OPENAI_API_KEY",
    },
    metadataExtractor: {
      enabled: true,
      url: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      apiKey: "env:OPENAI_API_KEY",
    },
  }),
}));

import * as dbModule from "../../db.js";
const db = dbModule as unknown as typeof import("../../__mocks__/db.js");

const CONTENT_HASH = "fakehash123";

describe("ingestGitHubIssue", () => {
  beforeEach(() => {
    db.resetDbMock();
  });

  it("skips an issue when content hash matches file_hash", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: CONTENT_HASH }] });
    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("skipped");
    expect(result.chunkCount).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.txSql()).toEqual([]);
  });

  it("ingests a new issue (no existing source row)", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("ingested");
    expect(result.chunkCount).toBe(1);

    const sqls = db.txSql();
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");

    const insert = db.clientQuery.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO captures")
    );
    expect(insert![1][7]).toBe("github://org/repo/issues/42"); // source_file
    expect(insert![1][9]).toBe("github_issue_import"); // source_type

    const upsert = db.clientQuery.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO sources")
    );
    expect(upsert![1][1]).toBe(CONTENT_HASH); // file_hash = content hash
  });

  it("deletes old captures (before inserts) when re-ingesting a changed issue", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_hash: "oldhash456" }] });
    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("ingested");
    const del = db.clientQuery.mock.calls.find((c) =>
      (c[0] as string).includes("DELETE FROM captures")
    );
    expect(del).toBeDefined();
    expect(del![1][0]).toBe("github://org/repo/issues/42");

    const sqls = db.txSql();
    expect(sqls.findIndex((s) => s.includes("DELETE"))).toBeLessThan(
      sqls.findIndex((s) => s.includes("INSERT INTO captures"))
    );
  });

  it("rolls back and returns failed when all chunks fail to prepare", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const { generateEmbedding } = await import("../../services/embedder.js");
    (generateEmbedding as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("api down")
    );

    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("failed");
    expect(db.txSql()).toEqual([]);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("rolls back and rejects on a persist-stage DB error", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    db.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO captures")) throw new Error("db down");
      return { rows: [], rowCount: 0 };
    });

    const { ingestGitHubIssue } = await import("../github.js");
    await expect(ingestGitHubIssue(makeIssue(), "org/repo")).rejects.toThrow("db down");
    expect(db.txSql()).toContain("ROLLBACK");
    expect(db.txSql()).not.toContain("COMMIT");
  });

  it("reports chunk count in dry-run mode without inserting", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo", { dryRun: true });

    expect(result.status).toBe("ingested");
    expect(result.chunkCount).toBe(1);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.txSql()).toEqual([]);
  });

  it("skips via pre-fetched existingHash without querying", async () => {
    const { ingestGitHubIssue } = await import("../github.js");
    const result = await ingestGitHubIssue(makeIssue(), "org/repo", {}, CONTENT_HASH);

    expect(result.status).toBe("skipped");
    expect(db.query).toHaveBeenCalledTimes(0);
  });
});

describe("ingestGitHubIssues", () => {
  beforeEach(() => {
    db.resetDbMock();
  });

  it("aggregates results across multiple issues", async () => {
    const issues = [
      makeIssue({ number: 1, updatedAt: "2026-03-01T00:00:00Z" }),
      makeIssue({ number: 2, updatedAt: "2026-03-02T00:00:00Z" }),
      makeIssue({ number: 3, updatedAt: "2026-03-03T00:00:00Z" }),
    ];

    // Batch SELECT → issue 1 matches, issues 2+3 are new.
    db.query.mockResolvedValueOnce({
      rows: [{ file_path: "github://org/repo/issues/1", file_hash: CONTENT_HASH }],
    });

    const messages: string[] = [];
    const { ingestGitHubIssues } = await import("../github.js");
    const result = await ingestGitHubIssues(issues, "org/repo", {}, (m) =>
      messages.push(m)
    );

    expect(result.totalIssues).toBe(3);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.totalChunks).toBe(2);
    expect(db.query.mock.calls[0][0] as string).toContain("ANY($1)");
    expect(messages.some((m) => m.includes("Issue #1"))).toBe(true);
  });
});
