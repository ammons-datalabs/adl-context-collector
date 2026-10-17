import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { cuedNumbers, lexicalFirst } from "../services/lexical-search.js";
import { scoreLabel } from "../tools/search-context.js";

vi.mock("../db.js");
vi.mock("../services/embedder.js", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

const GATE_SQL = "BETWEEN 1 AND $2";
// GitHub-style cues, as a vault config spells them.
const GITHUB_CUES = [
  "\\b(?:pr|pull\\s+request|issue)\\s*#?\\s*(\\d+)\\b",
  "(?:^|[\\s(])#(\\d+)\\b",
  "\\b\\w[\\w.-]+(?:/[\\w.-]+)?#(\\d+)\\b",
  "/(?:pull|issues)/(\\d+)\\b",
];
const GATED = { search: { identifier_max_df: 1000, identifier_cues: GITHUB_CUES } };
const LEXICAL_SQL = "scored";

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    content: "vector row",
    type: "note",
    domain: "process",
    topics: [],
    people: [],
    source_file: "a.md",
    content_date: null,
    similarity: 0.8,
    ...over,
  };
}

describe("cuedNumbers", () => {
  it.each([
    ["acme-web PR 188 review", ["188"]],
    ["PR #767 retry fix", ["767"]],
    ["issue 944 cache eviction", ["944"]],
    ["pull request 51 mapping", ["51"]],
    ["see #57 for the preflight", ["57"]],
    ["acme-infra#43 token refresh", ["43"]],
    ["https://github.com/org/repo/pull/267", ["267"]],
  ])("takes the number a cue names in %j", (query, expected) => {
    expect(cuedNumbers(query, GITHUB_CUES)).toEqual(expected);
  });

  it.each([
    ["a bare number", "944 cache eviction"],
    ["a quantity", "how did we handle the 48 hour retention window"],
    ["a version", "pgvector 0.8 upgrade"],
  ])("takes nothing from %s", (_name, query) => {
    expect(cuedNumbers(query, GITHUB_CUES)).toEqual([]);
  });

  it("drops a year-shaped number even when cued, since a year is not an identifier", () => {
    expect(cuedNumbers("issue 2024 and PR 188", GITHUB_CUES)).toEqual(["188"]);
  });

  it("ignores a quantity beside a cued identifier", () => {
    expect(cuedNumbers("PR 999999999 with a 48 hour retention window", GITHUB_CUES)).toEqual(["999999999"]);
  });

  it("takes nothing when no cues are configured", () => {
    expect(cuedNumbers("acme-web PR 188 review", [])).toEqual([]);
  });

  it("uses whatever cues a vault configures, matched case-insensitively", () => {
    expect(cuedNumbers("Invoice 4417 from the plumber", ["\\binvoice\\s+(\\d+)"])).toEqual(["4417"]);
  });
});

