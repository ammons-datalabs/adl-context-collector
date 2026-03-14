import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeIssue } from "./github-fixtures.js";

// Mock external dependencies before importing the module under test
vi.mock("../../db.js", () => ({
  query: vi.fn(),
}));
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

// hashContent mock always returns "fakehash123", so hashIssueContent also returns "fakehash123"
const CONTENT_HASH = "fakehash123";

describe("ingestGitHubIssue", () => {
  let queryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const db = await import("../../db.js");
    queryMock = db.query as ReturnType<typeof vi.fn>;
    queryMock.mockReset();
  });

  it("skips an issue when content hash matches file_hash", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → existing with matching content hash
    queryMock.mockResolvedValueOnce({
      rows: [{ file_hash: CONTENT_HASH }],
    });

    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("skipped");
    expect(result.chunkCount).toBe(0);
    // Only the SELECT query should have been called
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("ingests a new issue (no existing source row)", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → empty
    queryMock.mockResolvedValueOnce({ rows: [] });
    // BEGIN
    queryMock.mockResolvedValueOnce({});
    // INSERT captures → inserted
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // UPSERT sources
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // COMMIT
    queryMock.mockResolvedValueOnce({});

    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("ingested");
    expect(result.chunkCount).toBe(1);

    // Check the INSERT captures call (index 2: after SELECT + BEGIN)
    const insertCall = queryMock.mock.calls[2];
    expect(insertCall[1][8]).toBe("github://org/repo/issues/42"); // source_file
    expect(insertCall[1][10]).toBe("github_issue_import"); // source_type

    // Check the UPSERT stores content hash in file_hash
    const upsertCall = queryMock.mock.calls[3];
    expect(upsertCall[1][1]).toBe(CONTENT_HASH); // file_hash = content hash
  });

  it("deletes old captures when re-ingesting a changed issue", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → existing with different hash (content changed)
    queryMock.mockResolvedValueOnce({
      rows: [{ file_hash: "oldhash456" }],
    });
    // BEGIN
    queryMock.mockResolvedValueOnce({});
    // DELETE old captures
    queryMock.mockResolvedValueOnce({ rowCount: 3 });
    // INSERT captures → inserted
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // UPSERT sources
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // COMMIT
    queryMock.mockResolvedValueOnce({});

    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("ingested");

    // Verify DELETE was called for old captures (index 2: after SELECT + BEGIN)
    const deleteCall = queryMock.mock.calls[2];
    expect(deleteCall[0]).toContain("DELETE FROM captures");
    expect(deleteCall[1][0]).toBe("github://org/repo/issues/42");
  });

  it("rolls back transaction when all chunks fail", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → new issue
    queryMock.mockResolvedValueOnce({ rows: [] });
    // BEGIN
    queryMock.mockResolvedValueOnce({});
    // INSERT captures → fails
    queryMock.mockRejectedValueOnce(new Error("DB error"));
    // ROLLBACK
    queryMock.mockResolvedValueOnce({});

    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("failed");

    // Verify ROLLBACK was called
    const rollbackCall = queryMock.mock.calls[3];
    expect(rollbackCall[0]).toBe("ROLLBACK");
  });

  it("reports chunk count in dry-run mode without inserting", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → empty (new issue)
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await ingestGitHubIssue(makeIssue(), "org/repo", {
      dryRun: true,
    });

    expect(result.status).toBe("ingested");
    expect(result.chunkCount).toBe(1);
    // Only SELECT was called — no transaction
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("skips via pre-fetched existingHash without querying", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    const result = await ingestGitHubIssue(
      makeIssue(),
      "org/repo",
      {},
      CONTENT_HASH
    );

    expect(result.status).toBe("skipped");
    // No queries at all — hash was pre-fetched
    expect(queryMock).toHaveBeenCalledTimes(0);
  });
});

describe("ingestGitHubIssues", () => {
  let queryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const db = await import("../../db.js");
    queryMock = db.query as ReturnType<typeof vi.fn>;
    queryMock.mockReset();
  });

  it("aggregates results across multiple issues", async () => {
    const { ingestGitHubIssues } = await import("../github.js");

    const issues = [
      makeIssue({ number: 1, updatedAt: "2026-03-01T00:00:00Z" }),
      makeIssue({ number: 2, updatedAt: "2026-03-02T00:00:00Z" }),
      makeIssue({ number: 3, updatedAt: "2026-03-03T00:00:00Z" }),
    ];

    // Batch SELECT sources → issue 1 has matching hash, issues 2+3 are new
    queryMock.mockResolvedValueOnce({
      rows: [
        { file_path: "github://org/repo/issues/1", file_hash: CONTENT_HASH },
      ],
    });

    // Issue 2: new → BEGIN, INSERT captures, UPSERT sources, COMMIT
    queryMock.mockResolvedValueOnce({}); // BEGIN
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // INSERT captures
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPSERT sources
    queryMock.mockResolvedValueOnce({}); // COMMIT

    // Issue 3: new → BEGIN, INSERT captures, UPSERT sources, COMMIT
    queryMock.mockResolvedValueOnce({}); // BEGIN
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // INSERT captures
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPSERT sources
    queryMock.mockResolvedValueOnce({}); // COMMIT

    const progressMessages: string[] = [];
    const result = await ingestGitHubIssues(issues, "org/repo", {}, (msg) =>
      progressMessages.push(msg)
    );

    expect(result.totalIssues).toBe(3);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.totalChunks).toBe(2);

    // First query is the batch SELECT
    expect(queryMock.mock.calls[0][0]).toContain("ANY($1)");

    // Progress callback was invoked
    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some((m) => m.includes("Issue #1"))).toBe(true);
  });
});
