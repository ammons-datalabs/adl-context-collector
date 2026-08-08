import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js", () => ({ query: vi.fn() }));

const FACTS = [
  {
    domain: "ingestion",
    category: "metric",
    key: "openalex_feb_snapshot_count",
    value: "91,025,834",
    context: "February snapshot row count",
    as_of: "2026-07-07",
  },
  {
    domain: "ingestion",
    category: "location",
    key: "openalex_flat_archive_path",
    value: "/Volumes/Backup-16TB/flat-repeated",
    context: "Rebuild input for the canonical archive",
    as_of: "2026-07-08",
  },
];

// Stands in for Postgres: treats every `%…%` bound parameter as one term and
// matches a row when ANY term appears in key, value, or context.
function mockIlike(rows: typeof FACTS) {
  return async (_sql: string, params: unknown[]) => {
    const terms = (params ?? [])
      .filter((p): p is string => typeof p === "string" && p.startsWith("%") && p.endsWith("%"))
      .map((p) => p.slice(1, -1).toLowerCase());
    if (terms.length === 0) return { rows };
    return {
      rows: rows.filter((f) =>
        terms.some((t) => `${f.key} ${f.value} ${f.context}`.toLowerCase().includes(t))
      ),
    };
  };
}

describe("searchFacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds facts for a multi-term query when no single fact contains every term", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockIlike(FACTS));

    const { searchFacts } = await import("../search-facts.js");
    const res = await searchFacts({ search: "openalex feb flat archive rebuild canonical" });
    const text = res.content[0].text as string;

    expect(text).not.toBe("No facts found matching criteria.");
    expect(text).toContain("openalex_feb_snapshot_count");
    expect(text).toContain("openalex_flat_archive_path");
  });

  it("still matches a single-term query", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockIlike(FACTS));

    const { searchFacts } = await import("../search-facts.js");
    const res = await searchFacts({ search: "Backup-16TB" });
    const text = res.content[0].text as string;

    expect(text).toContain("openalex_flat_archive_path");
    expect(text).not.toContain("openalex_feb_snapshot_count");
  });

  // Ordering is decided by Postgres, so the reachable contract here is the SQL:
  // rank by per-term weighted hits, not alphabetically by domain.
  it("ranks by term coverage rather than domain order", async () => {
    const { query } = await import("../../db.js");
    const spy = query as ReturnType<typeof vi.fn>;
    spy.mockImplementation(mockIlike(FACTS));

    const { searchFacts } = await import("../search-facts.js");
    await searchFacts({ search: "openalex archive rebuild" });

    const sql = spy.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/ORDER BY domain, category, key/);
    expect(sql).toMatch(/ORDER BY \(.*CASE WHEN key ILIKE/s);
    expect((sql.match(/CASE WHEN key ILIKE/g) ?? []).length).toBe(3);
  });

  it("keeps alphabetical order when there is no search term", async () => {
    const { query } = await import("../../db.js");
    const spy = query as ReturnType<typeof vi.fn>;
    spy.mockImplementation(mockIlike(FACTS));

    const { searchFacts } = await import("../search-facts.js");
    await searchFacts({ domain: "ingestion" });

    expect(spy.mock.calls[0][0] as string).toMatch(/ORDER BY domain, category, key/);
  });

  it("returns nothing for a query sharing no terms with any fact", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockIlike(FACTS));

    const { searchFacts } = await import("../search-facts.js");
    const res = await searchFacts({ search: "keycloak session timeout policy" });

    expect(res.content[0].text).toBe("No facts found matching criteria.");
  });
});
