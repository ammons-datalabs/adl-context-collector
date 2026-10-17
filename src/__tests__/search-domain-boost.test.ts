import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../db.js");
vi.mock("../services/embedder.js", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

describe("domain as ranking boost", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tempDir = join(tmpdir(), `domain-boost-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  async function search(partial: Record<string, unknown>, args: Record<string, unknown>) {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify(partial));
    vi.stubEnv("COLLECTOR_CONFIG", configPath);

    const db = await import("../db.js");
    const query = db.query as unknown as ReturnType<typeof vi.fn>;
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    (db as unknown as { resetDbMock: () => void }).resetDbMock();

    const { searchContext } = await import("../tools/search-context.js");
    await searchContext({ query: "anything", ...args });

    const calls = query.mock.calls.map((c) => ({ sql: String(c[0]), params: c[1] as unknown[] }));
    const mocked = db as unknown as { clientQuery: ReturnType<typeof vi.fn> };
    const tx = mocked.clientQuery.mock.calls.map((c) => ({
      sql: String(c[0]),
      params: (c[1] ?? []) as unknown[],
    }));
    const all = [...calls, ...tx];
    return {
      facts: all.find((c) => c.sql.includes("FROM facts f"))!,
      captures: all.find((c) => c.sql.includes("FROM captures c"))!,
      all,
      tx,
    };
  }

  it("keeps domain as a hard filter when no boost is configured", async () => {
    const { captures } = await search({}, { domain: "dedup" });
    expect(captures.sql).toContain("c.domain = $4");
    expect(captures.sql).not.toMatch(/CASE WHEN (c\.)?domain/);
  });

  it("ranks by boosted score instead of excluding when a boost is set", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    expect(captures.sql).not.toContain("($4::text IS NULL OR c.domain = $4)");
    expect(captures.sql).toMatch(/CASE WHEN (c\.)?domain = \$4/);
    expect(captures.params).toContain(0.05);
  });

  it("casts the boost to float8, since ELSE 0 makes Postgres infer $7 as integer", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    expect(captures.sql).toContain("$7::float8");
  });

  it("applies the similarity floor to the raw score, so a boost cannot admit a weak result", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    const where = captures.sql.slice(captures.sql.indexOf("WHERE"), captures.sql.indexOf("ORDER BY"));
    // the boost belongs in the OUTER ordering, after the index-orderable arms
    const order = captures.sql.slice(captures.sql.lastIndexOf("ORDER BY"));
    // The floor compares the bare similarity expression; the boost lives only in ORDER BY.
    expect(where).toMatch(
      /AND 1 - \(ce\.embedding::vector\(\d+\) <=> \$1::vector\(\d+\)\) >= \$5/
    );
    expect(where).not.toContain("$7");
    expect(order).toContain("$7::float8");
  });

  it("leaves the facts query filtering hard, since fact domains are author-set", async () => {
    const { facts } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    expect(facts.sql).toContain("f.domain = $4");
    expect(facts.sql).not.toContain("CASE WHEN");
  });

  it("keeps each arm index-orderable, so the HNSW index is still usable", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    // pgvector serves the index only for ORDER BY <indexed expr> <=> <const>.
    const armOrderings = captures.sql.match(/ORDER BY ce\.embedding::vector\(\d+\) <=> \$1::vector\(\d+\)/g);
    expect(armOrderings).toHaveLength(2);
    expect(captures.sql).toContain("UNION");
  });

  it("takes `limit` candidates per arm, so the re-rank is exact over the candidates", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, { domain: "dedup" });
    expect(captures.sql.match(/LIMIT \$6/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("does not use a UNION when no boost is configured", async () => {
    const { captures } = await search({}, { domain: "dedup" });
    expect(captures.sql).not.toContain("UNION");
  });

  it.each([
    ["a hard filter", {}],
    ["a boost", { search: { domain_boost: 0.05 } }],
  ])("tunes the ANN scan for both queries under %s, since each post-filters", async (_name, config) => {
    const { tx } = await search(config, { domain: "dedup" });
    const set = tx.find((c) => c.sql.includes("hnsw.ef_search"));
    expect(set).toBeDefined();
    // SET cannot be parameterised; set_config with is_local = true is the bindable form.
    expect(set!.sql).toContain("set_config('hnsw.ef_search', $1, true)");
    expect(set!.sql).toContain("set_config('hnsw.iterative_scan', 'strict_order', true)");
    expect(set!.params).toContain("200");
    expect(tx.some((c) => c.sql.includes("FROM facts f"))).toBe(true);
    expect(tx.some((c) => c.sql.includes("FROM captures c"))).toBe(true);
  });

  it("leaves the ANN scan untuned when no domain is requested", async () => {
    const { all } = await search({ search: { domain_boost: 0.05 } }, {});
    expect(all.find((c) => c.sql.includes("hnsw."))).toBeUndefined();
  });

  it("ignores the boost when no domain is requested", async () => {
    const { captures } = await search({ search: { domain_boost: 0.05 } }, {});
    expect(captures.sql).not.toContain("UNION");
  });
});
