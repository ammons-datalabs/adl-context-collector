import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js", () => ({ query: vi.fn() }));
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1]),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 1 },
  }),
}));

const FACT_ROW = {
  domain: "platform",
  category: "contact",
  key: "prod_keycloak_admin_url",
  value: "https://auth.example/admin/",
  context: "Prod Keycloak admin console",
  as_of: "2026-05-27",
  similarity: 0.81,
};
const CAPTURE_ROW = {
  id: 1,
  content: "Some discussion about keycloak",
  type: "note",
  domain: "platform",
  topics: ["keycloak"],
  people: [],
  source_file: "x.md",
  content_date: null,
  similarity: 0.54,
};

function mockBoth(factRows: unknown[], captureRows: unknown[]) {
  return async (sql: string) => {
    if (sql.includes("FROM facts f")) return { rows: factRows };
    if (sql.includes("FROM captures c")) return { rows: captureRows };
    return { rows: [] };
  };
}

describe("searchContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Facts block above the Captures block", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockBoth([FACT_ROW], [CAPTURE_ROW]));

    const { searchContext } = await import("../search-context.js");
    const res = await searchContext({ query: "keycloak admin url" });
    const text = res.content[0].text as string;

    expect(text).toContain("**Facts**");
    expect(text).toContain("prod_keycloak_admin_url");
    expect(text).toContain("https://auth.example/admin/");
    expect(text).toContain("as of 2026-05-27");
    expect(text).toContain("**Captures**");
    expect(text.indexOf("**Facts**")).toBeLessThan(text.indexOf("**Captures**"));
  });

  it("shows facts even when no captures match", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockBoth([FACT_ROW], []));

    const { searchContext } = await import("../search-context.js");
    const res = await searchContext({ query: "x" });
    const text = res.content[0].text as string;

    expect(text).toContain("**Facts**");
    expect(text).not.toContain("**Captures**");
  });

  it("returns the combined empty message when neither store matches", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockBoth([], []));

    const { searchContext } = await import("../search-context.js");
    const res = await searchContext({ query: "x" });

    expect(res.content[0].text).toBe("No matching captures or facts found.");
  });

  it("passes the domain filter to the facts query", async () => {
    const { query } = await import("../../db.js");
    (query as ReturnType<typeof vi.fn>).mockImplementation(mockBoth([], []));

    const { searchContext } = await import("../search-context.js");
    await searchContext({ query: "x", domain: "platform" });

    const factCall = (query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("FROM facts f"),
    );
    expect(factCall).toBeDefined();
    expect(factCall![1][3]).toBe("platform"); // $4 = domain
  });
});
