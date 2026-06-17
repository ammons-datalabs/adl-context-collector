export interface CaptureMetadata {
  type: string;
  domain: string;
  topics: string[];
  people: string[];
  action_items: string[];
  dates: Record<string, string>;
}

export interface CaptureRow {
  id: number;
  content: string;
  type: string | null;
  domain: string | null;
  topics: string[] | null;
  people: string[] | null;
  action_items: string[] | null;
  dates: Record<string, string> | null;
  source_file: string | null;
  source_section: string | null;
  source_type: string;
  chunk_index: number | null;
  captured_at: Date;
  content_date: Date | null;
  content_hash: string;
}

export interface FactRow {
  id: number;
  domain: string;
  category: string;
  key: string;
  value: string;
  value_numeric: number | null;
  currency: string | null;
  unit: string | null;
  context: string | null;
  source_file: string | null;
  people: string[] | null;
  as_of: Date;
  valid_until: Date | null;
  captured_at: Date;
  source_type: string;
}

// --- Config-driven domain and type loading ---

function parseEnvList(envVar: string, defaults: readonly string[]): string[] {
  const raw = process.env[envVar];
  if (!raw) return [...defaults];
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : [...defaults];
}

const DEFAULT_DOMAINS = [
  "general",
  "project",
  "reference",
] as const;

const DEFAULT_CAPTURE_TYPES = [
  "thought",
  "decision",
  "analysis",
  "note",
  "meeting",
  "insight",
  "plan",
  "reference",
  "review",
] as const;

export const DOMAINS = parseEnvList("COLLECTOR_DOMAINS", DEFAULT_DOMAINS);
export const CAPTURE_TYPES = parseEnvList("COLLECTOR_CAPTURE_TYPES", DEFAULT_CAPTURE_TYPES);

// Runtime types (no longer compile-time unions since values are configurable)
export type Domain = string;
export type CaptureType = string;
