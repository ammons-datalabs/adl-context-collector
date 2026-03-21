import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DOMAINS, CAPTURE_TYPES } from "./types.js";
import { loadConfig } from "./config.js";
import { searchContext } from "./tools/search-context.js";
import { lookupFact } from "./tools/lookup-fact.js";
import { searchFacts } from "./tools/search-facts.js";
import { captureThought } from "./tools/capture-thought.js";
import { saveFact } from "./tools/save-fact.js";
import { listRecent } from "./tools/list-recent.js";
import { contextStats } from "./tools/context-stats.js";
import { ingestDocument } from "./tools/ingest-document.js";
import { projectPulse } from "./tools/project-pulse.js";

const config = loadConfig();

const server = new McpServer({
  name: config.serverName,
  version: "1.0.0",
});

// Helper: format example list for .describe() hints
function exampleList(prefix: string, examples: string[]): string {
  if (examples.length === 0) return prefix;
  return `${prefix}, e.g. '${examples.join("', '")}'`;
}

// 1. Semantic search across captures
server.tool(
  "search_context",
  config.tools.search_context.description,
  {
    query: z.string().describe("Natural language search query"),
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional()
      .describe("Filter to a specific domain"),
    limit: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .optional()
      .describe("Max results (default 5)"),
    min_similarity: z
      .number()
      .min(0)
      .max(1)
      .default(0.3)
      .optional()
      .describe("Minimum similarity threshold (default 0.3)"),
  },
  async (args) => searchContext(args)
);

// 2. Precise fact lookup by key
server.tool(
  "lookup_fact",
  config.tools.lookup_fact.description,
  {
    key: z
      .string()
      .describe(
        exampleList("The fact key", config.tools.lookup_fact.keyExamples)
      ),
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional()
      .describe("Filter to a specific domain"),
    as_of: z
      .string()
      .optional()
      .describe("Look up value as of this date (YYYY-MM-DD, default: today)"),
  },
  async (args) => lookupFact(args)
);

// 3. Browse/filter facts
server.tool(
  "search_facts",
  config.tools.search_facts.description,
  {
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional(),
    category: z
      .string()
      .optional()
      .describe(`Filter by category: ${config.categories.join(", ")}`),
    search: z
      .string()
      .optional()
      .describe("Text search across key, value, and context"),
    current_only: z
      .boolean()
      .default(true)
      .optional()
      .describe("Only current facts (default true)"),
    limit: z.number().min(1).max(100).default(20).optional(),
  },
  async (args) => searchFacts(args)
);

// 4. Save a thought/note/decision
server.tool(
  "capture_thought",
  config.tools.capture_thought.description,
  {
    content: z
      .string()
      .describe(
        "The thought to save. Write as a self-contained statement that makes sense without prior context."
      ),
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional()
      .describe("Override auto-detected domain"),
    type: z
      .enum(CAPTURE_TYPES as [string, ...string[]])
      .optional()
      .describe("Override auto-detected type"),
  },
  async (args) => captureThought(args)
);

// 5. Save/update a structured fact
const saveFactCurrency = config.tools.save_fact.currencies
  ? z.enum(config.tools.save_fact.currencies as [string, ...string[]]).optional()
  : z.string().optional().describe("Currency code (e.g. USD, EUR)");

const saveFactUnit = config.tools.save_fact.units
  ? z.enum(config.tools.save_fact.units as [string, ...string[]]).optional()
  : z.string().optional().describe("Recurrence unit (e.g. monthly, annual)");

server.tool(
  "save_fact",
  config.tools.save_fact.description,
  {
    domain: z.enum(DOMAINS as [string, ...string[]]),
    category: z
      .string()
      .describe(`Fact category: ${config.categories.join(", ")}`),
    key: z
      .string()
      .describe(
        exampleList("Stable snake_case identifier", config.tools.save_fact.keyExamples)
      ),
    value: z.string().describe("The value as a readable string"),
    value_numeric: z.number().optional().describe("Numeric value if applicable"),
    currency: saveFactCurrency,
    unit: saveFactUnit,
    context: z.string().optional().describe("Brief context for this fact"),
    people: z
      .array(z.string())
      .optional()
      .describe(config.tools.save_fact.peopleDescription),
    as_of: z
      .string()
      .optional()
      .describe("Date this fact is true as of (YYYY-MM-DD, default: today)"),
  },
  async (args) => saveFact(args)
);

// 6. Browse recent captures
server.tool(
  "list_recent",
  config.tools.list_recent.description,
  {
    limit: z.number().min(1).max(50).default(10).optional(),
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional(),
    since: z
      .string()
      .optional()
      .describe("Only captures after this date (YYYY-MM-DD)"),
  },
  async (args) => listRecent(args)
);

// 7. System overview
server.tool(
  "context_stats",
  config.tools.context_stats.description,
  {},
  async () => contextStats()
);

// 8. Document ingestion
server.tool(
  "ingest_document",
  config.tools.ingest_document.description,
  {
    path: z.string().describe("Absolute path to a file or directory"),
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional()
      .describe("Override auto-detected domain for all chunks"),
    recursive: z
      .boolean()
      .default(false)
      .optional()
      .describe("Recurse into subdirectories"),
    dry_run: z
      .boolean()
      .default(false)
      .optional()
      .describe("Show what would be ingested without writing"),
  },
  async (args) => ingestDocument(args)
);

// 9. Project pulse — cross-repo status
server.tool(
  "project_pulse",
  config.tools.project_pulse.description,
  {
    repo: z.string().optional().describe(
      "Filter to a specific repo (e.g. 'taxonomy-builder'). Omit for cross-repo view."
    ),
  },
  async (args) => {
    const vaultRoot = config.vaultRoot;
    if (!vaultRoot) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: "vaultRoot not configured. Add vaultRoot to your work-vault config JSON.",
          }),
        }],
      };
    }
    return projectPulse({ ...args, vaultRoot });
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
