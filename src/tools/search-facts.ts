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
  if (args.search) {
    conditions.push(
      `(key ILIKE $${paramIdx} OR value ILIKE $${paramIdx} OR context ILIKE $${paramIdx})`
    );
    params.push(`%${args.search}%`);
    paramIdx++;
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
     ORDER BY domain, category, key, as_of DESC
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
