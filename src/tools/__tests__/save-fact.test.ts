import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db.js");
vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1]),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    embedder: { url: "http://e", model: "m", dimensions: 1 },
  }),
}));
vi.mock("../../services/people.js", () => ({
  canonicalizePeople: vi.fn((names: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const n of names ?? []) {
      const c = n === "danielbreves" ? "daniel" : n.toLowerCase();
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }),
}));

import * as dbModule from "../../db.js";
const db = dbModule as unknown as typeof import("../../__mocks__/db.js");

// INSERT INTO facts returns id 7 so the embedding write can key off it.
function mockFactWrites() {
  db.clientQuery.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.startsWith("INSERT INTO facts")) return { rows: [{ id: 7 }] };
    return { rows: [] };
  });
}

describe("saveFact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.resetDbMock();
    mockFactWrites();
  });

  it("stores canonicalized people in the fact row inside a transaction", async () => {
    const { saveFact } = await import("../save-fact.js");
    await saveFact({
      domain: "team",
      category: "status",
      key: "danielbreves_focus",
      value: "evidence-repo-ui",
      people: ["danielbreves", "daniel"],
    });

    const insert = db.clientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("INSERT INTO facts"),
    );
    expect(insert).toBeDefined();
    expect(insert![1][8]).toEqual(["daniel"]); // $9 = people, collapsed + deduped

    const sqls = db.txSql();
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("COMMIT");
  });

  it("writes a fact_embeddings row keyed to the new fact id", async () => {
    const { saveFact } = await import("../save-fact.js");
    await saveFact({
      domain: "platform",
      category: "contact",
      key: "prod_keycloak_admin_url",
      value: "https://auth.example/admin/",
    });

    const embCall = db.clientQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).startsWith("INSERT INTO fact_embeddings"),
    );
    expect(embCall).toBeDefined();
    // params: [fact_id, provider_url, model, dimensions, embedding]
    expect(embCall![1][0]).toBe(7);
    expect(embCall![1][1]).toBe("http://e");
    expect(embCall![1][2]).toBe("m");
    expect(embCall![1][3]).toBe(1);
    expect(embCall![1][4]).toBe(JSON.stringify([0.1]));
  });

  it("resets valid_until on conflict so a same-as_of update stays current", async () => {
    const { saveFact } = await import("../save-fact.js");
    await saveFact({
      domain: "team",
      category: "status",
      key: "danielbreves_focus",
      value: "v2",
      as_of: "2026-06-28",
    });

    const insert = db.clientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("INSERT INTO facts"),
    );
    expect(insert).toBeDefined();
    // The supersede UPDATE marks the same-as_of row valid_until=as_of; without
    // clearing it in DO UPDATE the re-saved value stays hidden from current-fact queries.
    expect(insert![0] as string).toMatch(/DO UPDATE[\s\S]*valid_until = NULL/);
  });

  it("composes the embedding text from domain, category, key, value and context", async () => {
    const { generateEmbedding } = await import("../../services/embedder.js");
    const { saveFact } = await import("../save-fact.js");
    await saveFact({
      domain: "platform",
      category: "contact",
      key: "prod_keycloak_admin_url",
      value: "https://auth.example/admin/",
      context: "Prod Keycloak admin console",
    });

    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    const text = (generateEmbedding as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("platform/contact");
    expect(text).toContain("prod_keycloak_admin_url");
    expect(text).toContain("https://auth.example/admin/");
    expect(text).toContain("Prod Keycloak admin console");
  });
});
