import { query } from "../db.js";

export async function contextStats() {
  const [captureStats, factStats, domainCaptures, domainFacts, recent] =
    await Promise.all([
      query("SELECT COUNT(*) as count FROM captures"),
      query("SELECT COUNT(*) as count FROM facts WHERE valid_until IS NULL"),
      query(
        "SELECT domain, COUNT(*) as count FROM captures GROUP BY domain ORDER BY count DESC"
      ),
      query(
        "SELECT domain, COUNT(*) as count FROM facts WHERE valid_until IS NULL GROUP BY domain ORDER BY count DESC"
      ),
      query(
        "SELECT captured_at FROM captures ORDER BY captured_at DESC LIMIT 1"
      ),
    ]);

  const totalCaptures = captureStats.rows[0].count;
  const totalFacts = factStats.rows[0].count;
  const lastCapture = recent.rows[0]?.captured_at ?? "never";

  const captureDomains = domainCaptures.rows
    .map((r: Record<string, unknown>) => `  ${r.domain}: ${r.count}`)
    .join("\n");

  const factDomains = domainFacts.rows
    .map((r: Record<string, unknown>) => `  ${r.domain}: ${r.count}`)
    .join("\n");

  const text = [
    `**Knowledge Base Stats**`,
    `Total captures: ${totalCaptures}`,
    `Total active facts: ${totalFacts}`,
    `Last capture: ${lastCapture}`,
    "",
    `**Captures by domain:**`,
    captureDomains || "  (none)",
    "",
    `**Facts by domain:**`,
    factDomains || "  (none)",
  ].join("\n");

  return { content: [{ type: "text" as const, text }] };
}
