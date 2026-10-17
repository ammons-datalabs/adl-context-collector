import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../chunkers/markdown.js";

// MIN_CHUNK_CHARS is 200, so test body text must exceed that threshold.
const PAD = " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.";

const LONG_PARAGRAPHS = Array.from(
  { length: 20 },
  (_, i) => `Paragraph ${i}: ${"word ".repeat(100)}`
).join("\n\n");

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

  it("merges a section under MIN_CHUNK_CHARS into the next one", () => {
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
    expect(chunks.some((c) => c.content.includes("Tiny."))).toBe(true);
    expect(chunks.some((c) => c.content.includes("Real Section"))).toBe(true);
  });

  it("keeps each merged section's heading so its body stays attributed", () => {
    const content = [
      "# Digest",
      "",
      "## repo-a",
      "- 1 open issue",
      "",
      "## repo-b",
      "- 2 open issues",
      "",
      "## repo-c",
      "- 3 open issues",
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    const { content: c } = chunks[0];
    expect(c.indexOf("## repo-b")).toBeLessThan(c.indexOf("- 2 open issues"));
    expect(c.indexOf("- 2 open issues")).toBeLessThan(c.indexOf("## repo-c"));
  });

  it("emits one chunk when every section is under MIN_CHUNK_CHARS", () => {
    const content = [
      "---",
      "type: review",
      "---",
      "",
      "# PR 257",
      "",
      "Author: someone",
      "",
      "## Review - approved",
      "",
      "LGTM.",
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("type: review");
    expect(chunks[0].content).toContain("Author: someone");
    expect(chunks[0].content).toContain("LGTM.");
  });

  it("attaches a trailing short section to the preceding chunk", () => {
    const content = [
      "# Doc",
      "",
      "Intro text that is long enough to be a meaningful chunk on its own with sufficient content." + PAD,
      "",
      "## Footnote",
      "",
      "See above.",
    ].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("## Footnote");
    expect(chunks[0].content).toContain("See above.");
  });

  it("labels a long section's continuation chunks with its own breadcrumb after a short intro", () => {
    const content = `# Doc\n\nTiny intro.\n\n## Big Section\n\n${LONG_PARAGRAPHS}`;

    const [first, ...continuations] = chunkMarkdown(content);
    expect(continuations.length).toBeGreaterThan(0);
    expect(first.content.indexOf("Tiny intro.")).toBeLessThan(first.content.indexOf("# Doc > ## Big Section"));
    for (const chunk of continuations) {
      expect(chunk.metadata.heading).toBe("# Doc > ## Big Section");
      expect(chunk.content.startsWith("# Doc > ## Big Section")).toBe(true);
    }
  });

  it("keeps text before any heading out from under the section that follows it", () => {
    const content = `Intro line.\n\n## Big Section\n\n${LONG_PARAGRAPHS}`;

    const [first, ...continuations] = chunkMarkdown(content);
    expect(continuations.length).toBeGreaterThan(0);
    expect(first.content.startsWith("Intro line.")).toBe(true);
    expect(first.content.indexOf("Intro line.")).toBeLessThan(first.content.indexOf("## Big Section"));
    for (const chunk of continuations) expect(chunk.metadata.heading).toBe("## Big Section");
  });

  it("re-states a heading the text returns to after another one", () => {
    const content = ["## Alice", "Approved.", "", "## Bob", "Rejected.", "", "## Alice", "Withdrawn."].join("\n");

    const { content: c } = chunkMarkdown(content)[0];
    expect(c.indexOf("Rejected.")).toBeLessThan(c.lastIndexOf("## Alice"));
    expect(c.lastIndexOf("## Alice")).toBeLessThan(c.indexOf("Withdrawn."));
  });

  it("does not repeat the heading when merged sections share a breadcrumb", () => {
    const content = ["# Doc", "", "## Same", "", "short a", "", "## Same", "", "short b"].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content.split("## Same").length - 1).toBe(1);
    expect(chunks[0].content).toContain("short b");
  });

  it("gives a trailing short section its own chunk when the previous one is full", () => {
    const content = ["# Doc", "", "x".repeat(5990), "", "## Tail", "", "short."].join("\n");

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(2);
    expect(chunks[1].content).toContain("short.");
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(6000);
    }
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
