import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectRegisteredServer } from "./registered-server.js";

vi.mock("../tools/save-fact.js", () => ({
  saveFact: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "saved" }] }),
}));

let client: Client;
let valid: { domain: string; category: string; key: string; value: string };

beforeAll(async () => {
  client = await connectRegisteredServer();

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
