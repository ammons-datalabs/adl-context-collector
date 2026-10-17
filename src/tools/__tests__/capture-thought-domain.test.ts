import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js");
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1]),
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("../../services/hasher.js", () => ({
  hashContent: vi.fn().mockReturnValue("hash-abc"),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 1 },
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn(() => []),
}));

const DOMAIN_PARAM = 2;

describe("captureThought domain fallback", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  /** Returns the domain written to the INSERT. Re-imports after stubbing env, because
   *  DOMAINS is resolved when types.ts is first evaluated. */
  async function domainWritten(
    metadata: Record<string, unknown> | null,
    args: Record<string, unknown> = {}
  ) {
    vi.resetModules();
    const db = (await import("../../db.js")) as unknown as typeof import("../../__mocks__/db.js");
    db.resetDbMock();
    const { extractMetadata } = await import("../../services/metadata-extractor.js");
    (extractMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(
      metadata === null
        ? null
        : { type: "thought", topics: [], people: [], action_items: [], dates: null, ...metadata }
    );
    const { captureThought } = await import("../capture-thought.js");
    await captureThought({ content: "a thought", ...args } as never);
    const insert = db.clientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO captures")
    );
    return (insert![1] as unknown[])[DOMAIN_PARAM];
  }

  it("falls back to 'general' when the extractor is disabled and general is configured", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "general,project,reference");
    expect(await domainWritten(null)).toBe("general");
  });

  it("writes null rather than an invalid label when general is not a configured domain", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,dedup,process");
    expect(await domainWritten(null)).toBeNull();
  });

  it("still drops a domain the extractor invented", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,dedup,process");
    expect(await domainWritten({ domain: "architecture" })).toBeNull();
  });

  it("keeps a configured domain from the extractor", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,dedup,process");
    expect(await domainWritten({ domain: "dedup" })).toBe("dedup");
  });

  it("prefers an explicit caller domain over everything", async () => {
    vi.stubEnv("COLLECTOR_DOMAINS", "platform,dedup,process");
    expect(await domainWritten({ domain: "dedup" }, { domain: "platform" })).toBe("platform");
  });
});
