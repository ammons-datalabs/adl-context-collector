import { describe, it, expect, vi, beforeAll } from "vitest";
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

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as Array<{ text: string }>)[0].text;

describe("registered tool arguments", () => {
  it("rejects an argument the tool does not define, on every tool", async () => {
    const { tools } = await client.listTools();
    for (const { name } of tools) {
      const result = await client.callTool({ name, arguments: { not_a_parameter: "x" } });
      expect(result.isError, name).toBe(true);
      expect(text(result), name).toContain("not_a_parameter");
    }
  });
});
