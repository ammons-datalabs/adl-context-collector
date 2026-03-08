import { describe, it, expect } from "vitest";
import { chunkPdfPages } from "../chunkers/pdf.js";

describe("chunkPdfPages", () => {
  it("creates one chunk per page for normal pages", () => {
    const pages = [
      "Page one content that has enough text to be a meaningful chunk for embedding purposes and search quality. Adding more words to get past the two hundred character minimum threshold for chunk processing.",
      "Page two content that has enough text to be a meaningful chunk for embedding purposes and search quality. Adding more words to get past the two hundred character minimum threshold for chunk processing.",
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain("[Page 1]");
    expect(chunks[0].content).toContain("Page one");
    expect(chunks[1].content).toContain("[Page 2]");
  });

  it("merges short pages with next page", () => {
    const pages = [
      "Title Page",  // Too short, should merge
      "Real content that has enough text to be a meaningful chunk for embedding purposes and search quality. Adding more words to get past the two hundred character minimum threshold for chunk processing.",
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("[Pages 1-2]");
    expect(chunks[0].content).toContain("Title Page");
    expect(chunks[0].content).toContain("Real content");
  });

  it("detects mid-paragraph page breaks and merges", () => {
    const pages = [
      "This sentence continues on the next page without any ending punctuation and it keeps going with enough words to be meaningful for the embedding",
      "and here is the rest of the paragraph that completes the thought. Then a new paragraph starts with enough text for chunking to work properly with the minimum threshold met.",
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("[Pages 1-2]");
  });

  it("does not merge when page ends with terminal punctuation", () => {
    const pages = [
      "This is a complete sentence that ends properly with enough text to pass the minimum size threshold for proper chunk processing in the embedding pipeline. We add even more filler text so this exceeds two hundred characters easily.",
      "This is a new page with its own content that has enough text to pass the minimum size threshold for proper chunk processing in the embedding pipeline here. We add even more filler text so this exceeds two hundred characters easily.",
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBe(2);
  });

  it("splits oversized pages on paragraph boundaries", () => {
    const longPage = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}: ${"word ".repeat(100)}`
    ).join("\n\n");
    const pages = [longPage];
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content).toContain("[Page 1]");
  });

  it("assigns sequential chunk indices", () => {
    const pages = [
      "Page one content that has enough text to be a meaningful chunk for embedding and search quality purposes. Additional words to ensure we pass the minimum character threshold requirement of two hundred characters total.",
      "Page two content that has enough text to be a meaningful chunk for embedding and search quality purposes. Additional words to ensure we pass the minimum character threshold requirement of two hundred characters total.",
      "Page three content that has enough text to be a meaningful chunk for embedding and search quality purposes. Additional words to ensure we pass the minimum character threshold requirement of two hundred characters.",
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});
