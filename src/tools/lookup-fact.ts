import { query } from "../db.js";

export async function lookupFact(args: {
  key: string;
  domain?: string;
  as_of?: string;
}) {
  const asOf = args.as_of ?? new Date().toISOString().split("T")[0];

  const result = await query(
    `SELECT key, value, value_numeric, currency, unit, context, as_of, source_file, domain, category
     FROM facts
     WHERE key = $1
       AND ($2::text IS NULL OR domain = $2)
       AND as_of <= $3::date
       AND (valid_until IS NULL OR valid_until > $3::date)
     ORDER BY as_of DESC
     LIMIT 1`,
    [args.key, args.domain ?? null, asOf]
  );

  if (result.rows.length === 0) {
    return {
      content: [{ type: "text" as const, text: `No fact found for key "${args.key}".` }],
    };
  }

  const f = result.rows[0];
  const parts = [`**${f.key}**: ${f.value}`];
  if (f.currency) parts.push(`Currency: ${f.currency}`);
  if (f.unit) parts.push(`Unit: ${f.unit}`);
  if (f.context) parts.push(`Context: ${f.context}`);
  parts.push(`As of: ${f.as_of}`);
  parts.push(`Domain: ${f.domain} / ${f.category}`);

  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
}
