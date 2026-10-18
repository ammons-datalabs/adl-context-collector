import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("../tools/save-fact.js", () => ({
  saveFact: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "saved" }] }),
}));

// index.ts registers its tools and connects stdio on import, so the server is taken at
// connect and re-attached to an in-memory client: the call runs through the real registration.
let client: Client;
let valid: { domain: string; category: string; key: string; value: string };

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-registration-"));
  writeFileSync(join(dir, "config.json"), "{}");
  process.env.COLLECTOR_CONFIG = join(dir, "config.json");

  const connect = McpServer.prototype.connect;
  let server: McpServer | undefined;
  vi.spyOn(McpServer.prototype, "connect").mockImplementationOnce(async function (this: McpServer) {
    server = this;
  });
  await import("../index.js");

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await connect.call(server!, serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);

  const { DOMAINS } = await import("../types.js");
  const { loadConfig } = await import("../config.js");
  valid = { domain: DOMAINS[0], category: loadConfig().categories[0], key: "k", value: "v" };
});

describe("registered save_fact tool", () => {
  // These hints went missing once when the fields moved into the shared schema.
  it("describes free-text currency and unit fields to the client", async () => {
    const { tools } = await client.listTools();
    const props = tools.find((t) => t.name === "save_fact")!.inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(props.currency.description).toBe("Currency code (e.g. USD, EUR)");
    expect(props.unit.description).toBe("Recurrence unit (e.g. monthly, annual)");
  });

  it("passes a well-formed call to saveFact", async () => {
    const { saveFact } = await import("../tools/save-fact.js");
    vi.mocked(saveFact).mockClear();

    await client.callTool({ name: "save_fact", arguments: valid });

    expect(saveFact).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["absorbed markup", { value: 'real</value><parameter name="context">x' }],
    ["a domain outside the configured list", { domain: "not-a-domain" }],
    ["an over-long value", { value: "x".repeat(2001) }],
  ])("rejects %s before saveFact runs", async (_name, fields) => {
    const { saveFact } = await import("../tools/save-fact.js");
    vi.mocked(saveFact).mockClear();

    const result = await client.callTool({ name: "save_fact", arguments: { ...valid, ...fields } });

    expect(result.isError).toBe(true);
    expect(saveFact).not.toHaveBeenCalled();
  });
});
