import { describe, it, expect } from "vitest";
import { chunkText } from "../chunkers/text.js";

describe("chunkText", () => {
  it("creates a single chunk for short content", () => {
    const content = "A short paragraph that has enough words to meet the minimum chunk size threshold for processing. This additional sentence ensures the total character count comfortably exceeds the two-hundred character minimum required by the chunker.";
    const chunks = chunkText(content, "notes.txt");
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("[Source: notes.txt]");
    expect(chunks[0].content).toContain("short paragraph");
    expect(chunks[0].index).toBe(0);
  });

  it("groups paragraphs up to MAX_CHUNK_CHARS", () => {
    const paragraphs = Array.from(
      { length: 5 },
      (_, i) => `Paragraph ${i}: ${"content ".repeat(50)}`
    ).join("\n\n");
    const chunks = chunkText(paragraphs, "file.txt");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain("[Source: file.txt]");
  });

  it("splits on paragraph boundaries for long content", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}: ${"word ".repeat(100)}`
    ).join("\n\n");
    const chunks = chunkText(paragraphs, "long.txt");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("only prefixes source on first chunk", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}: ${"word ".repeat(100)}`
    ).join("\n\n");
    const chunks = chunkText(paragraphs, "multi.txt");
    expect(chunks[0].content).toContain("[Source: multi.txt]");
    if (chunks.length > 1) {
      expect(chunks[1].content).not.toContain("[Source:");
    }
  });

  it("skips empty paragraphs", () => {
    const content = "Real content that has enough words to meet the minimum chunk size threshold for processing in the text chunker pipeline.\n\n\n\n\n\nMore real content here that also contributes enough length to clear the minimum character requirement easily.";
    const chunks = chunkText(content, "sparse.txt");
    expect(chunks.length).toBe(1);
  });
});
