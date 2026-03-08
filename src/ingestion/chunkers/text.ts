import type { Chunk } from "../types.js";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, OVERLAP_CHARS } from "../types.js";
import { hardSplit } from "./utils.js";

export function chunkText(content: string, fileName: string): Chunk[] {
  const paragraphs = content
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const sourcePrefix = `[Source: ${fileName}]\n\n`;
  const chunks: Chunk[] = [];
  let buffer = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const prefix = chunkIndex === 0 ? sourcePrefix : "";
    const candidate = buffer ? buffer + "\n\n" + para : para;

    if (prefix.length + candidate.length > MAX_CHUNK_CHARS && buffer.length > 0) {
      const fullContent = (chunkIndex === 0 ? sourcePrefix : "") + buffer;
      if (fullContent.length > MAX_CHUNK_CHARS) {
        for (const part of hardSplit(fullContent, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
          chunks.push({ content: part, index: chunkIndex++, metadata: {} });
        }
      } else if (fullContent.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push({ content: fullContent, index: chunkIndex++, metadata: {} });
      }
      buffer = para;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim().length > 0) {
    const fullContent = (chunkIndex === 0 ? sourcePrefix : "") + buffer;
    if (fullContent.length > MAX_CHUNK_CHARS) {
      for (const part of hardSplit(fullContent, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
        chunks.push({ content: part, index: chunkIndex++, metadata: {} });
      }
    } else if (fullContent.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({ content: fullContent, index: chunkIndex++, metadata: {} });
    }
  }

  return chunks;
}
