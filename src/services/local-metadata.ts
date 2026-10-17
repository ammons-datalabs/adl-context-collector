import type { CaptureMetadata } from "../types.js";
import type { CollectorConfig } from "../config.js";

type EmbeddingSpace = Pick<CollectorConfig["embedder"], "url" | "model" | "dimensions">;
import { query } from "../db.js";
import { findPeopleInText } from "./people.js";

// Majority over the nearest neighbours' labels. 15 measured best on a 22k-capture corpus;
// fewer is noisier and more just pulls in the majority domain.
const NEIGHBOURS = 15;
const TOPIC_COUNT = 5;
// A term in more than this share of the corpus carries no information about one chunk.
const TOPIC_MAX_DF_RATIO = 0.05;

// A type modifier cannot be a bind parameter: `::vector($4)` fails to parse with
// "type modifiers must be simple constants or identifiers". Dimensions are interpolated,
// which is safe because they come from config as a number, never from user input.
const neighbourSql = (dimensions: number): string => `
  SELECT c.domain
  FROM capture_embeddings ce
  JOIN captures c ON c.id = ce.capture_id
  WHERE ce.provider_url = $2 AND ce.model = $3
  ORDER BY (ce.embedding)::vector(${dimensions}) <=> $1::vector(${dimensions})
  LIMIT ${NEIGHBOURS}
`;

// Highest-IDF terms in the chunk. Deterministic and local, but a different flavour of
// "topic" from the LLM's short phrases: these are single stemmed lexemes.
const TOPIC_SQL = `
  WITH terms AS (
    SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('english', $1))) AS t
  ),
  total AS (SELECT count(*)::float8 AS n FROM captures),
  df AS (
    SELECT terms.t,
           (SELECT count(*) FROM captures c
             WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', terms.t)
           )::float8 AS n
    FROM terms
  )
  SELECT t AS term FROM df
  WHERE n > 0 AND n <= (SELECT n FROM total) * $2
    -- Letters and internal hyphens only, three or more. Without this the rarest terms in
    -- a chunk are its timestamps, file paths and identifiers, which read as noise.
    AND t ~ '^[a-z][a-z-]{2,}$'
  ORDER BY n ASC, t
  LIMIT $3
`;

/** Majority domain among the nearest labelled neighbours, or null if there are none. */
export async function classifyDomain(
  embedding: number[],
  embedder: EmbeddingSpace
): Promise<string | null> {
  const { rows } = await query(neighbourSql(embedder.dimensions), [
    JSON.stringify(embedding),
    embedder.url,
    embedder.model,
  ]);

  const counts = new Map<string, number>();
  for (const row of rows as Array<{ domain: string | null }>) {
    if (!row.domain) continue;
    counts.set(row.domain, (counts.get(row.domain) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // Alphabetical on a tie, so the same chunk always lands in the same domain.
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0][0];
}

/**
 * Recover the written word behind a Porter stem by finding it in the source text.
 *
 * `to_tsvector` returns stems, so the raw terms read as typos ("supersed", "usernam").
 * The stemmer strips suffixes, so the original is the stem plus whatever follows it.
 */
export function unstem(stem: string, content: string): string {
  // Porter rewrites a trailing "y" as "i" ("clunky" -> "clunki"), which no prefix search
  // can find, so that ending is tried both ways.
  const candidates = stem.endsWith("i")
    ? [stem, `${stem.slice(0, -1)}y`]
    : [stem];

  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = content.match(new RegExp(`\\b${escaped}[\\w-]*\\b`, "i"));
    if (match) return match[0].toLowerCase();
  }
  return stem;
}

/** The chunk's rarest terms, as a local stand-in for the model's topic tags. */
export async function extractTopics(
  content: string,
  count = TOPIC_COUNT
): Promise<string[]> {
  const { rows } = await query(TOPIC_SQL, [content, TOPIC_MAX_DF_RATIO, count]);
  return (rows as Array<{ term: string }>).map((r) => unstem(r.term, content));
}

/**
 * Metadata without a network call, replacing the gpt-4o-mini extractor.
 *
 * `type`, `action_items` and `dates` are left empty: nothing queries `type` (nearly every
 * sampled chunk took the same value from the model), and the other two have no local
 * equivalent worth guessing at. Measured agreement with the model it replaces, on a
 * 22k-capture corpus: domain 74%, people 83% precision and recall.
 */
export async function extractMetadataLocal(
  content: string,
  embedding: number[],
  embedder: EmbeddingSpace
): Promise<CaptureMetadata> {
  const [domain, topics] = await Promise.all([
    classifyDomain(embedding, embedder),
    extractTopics(content),
  ]);

  return {
    type: "",
    domain: domain ?? "",
    topics,
    people: findPeopleInText(content),
    action_items: [],
    dates: {},
  };
}
