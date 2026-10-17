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
  firstPrefix: string,
  startIndex: number,
  continuationPrefix = firstPrefix
): Chunk[] {
  const paragraphs = text.split("\n\n").filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let buffer = "";
  let index = startIndex;
  let prefix = firstPrefix;

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
      prefix = continuationPrefix;
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
  let frontmatter = "";

  // Sections below MIN_CHUNK_CHARS accumulate here instead of being dropped.
  let buffer: Array<{ crumb: string; text: string }> = [];

  // Extract frontmatter
  let lineStart = 0;
  if (lines[0]?.trim() === "---") {
    const fmEnd = lines.indexOf("---", 1);
    if (fmEnd > 0) {
      frontmatter = lines.slice(0, fmEnd + 1).join("\n");
      lineStart = fmEnd + 1;
    }
  }

  // A section's heading goes inline wherever it differs from the one stated before it.
  function bufferText(lead: string): string {
    return buffer
      .map(({ crumb, text }, i) => {
        const previous = i === 0 ? lead : buffer[i - 1].crumb;
        return crumb && crumb !== previous ? crumb + "\n\n" + text : text;
      })
      .join("\n\n");
  }

  function emit(): void {
    const firstCrumb = buffer[0].crumb;
    const prefix = (chunks.length === 0 && frontmatter ? frontmatter + "\n\n" : "") +
      (firstCrumb ? firstCrumb + "\n\n" : "");
    const text = bufferText(firstCrumb);
    const fullContent = prefix + text;

    if (fullContent.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        content: fullContent,
        index: chunks.length,
        metadata: { heading: firstCrumb || undefined },
      });
    } else {
      // Continuations belong to the last section, which is what overflowed.
      const lastCrumb = buffer[buffer.length - 1].crumb;
      const continuationPrefix = lastCrumb ? lastCrumb + "\n\n" : "";
      const parts = splitOnParagraphs(text, prefix, chunks.length, continuationPrefix);
      parts.forEach((sc, i) => {
        sc.metadata.heading = (i === 0 ? firstCrumb : lastCrumb) || undefined;
        chunks.push(sc);
      });
    }

    buffer = [];
  }

  function flushSection(): void {
    const text = currentLines.join("\n").trim();
    currentLines = [];
    if (text.length === 0) return;

    buffer.push({ crumb: buildBreadcrumb(headingStack), text });

    if (bufferText(buffer[0].crumb).length >= MIN_CHUNK_CHARS) emit();
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

  if (buffer.length > 0) {
    const last = chunks[chunks.length - 1];
    const tail = (buffer[0].crumb ? buffer[0].crumb + "\n\n" : "") + bufferText(buffer[0].crumb);
    // Attach a sub-floor remainder rather than emit the tiny chunk the floor prevents.
    if (last && last.content.length + tail.length + 2 <= MAX_CHUNK_CHARS) {
      last.content += "\n\n" + tail;
    } else {
      emit();
    }
  }

  return chunks;
}
