import { readFileSync } from "fs";

export interface CollectorConfig {
  serverName: string;
  categories: string[];
  embedder: {
    url: string;
    model: string;
    dimensions: number;
    apiKey: string | null;
  };
  metadataExtractor: {
    enabled: boolean;
    url: string;
    model: string;
    apiKey: string | null;
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
  };
}

const DEFAULTS: CollectorConfig = {
  serverName: "context-collector",
  categories: ["status", "cost", "date", "contact", "preference"],
  embedder: {
    url: "https://api.openai.com/v1/embeddings",
    model: "text-embedding-3-small",
    dimensions: 1536,
    apiKey: "env:OPENAI_API_KEY",
  },
  metadataExtractor: {
    enabled: true,
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiKey: "env:OPENAI_API_KEY",
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
  },
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
    _cached = normalizeConfig(structuredClone(DEFAULTS));
    return _cached;
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
      _cached = normalizeConfig(structuredClone(DEFAULTS));
      return _cached;
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
