import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../db.js");
vi.mock("../services/embedder.js", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

describe("searchContext similarity threshold", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tempDir = join(tmpdir(), `search-context-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Run a search against a given config and report the threshold it sent to SQL. */
  async function thresholdSentToSql(
    partial: Record<string, unknown>,
    args: Record<string, unknown> = {}
  ): Promise<number> {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify(partial));
    vi.stubEnv("COLLECTOR_CONFIG", configPath);

    const db = await import("../db.js");
    const query = db.query as unknown as ReturnType<typeof vi.fn>;
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const { searchContext } = await import("../tools/search-context.js");
    await searchContext({ query: "anything", ...args });

    return query.mock.calls[0][1][4] as number;
  }

  it("defaults to 0.3 when the config sets no threshold", async () => {
    expect(await thresholdSentToSql({})).toBe(0.3);
  });

  it("uses search.min_similarity from the config", async () => {
    expect(await thresholdSentToSql({ search: { min_similarity: 0.65 } })).toBe(0.65);
  });

  it("applies the configured threshold to the facts query too", async () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ search: { min_similarity: 0.65 } }));
    vi.stubEnv("COLLECTOR_CONFIG", configPath);

    const db = await import("../db.js");
    const query = db.query as unknown as ReturnType<typeof vi.fn>;
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const { searchContext } = await import("../tools/search-context.js");
    await searchContext({ query: "anything" });

    const factCall = query.mock.calls.find((c) => String(c[0]).includes("FROM facts f"));
    expect(factCall?.[1][4]).toBe(0.65);
  });

  it("lets an explicit argument override the configured threshold", async () => {
    const sent = await thresholdSentToSql(
      { search: { min_similarity: 0.65 } },
      { min_similarity: 0.1 }
    );
    expect(sent).toBe(0.1);
  });
});
