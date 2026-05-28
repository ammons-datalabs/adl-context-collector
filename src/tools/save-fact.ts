import { query } from "../db.js";
import { SOURCE_TYPES } from "../ingestion/types.js";
import { canonicalizePeople } from "../services/people.js";

export async function saveFact(args: {
  domain: string;
  category: string;
  key: string;
  value: string;
  value_numeric?: number;
  currency?: string;
  unit?: string;
  context?: string;
  people?: string[];
  as_of?: string;
}) {
  const asOf = args.as_of ?? new Date().toISOString().split("T")[0];
  const people = canonicalizePeople(args.people);

  // Mark previous value as superseded
  await query(
    `UPDATE facts SET valid_until = $1::date
     WHERE domain = $2 AND category = $3 AND key = $4 AND valid_until IS NULL`,
    [asOf, args.domain, args.category, args.key]
  );

  // Insert new value
  const result = await query(
    `INSERT INTO facts (domain, category, key, value, value_numeric, currency, unit, context, people, as_of, source_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11)
     ON CONFLICT (domain, category, key, as_of) DO UPDATE
       SET value = EXCLUDED.value,
           value_numeric = EXCLUDED.value_numeric,
           currency = EXCLUDED.currency,
           unit = EXCLUDED.unit,
           context = EXCLUDED.context,
           people = EXCLUDED.people,
           captured_at = NOW()
     RETURNING id`,
    [
      args.domain,
      args.category,
      args.key,
      args.value,
      args.value_numeric ?? null,
      args.currency ?? null,
      args.unit ?? null,
      args.context ?? null,
      people.length > 0 ? people : null,
      asOf,
      SOURCE_TYPES.CLAUDE_CAPTURE,
    ]
  );

  return {
    content: [
      {
        type: "text" as const,
        text: `Saved fact #${result.rows[0].id}: ${args.domain}/${args.category}/${args.key} = ${args.value}${args.currency ? ` ${args.currency}` : ""} (as of ${asOf})${people.length > 0 ? `\nPeople: ${people.join(", ")}` : ""}`,
      },
    ],
  };
}
