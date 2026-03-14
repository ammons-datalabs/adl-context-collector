import "dotenv/config";
import { resolve } from "path";
import { parseArgs } from "node:util";
import { ingestFile, ingestDirectory } from "./ingestion/index.js";
import { detectFormat } from "./ingestion/types.js";
import { stat } from "fs/promises";

function usage(): never {
  console.error(`Usage: npx tsx src/ingest-cli.ts <path> [options]

Options:
  --recursive     Recurse into subdirectories
  --domain <d>    Override auto-detected domain for all chunks
  --dry-run       Show what would be ingested without writing

Examples:
  npx tsx src/ingest-cli.ts ./report.pdf
  npx tsx src/ingest-cli.ts ./docs --recursive
  npx tsx src/ingest-cli.ts ./vault --recursive --domain platform --dry-run`);
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      recursive: { type: "boolean", default: false },
      domain: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length === 0) {
    usage();
  }

  const targetPath = resolve(positionals[0]);
  const recursive = values.recursive!;
  const dryRun = values["dry-run"]!;
  const domain = values.domain;

  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch {
    console.error(`Error: path not found: ${targetPath}`);
    process.exit(2);
  }

  const options = { domain, recursive, dryRun };

  if (targetStat.isFile()) {
    if (!detectFormat(targetPath)) {
      console.error(`Error: unsupported file type: ${targetPath}`);
      process.exit(2);
    }

    console.error(`Ingesting ${targetPath}...`);
    const result = await ingestFile(targetPath, options);
    const prefix = dryRun ? "[DRY RUN] " : "";
    console.log(
      `${prefix}${result.status}: ${result.chunkCount} chunks` +
        (result.failedChunks > 0 ? ` (${result.failedChunks} failed)` : "") +
        (result.skippedDuplicates > 0 ? ` (${result.skippedDuplicates} duplicate)` : "")
    );
    process.exit(result.status === "failed" ? 1 : 0);
  }

  if (targetStat.isDirectory()) {
    console.error(`Ingesting directory ${targetPath}...`);
    const result = await ingestDirectory(targetPath, options, (msg) =>
      console.error(msg)
    );

    const prefix = dryRun ? "[DRY RUN] " : "";
    console.log(
      `\n${prefix}Summary:` +
        `\n  Files: ${result.ingested} ingested, ${result.skipped} skipped, ${result.failed} failed` +
        `\n  Chunks: ${result.totalChunks}`
    );

    if (result.failed > 0) {
      console.log("\nFailed files:");
      for (const fr of result.fileResults.filter((f) => f.status === "failed")) {
        console.log(`  ${fr.filePath}: ${fr.error ?? "all chunks failed"}`);
      }
    }

    process.exit(result.failed > 0 && result.ingested === 0 ? 2 : result.failed > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
