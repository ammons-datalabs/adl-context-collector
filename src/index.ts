import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DOMAINS, CAPTURE_TYPES } from "./types.js";
import { searchBrain } from "./tools/search-brain.js";
import { lookupFact } from "./tools/lookup-fact.js";
import { searchFacts } from "./tools/search-facts.js";
import { captureThought } from "./tools/capture-thought.js";
import { saveFact } from "./tools/save-fact.js";
import { listRecent } from "./tools/list-recent.js";
import { brainStats } from "./tools/brain-stats.js";

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// 1. Semantic search across captures
server.tool(
  "search_brain",
  "Search the personal knowledge base using semantic similarity. Use for questions like 'what did we decide about the mortgage?' or 'what's the plan for Tucker's import?'",
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
  async (args) => searchBrain(args)
);

// 2. Precise fact lookup by key
server.tool(
  "lookup_fact",
  "Look up a specific fact by key. Use for precise questions like 'what is the Growth Saver balance?' or 'when does the Sweden trip start?'",
  {
    key: z
      .string()
      .describe(
        "The fact key, e.g. 'growth_saver_balance', 'rent_weekly', 'sweden_departure_date'"
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
  "Search or list facts. Use for 'show me all account balances' or 'what travel bookings do I have?'",
  {
    domain: z
      .enum(DOMAINS as [string, ...string[]])
      .optional(),
    category: z
      .string()
      .optional()
      .describe(
        "Filter by category: account_balance, expense, booking, contact, status, cost, date"
      ),
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

// 4. Save a thought/note/decision from Claude
server.tool(
  "capture_thought",
  "Save a thought, decision, insight, or note to the knowledge base. Content is embedded for semantic search and metadata is extracted automatically.",
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
server.tool(
  "save_fact",
  "Save or update a structured fact (balance, status, date, cost). Old values are preserved with timestamps for history.",
  {
    domain: z.enum(DOMAINS as [string, ...string[]]),
    category: z
      .string()
      .describe(
        "Fact category: account_balance, expense, booking, contact, status, cost, date, preference"
      ),
    key: z
      .string()
      .describe(
        "Stable snake_case identifier, e.g. 'growth_saver_balance', 'tucker_peq_start_date'"
      ),
    value: z.string().describe("The value as a readable string"),
    value_numeric: z.number().optional().describe("Numeric value if applicable"),
    currency: z.enum(["AUD", "USD", "SEK"]).optional(),
    unit: z
      .enum(["weekly", "monthly", "annual", "fortnightly", "one-time"])
      .optional(),
    context: z.string().optional().describe("Brief context for this fact"),
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
  "List the most recently captured thoughts. Useful for reviewing recent activity.",
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
  "brain_stats",
  "Get statistics about the knowledge base: total captures, facts, breakdown by domain, last capture date.",
  {},
  async () => brainStats()
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
