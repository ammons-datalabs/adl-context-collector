import { query } from "../db.js";
import { hashContent } from "../services/hasher.js";
import { chunkGitHubIssue, type GitHubIssue } from "./chunkers/github-issue.js";
import { processChunksBatch } from "./process-chunk.js";
import {
  SOURCE_TYPES,
  type IngestOptions,
  type IngestGitHubResult,
} from "./types.js";

function issueSourcePath(repo: string, issueNumber: number): string {
  return `github://${repo}/issues/${issueNumber}`;
}

/** Hash issue body + comments for content-based change detection (#6, #10). */
function hashIssueContent(issue: GitHubIssue): string {
  const content =
    issue.body +
    "\0" +
    issue.comments.map((c) => `${c.author.login}:${c.body}`).join("\0");
  return hashContent(content);
}

export async function ingestGitHubIssue(
  issue: GitHubIssue,
  repo: string,
  options: Pick<IngestOptions, "domain" | "dryRun"> = {},
  existingHash?: string | null
): Promise<{ status: "ingested" | "skipped" | "failed"; chunkCount: number }> {
  const sourcePath = issueSourcePath(repo, issue.number);
  const contentHash = hashIssueContent(issue);

  // --- Change detection (#6): content hash stored in file_hash column ---
  if (existingHash === undefined) {
    // Not pre-fetched — query individually
    const existing = await query(
      "SELECT file_hash FROM sources WHERE file_path = $1",
      [sourcePath]
    );
    existingHash = existing.rows.length > 0 ? existing.rows[0].file_hash : null;
  }

  if (existingHash === contentHash) {
    return { status: "skipped", chunkCount: 0 };
  }

  const chunks = chunkGitHubIssue(issue);

  // --- Zero-chunk fix (#4): short issues aren't failures ---
  if (chunks.length === 0) {
    return { status: "skipped", chunkCount: 0 };
  }

  if (options.dryRun) {
    return { status: "ingested", chunkCount: chunks.length };
  }

  // --- Data loss fix (#1): use transaction so DELETE is rolled back on failure ---
  await query("BEGIN");
  try {
    // Delete old captures if re-ingesting
    if (existingHash !== null) {
      await query("DELETE FROM captures WHERE source_file = $1", [sourcePath]);
    }

    // Process chunks with bounded concurrency (#8)
    const { failed: failedChunks } = await processChunksBatch(
      chunks,
      sourcePath,
      SOURCE_TYPES.GITHUB_ISSUE,
      options.domain
    );

    if (failedChunks === chunks.length) {
      // All chunks failed — rollback to restore old captures
      await query("ROLLBACK");
      return { status: "failed", chunkCount: chunks.length };
    }

    const insertedCount = chunks.length - failedChunks;

    // Upsert sources with content hash (#10)
    await query(
      `INSERT INTO sources (file_path, file_hash, capture_count, last_imported)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (file_path)
       DO UPDATE SET file_hash = $2, capture_count = $3, last_imported = NOW()`,
      [sourcePath, contentHash, insertedCount]
    );

    await query("COMMIT");

    return { status: "ingested", chunkCount: chunks.length };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}

export async function ingestGitHubIssues(
  issues: GitHubIssue[],
  repo: string,
  options: Pick<IngestOptions, "domain" | "dryRun"> = {},
  onProgress?: (message: string) => void
): Promise<IngestGitHubResult> {
  const result: IngestGitHubResult = {
    totalIssues: issues.length,
    ingested: 0,
    skipped: 0,
    failed: 0,
    totalChunks: 0,
  };

  // --- Batch change-detection (#9): single query instead of N ---
  const sourcePaths = issues.map((i) => issueSourcePath(repo, i.number));
  const existingRows = await query(
    "SELECT file_path, file_hash FROM sources WHERE file_path = ANY($1)",
    [sourcePaths]
  );
  const existingMap = new Map<string, string>(
    existingRows.rows.map((r: { file_path: string; file_hash: string }) => [
      r.file_path,
      r.file_hash,
    ])
  );

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    onProgress?.(
      `[${i + 1}/${issues.length}] Issue #${issue.number}: ${issue.title}...`
    );

    const sp = issueSourcePath(repo, issue.number);
    const existingHash = existingMap.get(sp) ?? null;
    const issueResult = await ingestGitHubIssue(
      issue,
      repo,
      options,
      existingHash
    );

    if (issueResult.status === "ingested") {
      result.ingested++;
      result.totalChunks += issueResult.chunkCount;
    } else if (issueResult.status === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
    }

    onProgress?.(`  → ${issueResult.status}: ${issueResult.chunkCount} chunks`);
  }

  return result;
}
