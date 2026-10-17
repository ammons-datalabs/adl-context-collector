import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../resolve-api-key.js", () => ({
  resolveApiKey: vi.fn().mockReturnValue("sk-test"),
}));
vi.mock("../local-metadata.js", () => ({
  extractMetadataLocal: vi.fn(),
}));

describe("extractMetadata", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns null when metadataExtractor is disabled", async () => {
    const { loadConfig } = await import("../../config.js");
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      metadataExtractor: { enabled: false, url: "", model: "", apiKey: null },
    });
    const { extractMetadata } = await import("../metadata-extractor.js");
    const result = await extractMetadata("some text", [0.1]);
    expect(result).toBeNull();
  });

  it("classifies locally without a network call when the provider is local", async () => {
    const { loadConfig } = await import("../../config.js");
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      metadataExtractor: {
        enabled: true,
        provider: "local",
        url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        apiKey: "env:OPENAI_API_KEY",
      },
      embedder: { url: "http://e", model: "m", dimensions: 1 },
    });
    const local = { type: null, domain: "dedup", topics: [], people: [], action_items: [], dates: {} };
    const { extractMetadataLocal } = await import("../local-metadata.js");
    (extractMetadataLocal as ReturnType<typeof vi.fn>).mockResolvedValue(local);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));

    const { extractMetadata } = await import("../metadata-extractor.js");
    const result = await extractMetadata("some text", [0.1]);

    expect(result).toBe(local);
    expect(extractMetadataLocal).toHaveBeenCalledWith("some text", [0.1], {
      url: "http://e",
      model: "m",
      dimensions: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
