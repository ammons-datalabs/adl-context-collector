import { query } from "../db.js";

// A year is not an identifier, and document frequency cannot tell them apart: on a
// 22k-capture corpus identifiers ran 17 to 231 captures while 2023 sat at 21 and 2025 at
// 532, so every cap that excludes a year also excludes real PR numbers. Shape decides.
// The cost is that a genuine issue #2024 would not be recognised.
const YEAR = /^(19|20)[0-9][0-9]$/;

// Only a number a cue names can be an identifier: a bare number or a quantity beside one
// ("PR 999 and 48 hours") misrouted the query and left keyword rows under the floor.
export function cuedNumbers(queryText: string, cues: string[]): string[] {
  const numbers = cues.flatMap((cue) =>
    [...queryText.matchAll(new RegExp(cue, "gi"))].map((m) => m[1])
  );
  return [...new Set(numbers)].filter((n) => n && !YEAR.test(n));
}

// Cued numbers rare enough to be identifiers. Dense retrieval smears those: "PR 204" and
// "PR 267" embed almost identically.
const IDENTIFIER_DF_SQL = `
    SELECT t FROM unnest($1::text[]) AS t
    WHERE (SELECT count(*) FROM captures c
            WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', t)
          ) BETWEEN 1 AND $2
`;

export async function cuedIdentifiers(
  queryText: string,
  maxDf: number,
  cues: string[]
): Promise<string[]> {
  const numbers = maxDf > 0 ? cuedNumbers(queryText, cues) : [];
  if (numbers.length === 0) return [];
  const result = await query(IDENTIFIER_DF_SQL, [numbers, maxDf]);
  return result.rows.map((r: { t: string }) => r.t);
}

// IDF-weighted term coverage, not ts_rank_cd: on a real 10-term query AND semantics
// matched 1 capture and OR matched 12,345, ranking the wanted one 906th.
// `keep` demands a cued identifier, because summing IDF rewards breadth and a capture
// matching six mid-rare terms outranks the one naming the number. The identifiers join
// the terms directly, since a cue's match need not tokenize to the bare number.
// Document frequency comes off the same `hits` set; as a correlated subquery it re-scans
// and costs 9.7s against 20ms. The embeddings join is LEFT so a capture missing a vector
// still returns, supplying a similarity for display only, never the ordering.
// The domain scopes `hits`, so frequencies are counted within the searched scope. A
// boosted domain ($8) scales its rows' scores by $9 instead of filtering them.
const LEXICAL_SQL = (dims: number) => `
    WITH terms AS (
        SELECT DISTINCT unnest(
            tsvector_to_array(to_tsvector('english', $1)) || $7::text[]
        ) AS t
    ),
    hits AS (
        SELECT terms.t, c.id
        FROM terms
        JOIN captures c
          ON to_tsvector('english', c.content) @@ plainto_tsquery('english', terms.t)
        WHERE ($2::text IS NULL OR c.domain = $2)
    ),
    total AS (
        SELECT count(*)::float8 AS n FROM captures
        WHERE ($2::text IS NULL OR domain = $2)
    ),
    df AS (SELECT t, count(*)::float8 AS n FROM hits GROUP BY t),
    keep AS (SELECT DISTINCT id FROM hits WHERE t = ANY($7::text[])),
    scored AS (
        SELECT h.id,
               sum(ln(((SELECT n FROM total) - df.n + 0.5) / (df.n + 0.5) + 1)) AS score
        FROM hits h
        JOIN df ON df.t = h.t
        WHERE h.id IN (SELECT id FROM keep)
        GROUP BY h.id
    )
    SELECT c.id, c.content, c.type, c.domain, c.topics, c.people,
           c.source_file, c.content_date,
           1 - (ce.embedding::vector(${dims}) <=> $3::vector(${dims})) AS similarity
    FROM scored s
    JOIN captures c ON c.id = s.id
    LEFT JOIN capture_embeddings ce
      ON ce.capture_id = c.id AND ce.provider_url = $4 AND ce.model = $5
    ORDER BY s.score * CASE WHEN c.domain = $8 THEN $9::float8 ELSE 1 END DESC, c.id
    LIMIT $6
`;

export async function lexicalSearch(opts: {
  queryText: string;
  identifiers: string[];
  domain: string | null;
  boost: { domain: string; factor: number } | null;
  vec: string;
  dims: number;
  providerUrl: string;
  model: string;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const result = await query(LEXICAL_SQL(opts.dims), [
    opts.queryText,
    opts.domain,
    opts.vec,
    opts.providerUrl,
    opts.model,
    opts.limit,
    opts.identifiers,
    opts.boost?.domain ?? null,
    opts.boost?.factor ?? 1,
  ]);
  return result.rows;
}

// Lexical results, then any vector result not already among them. Rank fusion was tried
// and dropped: it cannot express "this leg is authoritative here", so a text-only hit at
// rank 13 scored 1/73 against 1/61 for a confidently wrong vector hit at rank 1.
export function lexicalFirst(
  vectorRows: Record<string, unknown>[],
  lexicalRows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set(lexicalRows.map((r) => r.id));
  return [
    ...lexicalRows.map((r) => ({ ...r, lexical: true })),
    ...vectorRows.filter((r) => !seen.has(r.id)),
  ];
}
