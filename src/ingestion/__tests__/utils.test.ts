import { describe, it, expect } from "vitest";
import { hardSplit } from "../chunkers/utils.js";

describe("hardSplit", () => {
  it("returns text unchanged if under max length", () => {
    const result = hardSplit("short text", 100, 20);
    expect(result).toEqual(["short text"]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "A".repeat(150);
    const result = hardSplit(text, 100, 20);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(100);
    // Second chunk starts at 80 (100 - 20 overlap)
    expect(result[1].length).toBe(70); // 150 - 80
  });

  it("handles exact multiple of chunk size", () => {
    const text = "A".repeat(200);
    const result = hardSplit(text, 100, 20);
    // Chunk 1: 0-100, Chunk 2: 80-180, Chunk 3: 160-200
    expect(result.length).toBe(3);
  });

  it("preserves content across splits", () => {
    const text = "abcdefghij";
    const result = hardSplit(text, 6, 2);
    // Chunk 1: "abcdef" (0-6), Chunk 2: "efghij" (4-10)
    expect(result).toEqual(["abcdef", "efghij"]);
  });
});
