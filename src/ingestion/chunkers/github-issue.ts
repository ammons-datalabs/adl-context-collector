import type { Chunk } from "../types.js";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, OVERLAP_CHARS } from "../types.js";
import { hardSplit } from "./utils.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  updatedAt: string;
  url: string;
  labels: Array<{ name: string }>;
  author: { login: string };
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
  }>;
}

/**
 * Regex matching comments that are purely emoji, whitespace, and/or punctuation.
 * Covers common reactions like +1, 👍, 🎉, thumbs up text, etc.
 */
const PURE_EMOJI_RE =
  /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\p{So}+\-!?.,:;'"()]+$/u;

function isNoiseComment(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length < 50) return true;
  if (PURE_EMOJI_RE.test(trimmed)) return true;
  return false;
}

function issuePrefix(issue: GitHubIssue): string {
  return `[Issue #${issue.number}: ${issue.title}]`;
}

function commentPrefix(issue: GitHubIssue, comment: GitHubIssue["comments"][number]): string {
  const date = comment.createdAt.slice(0, 10); // YYYY-MM-DD
  return `${issuePrefix(issue)} Comment by @${comment.author.login} (${date}):`;
}

function pushChunks(
  content: string,
  chunks: Chunk[],
  nextIndex: number,
  metadata: Chunk["metadata"] = {}
): number {
  if (content.length > MAX_CHUNK_CHARS) {
    for (const part of hardSplit(content, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
      chunks.push({ content: part, index: nextIndex++, metadata: { ...metadata } });
    }
  } else if (content.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push({ content, index: nextIndex++, metadata: { ...metadata } });
  }
  return nextIndex;
}

export function chunkGitHubIssue(issue: GitHubIssue): Chunk[] {
  const chunks: Chunk[] = [];
  let idx = 0;

  // --- Root chunk: issue body ---
  const rootContent = `${issuePrefix(issue)}\n\n${issue.body}`.trim();
  idx = pushChunks(rootContent, chunks, idx);

  // --- Filter out noise comments ---
  const meaningful = issue.comments.filter((c) => !isNoiseComment(c.body));

  // --- Process comments with short-comment grouping ---
  let i = 0;
  while (i < meaningful.length) {
    const comment = meaningful[i];
    const commentBody = comment.body.trim();
    const prefix = commentPrefix(issue, comment);
    const full = `${prefix}\n\n${commentBody}`;

    // Check if this comment is "short" (under MIN_CHUNK_CHARS)
    if (full.length < MIN_CHUNK_CHARS) {
      // Start grouping consecutive short comments
      const grouped: string[] = [];
      while (i < meaningful.length) {
        const c = meaningful[i];
        const cPrefix = commentPrefix(issue, c);
        const cFull = `${cPrefix}\n\n${c.body.trim()}`;
        if (cFull.length >= MIN_CHUNK_CHARS && grouped.length > 0) {
          // This comment is long enough to stand alone; stop grouping
          break;
        }
        const date = c.createdAt.slice(0, 10);
        grouped.push(`@${c.author.login} (${date}):\n${c.body.trim()}`);
        i++;
        // If the grouped content already exceeds MIN_CHUNK_CHARS, check if next is also short
        const tentative = grouped.join("\n\n");
        if (tentative.length >= MIN_CHUNK_CHARS) {
          // Peek: if the next comment is also short, keep grouping; otherwise flush
          if (i < meaningful.length) {
            const nextC = meaningful[i];
            const nextPrefix = commentPrefix(issue, nextC);
            const nextFull = `${nextPrefix}\n\n${nextC.body.trim()}`;
            if (nextFull.length >= MIN_CHUNK_CHARS) {
              break; // next one stands alone
            }
            // next is also short — continue grouping
          }
        }
      }

      const conversationBody = grouped.join("\n\n");
      const conversationContent = `${issuePrefix(issue)} Conversation:\n\n${conversationBody}`;
      idx = pushChunks(conversationContent, chunks, idx);
    } else {
      // Comment is long enough to stand alone
      idx = pushChunks(full, chunks, idx);
      i++;
    }
  }

  return chunks;
}
