import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("config-driven domains", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses generic default domains when COLLECTOR_DOMAINS is not set", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toContain("general");
    expect(DOMAINS).toContain("project");
    expect(DOMAINS.length).toBe(3);
  });

  it("parses COLLECTOR_DOMAINS from environment", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,taxonomy,ingestion");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy", "ingestion"]);
  });

  it("trims whitespace from domain values", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", " platform , taxonomy , ingestion ");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy", "ingestion"]);
  });

  it("ignores empty segments in COLLECTOR_DOMAINS", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,,taxonomy,");
    const { DOMAINS } = await import("../types.js");
    expect(DOMAINS).toEqual(["platform", "taxonomy"]);
  });

  it("uses default capture types when COLLECTOR_CAPTURE_TYPES is not set", async () => {
    vi.stubEnv("COLLECTOR_CAPTURE_TYPES", "");
    const { CAPTURE_TYPES } = await import("../types.js");
    expect(CAPTURE_TYPES).toContain("thought");
    expect(CAPTURE_TYPES).toContain("decision");
    expect(CAPTURE_TYPES).toContain("review");
    expect(CAPTURE_TYPES.length).toBe(9);
  });

  it("parses COLLECTOR_CAPTURE_TYPES from environment", async () => {
    vi.stubEnv("COLLECTOR_CAPTURE_TYPES", "thought,decision,note");
    const { CAPTURE_TYPES } = await import("../types.js");
    expect(CAPTURE_TYPES).toEqual(["thought", "decision", "note"]);
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tempDir = join(tmpdir(), `context-collector-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Write a partial config JSON, stub COLLECTOR_CONFIG, and return the loaded config. */
  async function loadConfigWith(partial: Record<string, unknown>) {
    const configPath = join(tempDir, "test-config.json");
    writeFileSync(configPath, JSON.stringify(partial));
    vi.stubEnv("COLLECTOR_CONFIG", configPath);
    const { loadConfig } = await import("../config.js");
    return loadConfig();
  }

  // Was: "returns generic defaults when COLLECTOR_CONFIG is not set". The built-in
  // defaults point at OpenAI, so falling back to them silently sent vault content to a
  // remote endpoint whenever an invocation forgot the variable.
  it("refuses to run unconfigured rather than defaulting to the remote provider", async () => {
    vi.stubEnv("COLLECTOR_CONFIG", "");
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow(/COLLECTOR_CONFIG/);
  });

  it("names the remote endpoint it is refusing to default to", async () => {
    vi.stubEnv("COLLECTOR_CONFIG", "");
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow(/openai\.com/);
  });

  it("deep-merges partial config from JSON file", async () => {
    const config = await loadConfigWith({
      serverName: "work-collector",
      tools: {
        search_context: {
          description: "Search work knowledge."
        }
      }
    });
    expect(config.serverName).toBe("work-collector");
    expect(config.tools.search_context.description).toBe("Search work knowledge.");
    expect(config.tools.context_stats.description).toContain("statistics");
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

  // Was: "falls back to defaults when COLLECTOR_CONFIG points to nonexistent file". A
  // typo in the path is the same silent hand-off to the remote provider as no path at all.
  it("refuses when COLLECTOR_CONFIG points at a file that is not there", async () => {
    vi.stubEnv("COLLECTOR_CONFIG", join(tempDir, "nonexistent.json"));
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow(/nonexistent\.json/);
  });

  it("says the config file is missing rather than reporting a bare ENOENT", async () => {
    vi.stubEnv("COLLECTOR_CONFIG", join(tempDir, "nonexistent.json"));
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow(/openai\.com/);
  });

  it("throws on invalid JSON", async () => {
    const configPath = join(tempDir, "bad-config.json");
    writeFileSync(configPath, "{ not valid json }}}");
    vi.stubEnv("COLLECTOR_CONFIG", configPath);
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
      serverName: "test-collector",
      unknownTopLevel: true,
      tools: { search_context: { description: "Custom.", unknownField: 42 } }
    });
    expect(config.serverName).toBe("test-collector");
    expect(config.tools.search_context.description).toBe("Custom.");
  });

  it("merges top-level categories", async () => {
    const config = await loadConfigWith({
      categories: ["metric", "status", "blocker"]
    });
    expect(config.categories).toEqual(["metric", "status", "blocker"]);
  });

  // Reached through a config file that omits the block, which is how a real vault gets
  // them; loading with no COLLECTOR_CONFIG at all now throws.
  it("includes default embedder config", async () => {
    const config = await loadConfigWith({});
    expect(config.embedder.url).toBe("https://api.openai.com/v1/embeddings");
    expect(config.embedder.model).toBe("text-embedding-3-small");
    expect(config.embedder.dimensions).toBe(1536);
    expect(config.embedder.apiKey).toBe("env:OPENAI_API_KEY");
  });

  // Reached through a config file that omits the block, which is how a real vault gets
  // them; loading with no COLLECTOR_CONFIG at all now throws.
  it("includes default metadataExtractor config", async () => {
    const config = await loadConfigWith({});
    expect(config.metadataExtractor.enabled).toBe(true);
    expect(config.metadataExtractor.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(config.metadataExtractor.model).toBe("gpt-4o-mini");
    expect(config.metadataExtractor.apiKey).toBe("env:OPENAI_API_KEY");
  });

  it("deep-merges partial embedder override", async () => {
    const config = await loadConfigWith({
      embedder: { model: "nomic-embed-text", dimensions: 768 },
    });
    expect(config.embedder.model).toBe("nomic-embed-text");
    expect(config.embedder.dimensions).toBe(768);
    expect(config.embedder.url).toBe("https://api.openai.com/v1/embeddings");
    expect(config.embedder.apiKey).toBe("env:OPENAI_API_KEY");
  });

  it("allows disabling metadata extractor", async () => {
    const config = await loadConfigWith({
      metadataExtractor: { enabled: false },
    });
    expect(config.metadataExtractor.enabled).toBe(false);
    expect(config.metadataExtractor.model).toBe("gpt-4o-mini");
  });

  it("loads peopleFile from JSON config", async () => {
    const config = await loadConfigWith({
      peopleFile: "people.yaml",
    });
    expect(config.peopleFile).toBe("people.yaml");
  });

  it("defaults peopleFile to null when not in JSON config", async () => {
    const config = await loadConfigWith({});
    expect(config.peopleFile).toBeNull();
  });

  it("passes an indexSync block through verbatim from JSON config", async () => {
    const config = await loadConfigWith({
      indexSync: {
        include: ["projects/*", "meetings"],
        exclude: ["templates", "**/dashboard.md"],
      },
    });
    expect(config.indexSync).toEqual({
      include: ["projects/*", "meetings"],
      exclude: ["templates", "**/dashboard.md"],
    });
  });

  it("defaults indexSync to null when not in JSON config", async () => {
    const config = await loadConfigWith({});
    expect(config.indexSync).toBeNull();
  });

  it("passes additionalRoots through verbatim from JSON config", async () => {
    const config = await loadConfigWith({
      additionalRoots: [
        { root: "/abs/platforms-vault", include: ["**"], exclude: ["**/.git/**"] },
      ],
    });
    expect(config.additionalRoots).toEqual([
      { root: "/abs/platforms-vault", include: ["**"], exclude: ["**/.git/**"] },
    ]);
  });

  it("defaults additionalRoots to null when not in JSON config", async () => {
    const config = await loadConfigWith({});
    expect(config.additionalRoots).toBeNull();
  });

  it.each([
    [{ min_similarity: 1.5 }, /search\.min_similarity/],
    [{ min_similarity: -0.1 }, /search\.min_similarity/],
    [{ min_similarity: "0.5" }, /search\.min_similarity/],
    [{ min_similarity: null }, /search\.min_similarity/],
    [{ domain_boost: -1 }, /search\.domain_boost/],
    [{ domain_boost: "0.05" }, /search\.domain_boost/],
    [{ ef_search: 0 }, /search\.ef_search/],
    [{ ef_search: 1001 }, /search\.ef_search/],
    [{ ef_search: 40.5 }, /search\.ef_search/],
  ])("rejects an invalid search setting %j at load", async (search, message) => {
    await expect(loadConfigWith({ search })).rejects.toThrow(message);
  });

  // Identifier queries scale the boost by the floor, so a zero floor makes it infinite.
  it("rejects a domain boost paired with a zero floor", async () => {
    await expect(
      loadConfigWith({ search: { min_similarity: 0, domain_boost: 0.02 } })
    ).rejects.toThrow(/above 0 when search\.domain_boost/);
  });

  it("accepts a zero floor when nothing boosts", async () => {
    const config = await loadConfigWith({ search: { min_similarity: 0 } });
    expect(config.search.min_similarity).toBe(0);
  });
});