describe("identifier gate", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tempDir = join(tmpdir(), `identifier-gate-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  async function search(
    partial: Record<string, unknown>,
    opts: {
      query?: string;
      qualified?: string[];
      lexicalRows?: Record<string, unknown>[];
      domain?: string;
    } = {}
  ) {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify(partial));
    vi.stubEnv("COLLECTOR_CONFIG", configPath);

    const db = await import("../db.js");
    // resetDbMock calls query.mockReset internally, so it has to run first.
    (db as unknown as { resetDbMock: () => void }).resetDbMock();
    const query = db.query as unknown as ReturnType<typeof vi.fn>;
    const respond = async (sql: string) => {
      if (String(sql).includes(LEXICAL_SQL)) {
        return { rows: opts.lexicalRows ?? [], rowCount: 0 };
      }
      if (String(sql).includes(GATE_SQL)) {
        return { rows: (opts.qualified ?? []).map((t) => ({ t })), rowCount: 1 };
      }
      if (String(sql).includes("FROM captures c")) {
        return { rows: [row()], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    query.mockImplementation(respond);
    const mocked = db as unknown as { clientQuery: ReturnType<typeof vi.fn> };
    mocked.clientQuery.mockImplementation(respond);

    const { searchContext } = await import("../tools/search-context.js");
    const result = await searchContext({
      query: opts.query ?? "acme-web PR 188 review",
      ...(opts.domain ? { domain: opts.domain } : {}),
    });

    const calls = [...query.mock.calls, ...mocked.clientQuery.mock.calls].map((c) => ({
      sql: String(c[0]),
      params: (c[1] ?? []) as unknown[],
    }));
    return {
      sql: calls.map((c) => c.sql),
      gate: calls.find((c) => c.sql.includes(GATE_SQL)),
      lexical: calls.find((c) => c.sql.includes(LEXICAL_SQL)),
      text: result.content[0].text,
    };
  }

  it("never reaches the gate query when identifier_max_df is zero", async () => {
    const { gate } = await search({ search: { identifier_cues: GITHUB_CUES } });
    expect(gate).toBeUndefined();
  });

  it("never reaches the gate query when no cues are configured", async () => {
    const { gate } = await search({ search: { identifier_max_df: 1000 } });
    expect(gate).toBeUndefined();
  });

  it("counts only the cued numbers, against the configured cap", async () => {
    const { gate } = await search(
      GATED,
      { query: "PR 999999999 with a 48 hour retention window" }
    );
    expect(gate!.params).toEqual([["999999999"], 1000]);
  });

  it.each([
    ["a bare number", "944 cache eviction"],
    ["an everyday quantity", "how did we handle the 48 hour retention window"],
  ])("leaves %s to vector search without querying the gate", async (_name, query) => {
    const { gate, lexical, text } = await search(GATED, { query });
    expect(gate).toBeUndefined();
    expect(lexical).toBeUndefined();
    expect(text).toContain("vector row");
  });

  it("leaves the vector rows alone when no cued number qualifies", async () => {
    const { lexical, text } = await search(
      GATED,
      { qualified: [] }
    );
    expect(lexical).toBeUndefined();
    expect(text).toContain("80.0% match");
  });

  it("requires keyword candidates to contain a qualified identifier", async () => {
    const { lexical } = await search(
      GATED,
      { qualified: ["188"] }
    );
    expect(lexical!.params[6]).toEqual(["188"]);
    // The database is mocked, so this checks the SQL carries the rule, not that it holds.
    expect(lexical!.sql).toContain("keep AS (SELECT DISTINCT id FROM hits WHERE t = ANY($7::text[]))");
  });

  it("hard-filters the lexical leg on a domain that is a hard filter", async () => {
    const { lexical } = await search(
      GATED,
      { qualified: ["188"], domain: "process" }
    );
    expect(lexical!.params[1]).toBe("process");
    expect(lexical!.params[7]).toBeNull();
  });

  it("boosts rather than filters on a domain that is a boost, at the vector boost's share of the floor", async () => {
    const { lexical } = await search(
      { search: { ...GATED.search, domain_boost: 0.05, min_similarity: 0.65 } },
      { qualified: ["188"], domain: "process" }
    );
    expect(lexical!.params[1]).toBeNull();
    expect(lexical!.params[7]).toBe("process");
    expect(lexical!.params[8]).toBeCloseTo(1 + 0.05 / 0.65);
  });

  it("puts the lexical rows first when the gate fires", async () => {
    const { text } = await search(
      GATED,
      { qualified: ["188"], lexicalRows: [row({ id: 2, content: "the PR 188 capture" })] }
    );
    expect(text).toMatch(/\*\*1\..*\n.*the PR 188 capture/);
    expect(text).toContain("vector row");
  });
});

describe("lexicalFirst", () => {
  it("marks the lexical rows so the reason they ranked is visible", () => {
    const merged = lexicalFirst([{ id: 1 }], [{ id: 2 }]);
    expect(merged.map((r) => [r.id, r.lexical])).toEqual([
      [2, true],
      [1, undefined],
    ]);
  });

  it("drops a vector row the lexical leg already returned", () => {
    expect(lexicalFirst([{ id: 1 }, { id: 2 }], [{ id: 2 }]).map((r) => r.id)).toEqual([
      2, 1,
    ]);
  });

  it("returns the vector rows when the lexical leg found nothing", () => {
    expect(lexicalFirst([{ id: 1 }], []).map((r) => r.id)).toEqual([1]);
  });
});

describe("scoreLabel", () => {
  it("shows a plain percentage for a vector hit", () => {
    expect(scoreLabel({ similarity: 0.761 })).toBe("76.1% match");
  });

  it("names the mechanism and keeps the cosine for a lexical hit", () => {
    expect(scoreLabel({ similarity: 0.713, lexical: true })).toBe(
      "keyword match · 71.3%"
    );
  });

  it("omits the cosine when the capture has no vector for the active model", () => {
    expect(scoreLabel({ similarity: null, lexical: true })).toBe("keyword match");
  });
});
