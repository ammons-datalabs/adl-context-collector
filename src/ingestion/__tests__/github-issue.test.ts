import { describe, it, expect } from "vitest";
import { chunkGitHubIssue } from "../chunkers/github-issue.js";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS } from "../types.js";
import { PAD, makeIssue, substantiveComment } from "./github-fixtures.js";

describe("chunkGitHubIssue", () => {
  it("creates a single root chunk for an issue with body and no comments", () => {
    const issue = makeIssue();
    const chunks = chunkGitHubIssue(issue);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("[Issue #42: Fix the widget rendering pipeline]");
    expect(chunks[0].content).toContain("null config object");
    expect(chunks[0].index).toBe(0);
  });

  it("creates root + comment chunks for an issue with 2 substantive comments", () => {
    const issue = makeIssue({
      comments: [
        substantiveComment(
          "bob",
          "I traced this to the ConfigLoader module — it never checks for undefined before accessing .theme. We should add a fallback object." +
            PAD,
          "2026-03-02T10:00:00Z"
        ),
        substantiveComment(
          "carol",
          "Confirmed the fix works after adding a default config spread. I also added a regression test in widget.test.ts to prevent future breakage." +
            PAD,
          "2026-03-03T14:00:00Z"
        ),
      ],
    });

    const chunks = chunkGitHubIssue(issue);

    expect(chunks).toHaveLength(3);
    // Root chunk
    expect(chunks[0].content).toContain("[Issue #42:");
    expect(chunks[0].content).toContain("null config object");
    // First comment
    expect(chunks[1].content).toContain("Comment by @bob (2026-03-02):");
    expect(chunks[1].content).toContain("ConfigLoader module");
    // Second comment
    expect(chunks[2].content).toContain("Comment by @carol (2026-03-03):");
    expect(chunks[2].content).toContain("regression test");
  });

  it("filters out noise comments (short and emoji-only)", () => {
    const issue = makeIssue({
      comments: [
        substantiveComment("bot", "+1"),
        substantiveComment("fan", "👍🎉"),
        substantiveComment("troll", "lol"),
        substantiveComment(
          "helpful",
          "This is actually caused by a race condition in the event loop during hydration. The fix should debounce the config resolution step." +
            PAD,
        ),
      ],
    });

    const chunks = chunkGitHubIssue(issue);

    // Root + 1 real comment; the 3 noise comments are filtered out
    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).toContain("@helpful");
    expect(chunks[1].content).toContain("race condition");
  });

  it("groups short consecutive comments into a conversation chunk", () => {
    // Each comment is over 50 chars (passes noise filter) but under MIN_CHUNK_CHARS
    const shortBody = "I can reproduce this on the staging environment consistently when I toggle themes."; // ~82 chars
    const issue = makeIssue({
      comments: [
        substantiveComment("alice", shortBody, "2026-03-02T10:00:00Z"),
        substantiveComment(
          "bob",
          "Same here — happens every time I switch between dark and light mode quickly.",
          "2026-03-02T11:00:00Z"
        ),
        substantiveComment(
          "carol",
          "I think the debounce timer is too short on the theme change handler, causing overlap.",
          "2026-03-02T12:00:00Z"
        ),
      ],
    });

    const chunks = chunkGitHubIssue(issue);

    // Root chunk + 1 grouped conversation chunk (all 3 comments are short)
    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).toContain("Conversation");
    expect(chunks[1].content).toContain("@alice");
    expect(chunks[1].content).toContain("@bob");
    expect(chunks[1].content).toContain("@carol");
  });

  it("skips issue with empty body when title alone is under MIN_CHUNK_CHARS", () => {
    const issue = makeIssue({ body: "" });
    const chunks = chunkGitHubIssue(issue);

    // Title prefix "[Issue #42: Fix the widget rendering pipeline]" is ~49 chars — under 200
    expect(chunks).toHaveLength(0);
  });

  it("splits oversized body with hardSplit preserving prefix", () => {
    const hugeBody = "Word ".repeat(2000); // ~10000 chars, well over MAX_CHUNK_CHARS
    const issue = makeIssue({ body: hugeBody });
    const chunks = chunkGitHubIssue(issue);

    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should start with the issue prefix
    expect(chunks[0].content).toContain("[Issue #42:");
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("formats comment chunk prefix correctly", () => {
    const issue = makeIssue({
      comments: [
        substantiveComment(
          "dave",
          "After reviewing the stack trace it looks like the null dereference occurs in renderWidget line 47, inside the theme resolution closure." +
            PAD,
          "2026-03-05T09:30:00Z"
        ),
      ],
    });

    const chunks = chunkGitHubIssue(issue);

    expect(chunks).toHaveLength(2);
    const commentChunk = chunks[1];
    expect(commentChunk.content).toMatch(
      /^\[Issue #42: Fix the widget rendering pipeline\] Comment by @dave \(2026-03-05\):\n\n/
    );
    expect(commentChunk.content).toContain("stack trace");
  });
});
