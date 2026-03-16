import type { GitHubIssue } from "../chunkers/github-issue.js";

/** Padding text to reliably exceed MIN_CHUNK_CHARS (200). */
export const PAD =
  " Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.";

export function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the widget rendering pipeline",
    body:
      "The widget rendering pipeline fails when given a null config object. We need to add a guard clause at the entry point and propagate defaults." +
      PAD,
    updatedAt: "2026-03-01T12:00:00Z",
    author: { login: "alice" },
    comments: [],
    ...overrides,
  };
}

export function substantiveComment(
  login: string,
  body: string,
  date = "2026-03-02T10:00:00Z"
) {
  return { author: { login }, body, createdAt: date };
}
