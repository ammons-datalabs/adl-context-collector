import { readFileSync } from "fs";

export interface CollectorConfig {
  serverName: string;
  vaultRoot: string | null;
  peopleFile: string | null;
  categories: string[];
  embedder: {
    url: string;
    model: string;
    dimensions: number;
    apiKey: string | null;
  };
  metadataExtractor: {
    enabled: boolean;
    // "local" classifies domain by kNN over the existing embeddings, finds people by
    // roster match and topics by inverse document frequency. No network call.
    provider: "openai" | "local";
    url: string;
    model: string;
    apiKey: string | null;
  };
  search: {
    // Cosine floor for search_context. Calibrate per embedding model: the
    // spread differs, so one model's "unrelated" scores another's "relevant".
    min_similarity: number;
    // Above 0, a requested domain ranks matches instead of excluding them.
    domain_boost: number;
    // HNSW candidates collected before the domain filter is applied. The default of 40
    // post-filters too few rows to find a small domain; used whenever a domain is given.
    ef_search: number;
  };
  tools: {
    search_context: { description: string };
    lookup_fact: { description: string; keyExamples: string[] };
    search_facts: { description: string };
    capture_thought: { description: string };
    save_fact: {
      description: string;
      keyExamples: string[];
      currencies: string[] | null;
      units: string[] | null;
      peopleDescription: string;
    };
    list_recent: { description: string };
    context_stats: { description: string };
    ingest_document: { description: string };
    project_pulse: { description: string };
  };
  indexSync?: {
    include?: string[];
    exclude?: string[];
    extensions?: string[];
  } | null;
  additionalRoots?: Array<{
    root: string;
    include?: string[];
    exclude?: string[];
    extensions?: string[];
  }> | null;
}

const DEFAULTS: CollectorConfig = {
  serverName: "context-collector",
  vaultRoot: null,
  peopleFile: null,
  categories: ["status", "cost", "date", "contact", "preference", "metric", "location", "definition"],
  embedder: {
    url: "https://api.openai.com/v1/embeddings",
    model: "text-embedding-3-small",
    dimensions: 1536,
    apiKey: "env:OPENAI_API_KEY",
  },
  metadataExtractor: {
    enabled: true,
    provider: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiKey: "env:OPENAI_API_KEY",
  },
  search: {
    min_similarity: 0.3,
    domain_boost: 0,
    ef_search: 200,
  },
  tools: {
    search_context: {
      description: "Search the knowledge base using semantic similarity.",
    },
    lookup_fact: {
      description: "Look up a specific fact by key.",
      keyExamples: ["project_status", "deploy_date"],
    },
    search_facts: {
      description: "Search or list stored facts.",
    },
    capture_thought: {
      description:
        "Save a thought, decision, insight, or note to the knowledge base. Content is embedded for semantic search and metadata is extracted automatically.",
    },
    save_fact: {
      description:
        "Save or update a structured fact. Old values are preserved with timestamps for history.",
      keyExamples: ["project_status", "next_milestone_date"],
      currencies: null,
      units: null,
      peopleDescription: "People involved or referenced",
    },
    list_recent: {
      description:
        "List the most recently captured thoughts. Useful for reviewing recent activity.",
    },
    context_stats: {
      description:
        "Get statistics about the knowledge base: total captures, facts, breakdown by domain, last capture date.",
    },
    ingest_document: {
      description:
        "Ingest a file or directory into the knowledge base. Supports PDF, Markdown, and plain text. Files are chunked, embedded, and metadata-extracted automatically.",
    },
    project_pulse: {
      description:
        "Get current project status across all tracked repos. Returns PRs awaiting your review, your PRs pending review, recent merges, new issues, and notable activity — ordered by recency. Use when the user asks about updates, what needs attention, project status, or what's changed.",
    },
  },
  indexSync: null,
  additionalRoots: null,
};

function deepMerge(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (!(key in defaults)) continue; // ignore unknown keys
    const defaultVal = defaults[key];
    const overrideVal = overrides[key];
    if (
      defaultVal !== null &&
      overrideVal !== null &&
      typeof defaultVal === "object" &&
      typeof overrideVal === "object" &&
      !Array.isArray(defaultVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(
        defaultVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

function normalizeConfig(config: CollectorConfig): CollectorConfig {
  const sf = config.tools.save_fact;
  if (Array.isArray(sf.currencies) && sf.currencies.length === 0) {
    sf.currencies = null;
  }
  if (Array.isArray(sf.units) && sf.units.length === 0) {
    sf.units = null;
  }
  return config;
}

let _cached: CollectorConfig | undefined;

export function loadConfig(): CollectorConfig {
  if (_cached) return _cached;

  const configPath = process.env.COLLECTOR_CONFIG;
  if (!configPath) {
    // The built-in defaults point at api.openai.com. Returning them here meant any
    // invocation that forgot the variable quietly shipped vault content to a remote
    // endpoint instead of failing, which is the wrong direction to fail in.
    throw new Error(
      "COLLECTOR_CONFIG is not set. Refusing to fall back to the built-in defaults, " +
        "which send embeddings and metadata extraction to api.openai.com. Point it at a " +
        "vault config file, e.g. COLLECTOR_CONFIG=/path/to/vault-config.json."
    );
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // A typo in the path used to land on the built-in defaults, which is the same
      // silent hand-off to api.openai.com as setting no path at all.
      throw new Error(
        `COLLECTOR_CONFIG points at ${configPath}, which does not exist. Refusing to ` +
          "fall back to the built-in defaults, which send embeddings and metadata " +
          "extraction to api.openai.com."
      );
    }
    throw err;
  }

  const overrides = JSON.parse(raw);
  const merged = deepMerge(
    structuredClone(DEFAULTS) as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as unknown as CollectorConfig;

  _cached = normalizeConfig(merged);
  return _cached;
}
