import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../../db.js", () => ({ query: (...a: unknown[]) => queryMock(...a) }));

vi.mock("../people.js", () => ({
  findPeopleInText: (text: string) =>
    text.toLowerCase().includes("sam") ? ["sam lee"] : [],
  canonicalizePeople: (n: string[] | null) => n ?? [],
}));

import { classifyDomain, extractMetadataLocal, extractTopics, unstem } from "../local-metadata.js";

const EMBEDDING = new Array(768).fill(0.1);
const EMBEDDER = { url: "http://localhost:11434/v1/embeddings", model: "nomic-embed-text", dimensions: 768 };

beforeEach(() => {
  queryMock.mockReset();
});

describe("classifyDomain", () => {
  it("returns the majority label among the nearest neighbours", async () => {
    queryMock.mockResolvedValue({
      rows: [{ domain: "dedup" }, { domain: "dedup" }, { domain: "process" }],
    });
    expect(await classifyDomain(EMBEDDING, EMBEDDER)).toBe("dedup");
  });

  it("returns null when the corpus has no labelled neighbours", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await classifyDomain(EMBEDDING, EMBEDDER)).toBeNull();
  });

  it("breaks a tie deterministically rather than by row order", async () => {
    queryMock.mockResolvedValue({ rows: [{ domain: "taxonomy" }, { domain: "dedup" }] });
    const first = await classifyDomain(EMBEDDING, EMBEDDER);
    queryMock.mockResolvedValue({ rows: [{ domain: "dedup" }, { domain: "taxonomy" }] });
    expect(await classifyDomain(EMBEDDING, EMBEDDER)).toBe(first);
  });

  it("ignores neighbours carrying no domain", async () => {
    queryMock.mockResolvedValue({
      rows: [{ domain: null }, { domain: null }, { domain: "team" }],
    });
    expect(await classifyDomain(EMBEDDING, EMBEDDER)).toBe("team");
  });
});

describe("extractTopics", () => {
  it("prefers rare terms over common ones", async () => {
    queryMock.mockResolvedValue({ rows: [{ term: "pgvector" }, { term: "hnsw" }] });
    expect(await extractTopics("pgvector hnsw the and of", 5)).toEqual(["pgvector", "hnsw"]);
  });

  it("returns an empty list when nothing survives", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await extractTopics("the and of", 5)).toEqual([]);
  });

  it("lists a word once when two of its stems recover it", async () => {
    queryMock.mockResolvedValue({ rows: [{ term: "cherry-pick" }, { term: "cherri" }] });
    expect(await extractTopics("we cherry-picked the fix", 5)).toEqual(["cherry-picked"]);
  });
});

describe("extractMetadataLocal", () => {
  it("assembles domain, people and topics without any network call", async () => {
    queryMock.mockImplementation((sql: string) =>
      sql.includes("ts_stat") || sql.includes("tsvector_to_array")
        ? Promise.resolve({ rows: [{ term: "invoices" }] })
        : Promise.resolve({ rows: [{ domain: "operations" }] })
    );
    const md = await extractMetadataLocal("Sam asked about invoices", EMBEDDING, EMBEDDER);
    expect(md.domain).toBe("operations");
    expect(md.people).toEqual(["sam lee"]);
    expect(md.topics).toEqual(["invoices"]);
  });

  it("leaves type, action_items and dates empty", async () => {
    queryMock.mockImplementation((sql: string) =>
      sql.includes("tsvector_to_array")
        ? Promise.resolve({ rows: [] })
        : Promise.resolve({ rows: [{ domain: "process" }] })
    );
    const md = await extractMetadataLocal("some text", EMBEDDING, EMBEDDER);
    expect(md.type).toBe("");
    expect(md.action_items).toEqual([]);
    expect(md.dates).toEqual({});
  });

  it("classifies against the configured embedder's vectors, not a fixed model", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const other = { url: "http://other/v1/embeddings", model: "mxbai-embed-large", dimensions: 1024 };
    await extractMetadataLocal("some text", new Array(1024).fill(0.1), other);

    const knn = queryMock.mock.calls.find((c) => String(c[0]).includes("capture_embeddings"))!;
    expect(String(knn[0])).toContain("vector(1024)");
    expect(knn[1].slice(1)).toEqual([other.url, other.model]);
  });

  it("still returns a usable object when the database yields nothing", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const md = await extractMetadataLocal("some text", EMBEDDING, EMBEDDER);
    expect(md.domain).toBe("");
    expect(md.topics).toEqual([]);
  });
});

describe("unstem", () => {
  it("recovers the written word from its stem", () => {
    expect(unstem("supersed", "this supersedes the earlier note")).toBe("supersedes");
  });

  it("keeps hyphenated terms whole", () => {
    expect(unstem("openalex-import", "the OpenAlex-Import path")).toBe("openalex-import");
  });

  it("falls back to the stem when the word is not present", () => {
    expect(unstem("zzqq", "unrelated text")).toBe("zzqq");
  });

  it("recovers a word Porter rewrote from y to i", () => {
    expect(unstem("clunki", "a clunky interface")).toBe("clunky");
  });

  it("does not match a stem that only appears mid-word", () => {
    expect(unstem("cat", "concatenate")).toBe("cat");
  });

  it("prefers the word itself over a longer word sharing its prefix", () => {
    expect(unstem("index", "the indexer reads the index")).toBe("index");
  });

  it("prefers the shortest inflection over an unrelated longer word", () => {
    expect(unstem("use", "the username is used")).toBe("used");
  });
});
