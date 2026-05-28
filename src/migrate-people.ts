import { query } from "./db.js";
import { canonicalizePeople } from "./services/people.js";

interface MigrateOptions {
  dryRun: boolean;
}

interface Summary {
  capturesChanged: number;
  capturesUnchanged: number;
  factsChanged: number;
  factsUnchanged: number;
  collapsedByCanonical: Record<string, number>;
}

export async function migratePeople(opts: MigrateOptions): Promise<Summary> {
  const summary: Summary = {
    capturesChanged: 0,
    capturesUnchanged: 0,
    factsChanged: 0,
    factsUnchanged: 0,
    collapsedByCanonical: {},
  };

  const capturesResult = await query(
    "SELECT id, people FROM captures WHERE people IS NOT NULL AND cardinality(people) > 0",
  );
  for (const row of capturesResult.rows as Array<{ id: number; people: string[] }>) {
    const before = row.people;
    const after = canonicalizePeople(before);
    if (arraysEqual(before, after)) {
      summary.capturesUnchanged++;
      continue;
    }
    summary.capturesChanged++;
    countCollapsesByCanonical(before, after, summary.collapsedByCanonical);
    if (!opts.dryRun) {
      await query("UPDATE captures SET people = $1 WHERE id = $2", [after, row.id]);
    }
  }

  const factsResult = await query(
    "SELECT id, people FROM facts WHERE people IS NOT NULL AND cardinality(people) > 0",
  );
  for (const row of factsResult.rows as Array<{ id: number; people: string[] }>) {
    const before = row.people;
    const after = canonicalizePeople(before);
    if (arraysEqual(before, after)) {
      summary.factsUnchanged++;
      continue;
    }
    summary.factsChanged++;
    countCollapsesByCanonical(before, after, summary.collapsedByCanonical);
    if (!opts.dryRun) {
      await query("UPDATE facts SET people = $1 WHERE id = $2", [after, row.id]);
    }
  }

  return summary;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function countCollapsesByCanonical(
  before: string[],
  after: string[],
  counts: Record<string, number>,
): void {
  const afterSet = new Set(after);
  for (const original of before) {
    const lower = original.toLowerCase();
    if (afterSet.has(lower)) continue; // already canonical
    const [canonical] = canonicalizePeople([original]);
    if (canonical) counts[canonical] = (counts[canonical] ?? 0) + 1;
  }
}

function printSummary(s: Summary, dryRun: boolean): void {
  const mode = dryRun ? "DRY RUN" : "LIVE";
  console.log(`\n=== migrate-people [${mode}] ===`);
  console.log(`captures: ${s.capturesChanged} changed, ${s.capturesUnchanged} unchanged`);
  console.log(`facts:    ${s.factsChanged} changed, ${s.factsUnchanged} unchanged`);
  console.log(`\ncollapses by canonical:`);
  const entries = Object.entries(s.collapsedByCanonical).sort((a, b) => b[1] - a[1]);
  for (const [canonical, n] of entries) {
    console.log(`  ${canonical}: +${n} entries`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const summary = await migratePeople({ dryRun });
  printSummary(summary, dryRun);
  process.exit(0);
}

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    console.error("migrate-people failed:", err);
    process.exit(1);
  });
}
