import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("config-driven domains", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses generic default domains when BRAIN_DOMAINS is not set", async () => {
    vi.stubEnv("BRAIN_DOMAINS", "");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toContain("general");
    expect(DOMAINS).toContain("project");
    expect(DOMAINS.length).toBe(3);
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

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tempDir = join(tmpdir(), `open-brain-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Write a partial config JSON, stub BRAIN_CONFIG, and return the loaded config. */
  async function loadConfigWith(partial: Record<string, unknown>) {
    const configPath = join(tempDir, "test-config.json");
    writeFileSync(configPath, JSON.stringify(partial));
    vi.stubEnv("BRAIN_CONFIG", configPath);
    const { loadConfig } = await import("../config.js");
    return loadConfig();
  }

  it("returns generic defaults when BRAIN_CONFIG is not set", async () => {
    vi.stubEnv("BRAIN_CONFIG", "");
    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.serverName).toBe("open-brain");
    expect(config.tools.search_brain.description).toContain("semantic similarity");
    expect(config.tools.save_fact.currencies).toBeNull();
    expect(config.tools.save_fact.units).toBeNull();
  });

  it("deep-merges partial config from JSON file", async () => {
    const config = await loadConfigWith({
      serverName: "work-brain",
      tools: {
        search_brain: {
          description: "Search work knowledge."
        }
      }
    });
    expect(config.serverName).toBe("work-brain");
    expect(config.tools.search_brain.description).toBe("Search work knowledge.");
    expect(config.tools.brain_stats.description).toContain("statistics");
    expect(config.tools.lookup_fact.keyExamples).toEqual(["project_status", "deploy_date"]);
  });

  it("treats empty currencies array as null", async () => {
    const config = await loadConfigWith({
      tools: { save_fact: { currencies: [] } }
    });
    expect(config.tools.save_fact.currencies).toBeNull();
  });

  it("treats empty units array as null", async () => {
    const config = await loadConfigWith({
      tools: { save_fact: { units: [] } }
    });
    expect(config.tools.save_fact.units).toBeNull();
  });

  it("preserves non-empty currencies as enum list", async () => {
    const config = await loadConfigWith({
      tools: { save_fact: { currencies: ["USD", "EUR"] } }
    });
    expect(config.tools.save_fact.currencies).toEqual(["USD", "EUR"]);
  });

  it("falls back to defaults when BRAIN_CONFIG points to nonexistent file", async () => {
    vi.stubEnv("BRAIN_CONFIG", join(tempDir, "nonexistent.json"));
    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.serverName).toBe("open-brain");
    expect(config.tools.save_fact.currencies).toBeNull();
  });

  it("throws on invalid JSON", async () => {
    const configPath = join(tempDir, "bad-config.json");
    writeFileSync(configPath, "{ not valid json }}}");
    vi.stubEnv("BRAIN_CONFIG", configPath);
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow();
  });

  it("produces describe text with no examples when keyExamples is empty", async () => {
    const config = await loadConfigWith({
      tools: { lookup_fact: { keyExamples: [] } }
    });
    expect(config.tools.lookup_fact.keyExamples).toEqual([]);
  });

  it("ignores unknown keys in config", async () => {
    const config = await loadConfigWith({
      serverName: "test-brain",
      unknownTopLevel: true,
      tools: { search_brain: { description: "Custom.", unknownField: 42 } }
    });
    expect(config.serverName).toBe("test-brain");
    expect(config.tools.search_brain.description).toBe("Custom.");
  });

  it("merges top-level categories", async () => {
    const config = await loadConfigWith({
      categories: ["metric", "status", "blocker"]
    });
    expect(config.categories).toEqual(["metric", "status", "blocker"]);
  });
});
