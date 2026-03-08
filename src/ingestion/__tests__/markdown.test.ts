import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../chunkers/markdown.js";

// MIN_CHUNK_CHARS is 200, so test body text must exceed that threshold.
const PAD = " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.";

describe("chunkMarkdown", () => {
  it("creates a single chunk for short content with no headings", () => {
    const content = "This is a short paragraph with enough text to pass the minimum threshold for chunking purposes." + PAD;
    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("short paragraph");
    expect(chunks[0].index).toBe(0);
  });

  it("splits on h2 headings with breadcrumb prefix", () => {
    const content = [
      "# My Document",
      "",
      "Intro text that is long enough to be a meaningful chunk on its own with sufficient content." + PAD,
      "",
      "## Section A",
      "",
      "Content for section A that is long enough to be a meaningful chunk on its own with sufficient content." + PAD,
      "",
      "## Section B",
      "",
      "Content for section B that is long enough to be a meaningful chunk on its own with sufficient content." + PAD,
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(3);
    expect(chunks[0].content).toContain("# My Document");
    expect(chunks[0].content).toContain("Intro text");
    expect(chunks[1].content).toContain("# My Document > ## Section A");
    expect(chunks[1].content).toContain("Content for section A");
    expect(chunks[2].content).toContain("# My Document > ## Section B");
  });

  it("builds nested breadcrumbs for h3 under h2", () => {
    const content = [
      "# Doc",
      "",
      "Intro text that has enough content to pass the minimum chunk size threshold for processing." + PAD,
      "",
      "## Parent",
      "",
      "Parent content that has enough words to pass the minimum chunk size threshold for processing." + PAD,
      "",
      "### Child",
      "",
      "Child content that has enough words to pass the minimum chunk size threshold for processing." + PAD,
    ].join("\n");

    const chunks = chunkMarkdown(content);
    const childChunk = chunks.find((c) => c.content.includes("Child content"));
    expect(childChunk?.content).toContain("# Doc > ## Parent > ### Child");
  });

  it("resets breadcrumb when a new h2 follows an h3", () => {
    const content = [
      "# Doc",
      "",
      "Intro padding text that has enough content to be meaningful on its own as a standalone chunk." + PAD,
      "",
      "## First",
      "",
      "### Nested",
      "",
      "Nested content text that has enough content to be meaningful on its own as a standalone chunk here." + PAD,
      "",
      "## Second",
      "",
      "Second content text that has enough content to be meaningful on its own as a standalone chunk here." + PAD,
    ].join("\n");

    const chunks = chunkMarkdown(content);
    const secondChunk = chunks.find((c) =>
      c.content.includes("Second content")
    );
    expect(secondChunk?.content).toContain("# Doc > ## Second");
    expect(secondChunk?.content).not.toContain("Nested");
  });

  it("skips chunks under MIN_CHUNK_CHARS", () => {
    const content = [
      "# Doc",
      "",
      "Tiny.",
      "",
      "## Real Section",
      "",
      "This section has enough content to pass the minimum chunk size threshold for real processing work." + PAD,
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.every((c) => !c.content.includes("Tiny."))).toBe(true);
    expect(chunks.some((c) => c.content.includes("Real Section"))).toBe(true);
  });

  it("prepends frontmatter to first chunk", () => {
    const content = [
      "---",
      "title: Test Doc",
      "date: 2026-01-01",
      "---",
      "",
      "# Heading",
      "",
      "Body text that has enough content to pass the minimum chunk size threshold for processing work." + PAD,
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks[0].content).toContain("title: Test Doc");
  });

  it("splits oversized sections on paragraph boundaries", () => {
    const longParagraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}: ${"word ".repeat(100)}`
    ).join("\n\n");
    const content = `# Doc\n\n## Big Section\n\n${longParagraphs}`;

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      if (chunk.content.includes("Paragraph")) {
        expect(chunk.content).toContain("# Doc > ## Big Section");
      }
    }
  });
});
