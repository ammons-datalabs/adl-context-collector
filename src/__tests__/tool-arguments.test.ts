import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectRegisteredServer } from "./registered-server.js";

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("../db.js");

let client: Client;

beforeAll(async () => {
  client = await connectRegisteredServer();
});

describe("registered tool arguments", () => {
  it("rejects an argument the tool does not define, on every tool", async () => {
    const { tools } = await client.listTools();
    for (const { name } of tools) {
      const result = await client.callTool({ name, arguments: { not_a_parameter: "x" } });
      expect(result.isError, name).toBe(true);
      const [{ text }] = result.content as Array<{ text: string }>;
      expect(text, name).toContain("not_a_parameter");
    }
  });
});

describe("search_facts query argument", () => {
  let db: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { query } = await import("../db.js");
    db = query as ReturnType<typeof vi.fn>;
    db.mockReset();
    db.mockResolvedValue({ rows: [] });
  });

  it("searches exactly as search does", async () => {
    await client.callTool({ name: "search_facts", arguments: { search: "harbour budget" } });
    await client.callTool({ name: "search_facts", arguments: { query: "harbour budget" } });

    const [bySearch, byQuery] = db.mock.calls;
    expect(bySearch[1]).toContain("%harbour%");
    expect(byQuery).toEqual(bySearch);
  });

  it("rejects search and query together", async () => {
    const result = await client.callTool({
      name: "search_facts",
      arguments: { search: "harbour", query: "budget" },
    });

    expect(result.isError).toBe(true);
    expect(db).not.toHaveBeenCalled();
  });
});
