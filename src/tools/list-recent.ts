import { query } from "../db.js";

export async function listRecent(args: {
  limit?: number;
  domain?: string;
  since?: string;
}) {
  const limit = Math.min(args.limit ?? 10, 50);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (args.domain) {
    conditions.push(`domain = $${paramIdx++}`);
    params.push(args.domain);
  }
  if (args.since) {
    conditions.push(`captured_at >= $${paramIdx++}::timestamptz`);
    params.push(args.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const result = await query(
    `SELECT id, content, type, domain, topics, people, source_file, captured_at
     FROM captures
     ${where}
     ORDER BY captured_at DESC
     LIMIT $${paramIdx}`,
    params
  );

  if (result.rows.length === 0) {
    return { content: [{ type: "text" as const, text: "No recent captures found." }] };
  }

  const text = result.rows
    .map(
      (r: Record<string, unknown>, i: number) =>
        `**${i + 1}. #${r.id}** [${r.domain}/${r.type}] — ${new Date(r.captured_at as string).toLocaleDateString()}\n${(r.content as string).slice(0, 200)}${(r.content as string).length > 200 ? "..." : ""}`
    )
    .join("\n\n");

  return { content: [{ type: "text" as const, text }] };
}
