import "dotenv/config";
import { resolve } from "path";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { syncVaultIndex } from "./sync/orchestrator.js";
import { getPool } from "./db.js";

function usage(): never {
  console.error(`Usage: npx tsx src/sync-vault-index.ts --config <path> [options]

Options:
  --config <path>   Path to vault config JSON (required)
  --dry-run         Show what would be ingested/deleted without writing
  --force           Re-ingest all files regardless of manifest/sources state
  --verbose         Detailed logging of each file decision

Environment:
  DATABASE_URL      Postgres connection string
  OPENAI_API_KEY    For embedding generation

Examples:
  npx tsx src/sync-vault-index.ts --config ./vault-config.json
  npx tsx src/sync-vault-index.ts --config ./vault-config.json --dry-run
  npx tsx src/sync-vault-index.ts --config ./vault-config.json --force`);
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.config) {
    console.error("Error: --config is required");
    usage();
  }

  // Set COLLECTOR_CONFIG so loadConfig() picks it up
  process.env.COLLECTOR_CONFIG = resolve(values.config);
  const config = loadConfig();

  if (!config.vaultRoot) {
    console.error("Error: config must specify vaultRoot");
    process.exit(2);
  }

  const vaultRoot = resolve(config.vaultRoot);

  // Apply defaults for indexSync sub-fields
  const include = config.indexSync?.include ?? ["**"];
  const exclude = config.indexSync?.exclude ?? [];
  const extensions = config.indexSync?.extensions ?? [".md", ".pdf", ".txt"];

  const dryRun = values["dry-run"]!;
  const force = values.force!;
  const verbose = values.verbose!;

  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(
    `${prefix}sync-vault-index — ${new Date().toISOString().slice(0, 10)}`
  );
  console.log(`Config: ${process.env.COLLECTOR_CONFIG}`);
  console.log(`Vault root: ${vaultRoot}`);
  console.log();

  const result = await syncVaultIndex(
    { vaultRoot, include, exclude, extensions, dryRun, force, verbose },
    (msg) => console.log(msg)
  );

  console.log();
  console.log(
    `${prefix}Summary: ${result.newCount} new, ${result.changedCount} re-ingested, ` +
      `${result.deletedCount} deleted, ${result.unchangedCount} skipped`
  );

  if (result.failures.length > 0) {
    console.log(`\nFailed (${result.failures.length}):`);
    for (const f of result.failures) {
      console.log(`  ${f.path}: ${f.error}`);
    }
  }

  if (dryRun) {
    console.log("\nManifest not updated (dry run).");
  } else if (result.failedCount > 0) {
    console.log(
      `Manifest: per-file mtimes recorded for successes; last_run not advanced (${result.failedCount} failure${result.failedCount === 1 ? "" : "s"}).`
    );
  } else {
    console.log("Manifest updated.");
  }

  // Clean up the connection pool (only if we actually used it)
  if (!dryRun) {
    const pool = await getPool();
    await pool.end();
  }

  process.exit(result.failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
