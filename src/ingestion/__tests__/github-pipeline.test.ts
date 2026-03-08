import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubIssue } from "../chunkers/github-issue.js";

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

const PAD =
  " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.";

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the widget rendering pipeline",
    body:
      "The widget rendering pipeline fails when given a null config object. We need to add a guard clause." +
      PAD,
    updatedAt: "2026-03-01T12:00:00Z",
    url: "https://github.com/org/repo/issues/42",
    labels: [{ name: "bug" }],
    author: { login: "alice" },
    comments: [],
    ...overrides,
  };
}

describe("ingestGitHubIssue", () => {
  let queryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const db = await import("../../db.js");
    queryMock = db.query as ReturnType<typeof vi.fn>;
    queryMock.mockReset();
  });

  it("skips an issue when updated_at matches sources.notes", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    queryMock.mockResolvedValueOnce({
      rows: [{ notes: "2026-03-01T12:00:00Z" }],
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
    // INSERT captures → inserted
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // INSERT sources (upsert)
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const result = await ingestGitHubIssue(makeIssue(), "org/repo");

    expect(result.status).toBe("ingested");
    expect(result.chunkCount).toBe(1);

    // Check the source path format
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall[1][8]).toBe("github://org/repo/issues/42"); // source_file
    expect(insertCall[1][10]).toBe("github_issue_import"); // source_type

    // Check the upsert stores updated_at in notes
    const upsertCall = queryMock.mock.calls[2];
    expect(upsertCall[1][3]).toBe("2026-03-01T12:00:00Z"); // notes = updatedAt
  });

  it("deletes old captures when re-ingesting a changed issue", async () => {
    const { ingestGitHubIssue } = await import("../github.js");

    // SELECT sources → existing with older updated_at
    queryMock.mockResolvedValueOnce({
      rows: [{ notes: "2026-02-01T00:00:00Z" }],
    });
    // DELETE old captures
    queryMock.mockResolvedValueOnce({ rowCount: 3 });
    // INSERT captures → inserted
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    // INSERT sources (upsert)
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const result = await ingestGitHubIssue(
      makeIssue({ updatedAt: "2026-03-08T12:00:00Z" }),
      "org/repo"
    );

    expect(result.status).toBe("ingested");

    // Verify DELETE was called for old captures
    const deleteCall = queryMock.mock.calls[1];
    expect(deleteCall[0]).toContain("DELETE FROM captures");
    expect(deleteCall[1][0]).toBe("github://org/repo/issues/42");
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
    // Only SELECT was called — no INSERT
    expect(queryMock).toHaveBeenCalledTimes(1);
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

    // Issue 1: skip (matching updated_at)
    queryMock.mockResolvedValueOnce({
      rows: [{ notes: "2026-03-01T00:00:00Z" }],
    });

    // Issue 2: new, ingest
    queryMock.mockResolvedValueOnce({ rows: [] }); // SELECT
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // INSERT captures
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPSERT sources

    // Issue 3: new, ingest
    queryMock.mockResolvedValueOnce({ rows: [] }); // SELECT
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // INSERT captures
    queryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPSERT sources

    const progressMessages: string[] = [];
    const result = await ingestGitHubIssues(issues, "org/repo", {}, (msg) =>
      progressMessages.push(msg)
    );

    expect(result.totalIssues).toBe(3);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.totalChunks).toBe(2);

    // Progress callback was invoked
    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some((m) => m.includes("Issue #1"))).toBe(true);
  });
});
