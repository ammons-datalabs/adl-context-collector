import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectRegisteredServer } from "./registered-server.js";

vi.mock("../db.js");

import * as dbModule from "../db.js";
const db = dbModule as unknown as typeof import("../__mocks__/db.js");

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
  beforeEach(() => {
    db.resetDbMock();
  });

  it("searches exactly as search does", async () => {
    const searchResult = await client.callTool({
      name: "search_facts",
      arguments: { search: "harbour budget" },
    });
    const queryResult = await client.callTool({
      name: "search_facts",
      arguments: { query: "harbour budget" },
    });

    const [bySearch, byQuery] = db.query.mock.calls;
    expect(bySearch[1]).toContain("%harbour%");
    expect(byQuery).toEqual(bySearch);
    expect(queryResult).toEqual(searchResult);
  });

  // An empty search still counts as given: search ?? query keeps the "", which returns unfiltered facts.
  it.each([
    { search: "harbour", query: "budget" },
    { search: "", query: "harbour" },
  ])("rejects search and query together: %j", async (args) => {
    const result = await client.callTool({ name: "search_facts", arguments: args });

    expect(result.isError).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });
});
