import "dotenv/config";
import { execSync } from "child_process";
import { ingestGitHubIssues } from "./ingestion/github.js";
import type { GitHubIssue } from "./ingestion/chunkers/github-issue.js";

function usage(): never {
  console.error(`Usage: npx tsx src/ingest-github.ts [options]

Ingest GitHub issues into open-brain. Reads issue JSON from stdin or fetches via gh CLI.

Options:
  --repo <owner/repo>   Fetch issues from this repo using gh CLI
  --domain <d>          Override auto-detected domain for all chunks
  --dry-run             Show what would be ingested without writing
  --limit <n>           Max issues to fetch when using --repo (default: 500)
  --state <state>       Issue state filter: open, closed, all (default: all)

Examples:
  # Pipe from gh CLI
  gh issue list -R org/repo --json number,title,body,updatedAt,comments,labels,author,url -L 500 \\
    | npx tsx src/ingest-github.ts --repo org/repo

  # Let the CLI fetch for you
  npx tsx src/ingest-github.ts --repo org/repo

  # Dry run
  npx tsx src/ingest-github.ts --repo org/repo --dry-run`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) usage();

  const repoIdx = argv.indexOf("--repo");
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : undefined;

  const domainIdx = argv.indexOf("--domain");
  const domain = domainIdx >= 0 ? argv[domainIdx + 1] : undefined;

  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) : 500;

  const stateIdx = argv.indexOf("--state");
  const state = stateIdx >= 0 ? argv[stateIdx + 1] : "all";

  const dryRun = argv.includes("--dry-run");

  return { repo, domain, limit, state, dryRun };
}

const GH_JSON_FIELDS = "number,title,body,updatedAt,comments,labels,author,url";

function fetchIssuesViaGh(
  repo: string,
  limit: number,
  state: string
): GitHubIssue[] {
  console.error(`Fetching issues from ${repo} via gh CLI...`);
  const cmd = `gh issue list -R ${repo} --json ${GH_JSON_FIELDS} -L ${limit} --state ${state}`;
  const output = execSync(cmd, {
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024, // 100MB
  });
  return JSON.parse(output) as GitHubIssue[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);

    // If stdin is a TTY (no pipe), resolve empty after brief timeout
    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.repo) {
    console.error("Error: --repo is required");
    usage();
  }

  let issues: GitHubIssue[];

  // Try reading from stdin first
  const stdinData = await readStdin();
  if (stdinData.trim().length > 0) {
    const parsed = JSON.parse(stdinData);
    // Handle both single object (gh issue view) and array (gh issue list)
    issues = Array.isArray(parsed) ? parsed : [parsed];
    console.error(`Read ${issues.length} issue(s) from stdin`);
  } else {
    // Fetch via gh CLI
    issues = fetchIssuesViaGh(args.repo, args.limit, args.state);
    console.error(`Fetched ${issues.length} issues from ${args.repo}`);
  }

  if (issues.length === 0) {
    console.log("No issues to ingest.");
    return;
  }

  const result = await ingestGitHubIssues(
    issues,
    args.repo,
    { domain: args.domain, dryRun: args.dryRun },
    (msg) => console.error(msg)
  );

  const prefix = args.dryRun ? "[DRY RUN] " : "";
  console.log(
    `\n${prefix}Summary:` +
      `\n  Issues: ${result.ingested} ingested, ${result.skipped} skipped, ${result.failed} failed` +
      `\n  Chunks: ${result.totalChunks}`
  );

  process.exit(result.failed > 0 && result.ingested === 0 ? 2 : result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
