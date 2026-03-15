import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../resolve-api-key.js", () => ({
  resolveApiKey: vi.fn().mockReturnValue("sk-test"),
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
    const result = await extractMetadata("some text");
    expect(result).toBeNull();
  });
});
