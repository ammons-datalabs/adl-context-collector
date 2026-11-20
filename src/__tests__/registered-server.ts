import { vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// index.ts registers its tools and connects stdio on import, so the server is taken at
// connect and re-attached to an in-memory client: calls run through the real registration.
// The calling test file must mock "@modelcontextprotocol/sdk/server/stdio.js".
export async function connectRegisteredServer(): Promise<Client> {
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
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}
