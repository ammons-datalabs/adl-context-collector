import type { Chunk } from "../types.js";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, OVERLAP_CHARS } from "../types.js";
import { hardSplit } from "./utils.js";

const TERMINAL_PUNCTUATION = /[.!?:;)\]"']\s*$/;

interface MergedPage {
  text: string;
  startPage: number;
  endPage: number;
}

function mergePages(pages: string[]): MergedPage[] {
  if (pages.length === 0) return [];

  const merged: MergedPage[] = [];
  let currentText = pages[0];
  let startPage = 1;

  for (let i = 1; i < pages.length; i++) {
    const prevText = currentText.trim();
    const nextText = pages[i].trim();
    const isMidParagraph = prevText.length > 0 && !TERMINAL_PUNCTUATION.test(prevText);
    const isShortPage = prevText.length < MIN_CHUNK_CHARS;

    if (isMidParagraph || isShortPage) {
      currentText = currentText.trim() + "\n\n" + nextText;
    } else {
      merged.push({ text: currentText.trim(), startPage, endPage: i });
      currentText = nextText;
      startPage = i + 1;
    }
  }

  merged.push({ text: currentText.trim(), startPage, endPage: pages.length });
  return merged;
}

export function chunkPdfPages(pages: string[]): Chunk[] {
  const mergedPages = mergePages(pages);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const mp of mergedPages) {
    if (mp.text.length < MIN_CHUNK_CHARS) continue;

    const pageLabel =
      mp.startPage === mp.endPage
        ? `[Page ${mp.startPage}]`
        : `[Pages ${mp.startPage}-${mp.endPage}]`;
    const prefix = pageLabel + "\n\n";
    const fullContent = prefix + mp.text;

    if (fullContent.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        content: fullContent,
        index: chunkIndex++,
        metadata: {
          page: mp.startPage - 1,
          pageEnd: mp.endPage - 1,
        },
      });
    } else {
      const paragraphs = mp.text.split("\n\n").filter((p) => p.trim().length > 0);
      let buffer = "";

      for (const para of paragraphs) {
        const candidate = buffer ? buffer + "\n\n" + para : para;
        if (prefix.length + candidate.length > MAX_CHUNK_CHARS && buffer.length > 0) {
          const content = prefix + buffer;
          if (content.length > MAX_CHUNK_CHARS) {
            for (const part of hardSplit(content, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
              chunks.push({
                content: part,
                index: chunkIndex++,
                metadata: { page: mp.startPage - 1, pageEnd: mp.endPage - 1 },
              });
            }
          } else {
            chunks.push({
              content,
              index: chunkIndex++,
              metadata: { page: mp.startPage - 1, pageEnd: mp.endPage - 1 },
            });
          }
          buffer = para;
        } else {
          buffer = candidate;
        }
      }

      if (buffer.trim().length > 0) {
        const content = prefix + buffer;
        if (content.length > MAX_CHUNK_CHARS) {
          for (const part of hardSplit(content, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
            chunks.push({
              content: part,
              index: chunkIndex++,
              metadata: { page: mp.startPage - 1, pageEnd: mp.endPage - 1 },
            });
          }
        } else {
          chunks.push({
            content,
            index: chunkIndex++,
            metadata: { page: mp.startPage - 1, pageEnd: mp.endPage - 1 },
          });
        }
      }
    }
  }

  return chunks;
}
