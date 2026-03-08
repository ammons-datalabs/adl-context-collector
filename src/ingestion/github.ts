import { query } from "../db.js";
import { generateEmbedding } from "../services/embedder.js";
import { extractMetadata } from "../services/metadata-extractor.js";
import { hashContent } from "../services/hasher.js";
import { chunkGitHubIssue, type GitHubIssue } from "./chunkers/github-issue.js";
import type { Chunk } from "./types.js";

export interface IngestGitHubOptions {
  domain?: string;
  dryRun?: boolean;
}

export interface IngestGitHubResult {
  totalIssues: number;
  ingested: number;
  skipped: number;
  failed: number;
  totalChunks: number;
}

function issueSourcePath(repo: string, issueNumber: number): string {
  return `github://${repo}/issues/${issueNumber}`;
}

async function processChunk(
  chunk: Chunk,
  sourcePath: string,
  domainOverride?: string
): Promise<"inserted" | "duplicate" | "failed"> {
  try {
    const contentHash = hashContent(chunk.content);

    const [embedding, metadata] = await Promise.all([
      generateEmbedding(chunk.content),
      extractMetadata(chunk.content),
    ]);

    const domain = domainOverride ?? metadata.domain;

    const result = await query(
      `INSERT INTO captures
        (content, embedding, type, domain, topics, people, action_items, dates,
         source_file, source_section, source_type, chunk_index, content_hash)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id`,
      [
        chunk.content,
        JSON.stringify(embedding),
        metadata.type,
        domain,
        metadata.topics,
        metadata.people,
        metadata.action_items,
        JSON.stringify(metadata.dates),
        sourcePath,
        chunk.metadata.heading ?? chunk.metadata.sourceLabel ?? null,
        "github_issue_import",
        chunk.index,
        contentHash,
      ]
    );

    return result.rowCount && result.rowCount > 0 ? "inserted" : "duplicate";
  } catch {
    return "failed";
  }
}

export async function ingestGitHubIssue(
  issue: GitHubIssue,
  repo: string,
  options: IngestGitHubOptions = {}
): Promise<{ status: "ingested" | "skipped" | "failed"; chunkCount: number }> {
  const sourcePath = issueSourcePath(repo, issue.number);

  // Change detection via updated_at stored in sources.notes
  const existing = await query(
    "SELECT notes FROM sources WHERE file_path = $1",
    [sourcePath]
  );

  if (existing.rows.length > 0 && existing.rows[0].notes === issue.updatedAt) {
    return { status: "skipped", chunkCount: 0 };
  }

  // Issue changed or is new — delete old chunks if re-ingesting
  if (existing.rows.length > 0) {
    await query("DELETE FROM captures WHERE source_file = $1", [sourcePath]);
  }

  const chunks = chunkGitHubIssue(issue);

  if (options.dryRun) {
    return { status: "ingested", chunkCount: chunks.length };
  }

  let failedChunks = 0;
  let skippedDuplicates = 0;

  for (const chunk of chunks) {
    const result = await processChunk(chunk, sourcePath, options.domain);
    if (result === "failed") failedChunks++;
    if (result === "duplicate") skippedDuplicates++;
  }

  const insertedCount = chunks.length - failedChunks - skippedDuplicates;

  // Upsert sources table — store updated_at in notes for change tracking
  await query(
    `INSERT INTO sources (file_path, file_hash, capture_count, last_imported, notes)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (file_path)
     DO UPDATE SET file_hash = $2, capture_count = $3, last_imported = NOW(), notes = $4`,
    [sourcePath, `issue:${issue.number}`, insertedCount, issue.updatedAt]
  );

  return {
    status: failedChunks === chunks.length ? "failed" : "ingested",
    chunkCount: chunks.length,
  };
}

export async function ingestGitHubIssues(
  issues: GitHubIssue[],
  repo: string,
  options: IngestGitHubOptions = {},
  onProgress?: (message: string) => void
): Promise<IngestGitHubResult> {
  const result: IngestGitHubResult = {
    totalIssues: issues.length,
    ingested: 0,
    skipped: 0,
    failed: 0,
    totalChunks: 0,
  };

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    onProgress?.(
      `[${i + 1}/${issues.length}] Issue #${issue.number}: ${issue.title}...`
    );

    const issueResult = await ingestGitHubIssue(issue, repo, options);

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
