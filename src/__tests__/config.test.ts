import { describe, it, expect, beforeEach, vi } from "vitest";

describe("config-driven domains", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses default personal domains when BRAIN_DOMAINS is not set", async () => {
    vi.stubEnv("BRAIN_DOMAINS", "");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toContain("finance");
    expect(DOMAINS).toContain("property");
    expect(DOMAINS.length).toBe(7);
  });

  it("parses BRAIN_DOMAINS from environment", async () => {
    vi.stubEnv("BRAIN_DOMAINS", "platform,taxonomy,ingestion");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy", "ingestion"]);
  });

  it("trims whitespace from domain values", async () => {
    vi.stubEnv("BRAIN_DOMAINS", " platform , taxonomy , ingestion ");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy", "ingestion"]);
  });

  it("ignores empty segments in BRAIN_DOMAINS", async () => {
    vi.stubEnv("BRAIN_DOMAINS", "platform,,taxonomy,");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy"]);
  });

  it("uses default capture types when BRAIN_CAPTURE_TYPES is not set", async () => {
    vi.stubEnv("BRAIN_CAPTURE_TYPES", "");
    const { CAPTURE_TYPES } = await import("../types.js");
    expect(CAPTURE_TYPES).toContain("thought");
    expect(CAPTURE_TYPES).toContain("decision");
    expect(CAPTURE_TYPES.length).toBe(8);
  });

  it("parses BRAIN_CAPTURE_TYPES from environment", async () => {
    vi.stubEnv("BRAIN_CAPTURE_TYPES", "thought,decision,note");
    const { CAPTURE_TYPES } = await import("../types.js");
    expect(CAPTURE_TYPES).toEqual(["thought", "decision", "note"]);
  });
});
