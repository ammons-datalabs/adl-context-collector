import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("../../services/hasher.js", () => ({
  hashContent: vi.fn().mockReturnValue("hash-123"),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 3 },
    metadataExtractor: { enabled: true, provider: "openai", url: "http://x", model: "m", apiKey: null },
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn(() => []),
}));

const DOMAIN_ARG = 2;
const TYPE_ARG = 1;

describe("extractor output is validated against the configured vocabulary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,dedup,process");
    vi.stubEnv("COLLECTOR_CAPTURE_TYPES", "note,decision");
  });

  async function prepareWith(metadata: Record<string, unknown>) {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      topics: [],
      people: [],
      action_items: [],
      dates: null,
      ...metadata,
    });
    const { prepareChunk } = await import("../process-chunk.js");
    return prepareChunk(
      { content: "some content", index: 0, metadata: {} } as never,
      "/vault/note.md",
      "markdown" as never
    );
  }

  it("keeps a domain that is in the configured list", async () => {
    const prepared = await prepareWith({ domain: "dedup", type: "note" });
    expect(prepared!.captureArgs[DOMAIN_ARG]).toBe("dedup");
  });

  it("drops a domain the extractor invented", async () => {
    const prepared = await prepareWith({ domain: "architecture", type: "note" });
    expect(prepared!.captureArgs[DOMAIN_ARG]).toBeNull();
  });

  it("leaves an unlisted capture type alone, since nothing queries type", async () => {
    const prepared = await prepareWith({ domain: "dedup", type: "verbatim-transcript" });
    expect(prepared!.captureArgs[TYPE_ARG]).toBe("verbatim-transcript");
  });

  it("keeps an author's domain override even ahead of the extractor", async () => {
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      domain: "process", type: "note", topics: [], people: [], action_items: [], dates: null,
    });
    const { prepareChunk } = await import("../process-chunk.js");
    const prepared = await prepareChunk(
      { content: "some content", index: 0, metadata: {} } as never,
      "/vault/note.md",
      "markdown" as never,
      "platform"
    );
    expect(prepared!.captureArgs[DOMAIN_ARG]).toBe("platform");
  });

  it("still stores the capture, so an invalid label never costs searchability", async () => {
    const prepared = await prepareWith({ domain: "architecture", type: "note" });
    expect(prepared).not.toBeNull();
    expect(prepared!.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
