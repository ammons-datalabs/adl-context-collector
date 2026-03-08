import type { Chunk } from "../types.js";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, OVERLAP_CHARS } from "../types.js";
import { hardSplit } from "./utils.js";

interface HeadingEntry {
  level: number;
  text: string;
}

function buildBreadcrumb(stack: HeadingEntry[]): string {
  return stack.map((h) => `${"#".repeat(h.level)} ${h.text}`).join(" > ");
}

function splitOnParagraphs(
  text: string,
  prefix: string,
  startIndex: number
): Chunk[] {
  const paragraphs = text.split("\n\n").filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let buffer = "";
  let index = startIndex;

  for (const para of paragraphs) {
    const candidate = buffer ? buffer + "\n\n" + para : para;
    if (prefix.length + candidate.length > MAX_CHUNK_CHARS && buffer.length > 0) {
      const fullContent = prefix + buffer;
      if (fullContent.length > MAX_CHUNK_CHARS) {
        for (const part of hardSplit(fullContent, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
          chunks.push({ content: part, index: index++, metadata: {} });
        }
      } else {
        chunks.push({ content: fullContent, index: index++, metadata: {} });
      }
      buffer = para;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim().length > 0) {
    const fullContent = prefix + buffer;
    if (fullContent.length > MAX_CHUNK_CHARS) {
      for (const part of hardSplit(fullContent, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
        chunks.push({ content: part, index: index++, metadata: {} });
      }
    } else {
      chunks.push({ content: fullContent, index: index++, metadata: {} });
    }
  }

  return chunks;
}

export function chunkMarkdown(content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  const headingStack: HeadingEntry[] = [];
  let currentLines: string[] = [];
  let chunkIndex = 0;
  let frontmatter = "";

  // Extract frontmatter
  let lineStart = 0;
  if (lines[0]?.trim() === "---") {
    const fmEnd = lines.indexOf("---", 1);
    if (fmEnd > 0) {
      frontmatter = lines.slice(0, fmEnd + 1).join("\n");
      lineStart = fmEnd + 1;
    }
  }

  function flushSection(): void {
    const text = currentLines.join("\n").trim();
    currentLines = [];
    if (text.length < MIN_CHUNK_CHARS) return;

    const breadcrumb = buildBreadcrumb(headingStack);
    const prefix = (chunkIndex === 0 && frontmatter ? frontmatter + "\n\n" : "") +
      (breadcrumb ? breadcrumb + "\n\n" : "");
    const fullContent = prefix + text;

    if (fullContent.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        content: fullContent,
        index: chunkIndex++,
        metadata: { heading: breadcrumb || undefined },
      });
    } else {
      const subChunks = splitOnParagraphs(text, prefix, chunkIndex);
      for (const sc of subChunks) {
        sc.metadata.heading = breadcrumb || undefined;
        chunks.push(sc);
      }
      chunkIndex += subChunks.length;
    }
  }

  for (let i = lineStart; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      flushSection();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Pop headings at same or deeper level
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level, text: headingText });
    } else {
      currentLines.push(line);
    }
  }

  flushSection();
  return chunks;
}
