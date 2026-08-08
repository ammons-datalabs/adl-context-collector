import { query } from "../db.js";

export async function searchFacts(args: {
  domain?: string;
  category?: string;
  search?: string;
  current_only?: boolean;
  limit?: number;
}) {
  const currentOnly = args.current_only ?? true;
  const limit = Math.min(args.limit ?? 20, 100);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (args.domain) {
    conditions.push(`domain = $${paramIdx++}`);
    params.push(args.domain);
  }
  if (args.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(args.category);
  }
  // Match any term, not the whole string: a natural-language query rarely has
  // one fact containing every word, and AND semantics would miss them all.
  let orderBy = "domain, category, key, as_of DESC";
  if (args.search?.trim()) {
    const termParams: number[] = [];
    const clauses = args.search
      .trim()
      .split(/\s+/)
      .map((term) => {
        params.push(`%${term}%`);
        const p = paramIdx++;
        termParams.push(p);
        return `(key ILIKE $${p} OR value ILIKE $${p} OR context ILIKE $${p})`;
      });
    conditions.push(`(${clauses.join(" OR ")})`);
    // OR matching makes the result set broad, so alphabetical order buries the
    // best rows past the limit. Rank by terms hit, weighted by where they hit.
    const score = termParams
      .map(
        (p) =>
          `(CASE WHEN key ILIKE $${p} THEN 3 WHEN value ILIKE $${p} THEN 2 WHEN context ILIKE $${p} THEN 1 ELSE 0 END)`
      )
      .join(" + ");
    orderBy = `(${score}) DESC, as_of DESC`;
  }
  if (currentOnly) {
    conditions.push("valid_until IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

  const result = await query(
    `SELECT domain, category, key, value, value_numeric, currency, unit, context, as_of
     FROM facts
     ${where}
     ORDER BY ${orderBy}
     LIMIT $${paramIdx}`,
    params
  );

  if (result.rows.length === 0) {
    return { content: [{ type: "text" as const, text: "No facts found matching criteria." }] };
  }

  const text = result.rows
    .map(
      (f: Record<string, unknown>) =>
        `**${f.domain}/${f.category}** — ${f.key}: ${f.value}${f.currency ? ` ${f.currency}` : ""}${f.unit ? ` (${f.unit})` : ""} [as of ${f.as_of}]${f.context ? `\n  _${f.context}_` : ""}`
    )
    .join("\n");

  return {
    content: [
      {
        type: "text" as const,
        text: `Found ${result.rows.length} fact(s):\n\n${text}`,
      },
    ],
  };
}
