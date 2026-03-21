import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface StatusJson {
  repo: string;
  slug: string;
  updated_at: string;
  error: string | null;
  awaiting_your_review?: PrEntry[];
  your_prs_pending_review?: PrEntry[];
  recently_merged?: PrEntry[];
  recent_issues?: IssueEntry[];
  recent_activity_on_your_prs?: ActivityEntry[];
  demoted_reviews?: PrEntry[];
  stale_filtered?: number;
  summary?: {
    open_issues: number;
    open_prs: number;
    merged_last_14d: number;
    opened_last_14d: number;
  };
}

interface PrEntry {
  number: number;
  title: string;
  author: string;
  url: string;
  updated_at: string;
  labels: string[];
  note?: string;
  merged_at?: string;
  requested_reviewers?: string[];
  review_decision?: string;
  latest_reviews?: { author: string; state: string }[];
}

interface IssueEntry {
  number: number;
  title: string;
  state: string;
  assignee: string;
  created_at: string;
  labels: string[];
}

interface ActivityEntry {
  pr: number;
  type: "review" | "comment";
  author: string;
  state?: string;
  at: string;
  snippet: string;
}

type ActionItem = (PrEntry | ActivityEntry) & { repo: string };
type TeamItem = (PrEntry | IssueEntry) & { repo: string; activity_type: string };

interface PulseResult {
  as_of: string;
  needs_your_action: ActionItem[];
  your_prs_waiting: (PrEntry & { repo: string })[];
  team_activity: TeamItem[];
  stale_filtered: number;
  data_age_minutes: number;
  warnings: string[];
}

function minutesAgo(isoString: string): number {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  return Math.round((now - then) / 60000);
}

async function loadStatusFiles(vaultRoot: string): Promise<StatusJson[]> {
  const projectsDir = join(vaultRoot, "projects");
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const results: StatusJson[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const statusPath = join(projectsDir, entry.name, "github", "status.json");
    try {
      const content = await readFile(statusPath, "utf-8");
      const parsed = JSON.parse(content) as StatusJson;
      results.push(parsed);
    } catch {
      // Skip missing or corrupt files silently
    }
  }
  return results;
}

export async function projectPulse(args: {
  repo?: string;
  vaultRoot: string;
}) {
  const statuses = await loadStatusFiles(args.vaultRoot);

  if (statuses.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          as_of: new Date().toISOString(),
          needs_your_action: [],
          your_prs_waiting: [],
          team_activity: [],
          stale_filtered: 0,
          data_age_minutes: -1,
          warnings: ["No status.json files found. Run: python3 sync-github.py --status"],
        }),
      }],
    };
  }

  // Filter to specific repo if requested
  const filtered = args.repo
    ? statuses.filter(s => s.repo === args.repo)
    : statuses;

  const warnings: string[] = [];
  let oldestUpdate = Date.now();
  let totalStale = 0;

  const needsAction: ActionItem[] = [];
  const prsWaiting: (PrEntry & { repo: string })[] = [];
  const teamActivity: TeamItem[] = [];

  for (const status of filtered) {
    if (status.error) {
      warnings.push(`${status.repo}: ${status.error}`);
      continue;
    }

    const updateTime = new Date(status.updated_at).getTime();
    if (updateTime < oldestUpdate) oldestUpdate = updateTime;

    totalStale += status.stale_filtered ?? 0;

    // Needs your action — review requests
    for (const pr of status.awaiting_your_review ?? []) {
      needsAction.push({ ...pr, repo: status.repo });
    }

    // Needs your action — recent activity on your PRs needing response
    for (const act of status.recent_activity_on_your_prs ?? []) {
      needsAction.push({ ...act, repo: status.repo } as ActionItem);
    }

    // Your PRs waiting
    for (const pr of status.your_prs_pending_review ?? []) {
      prsWaiting.push({ ...pr, repo: status.repo });
    }

    // Team activity — recently merged
    for (const pr of status.recently_merged ?? []) {
      teamActivity.push({ ...pr, repo: status.repo, activity_type: "merged" });
    }

    // Team activity — demoted reviews (someone else already reviewed)
    for (const pr of status.demoted_reviews ?? []) {
      teamActivity.push({ ...pr, repo: status.repo, activity_type: "review_covered" });
    }

    // Team activity — recent issues
    for (const issue of status.recent_issues ?? []) {
      teamActivity.push({ ...issue, repo: status.repo, activity_type: "issue" });
    }
  }

  // Sort by recency — extract the most relevant timestamp from heterogeneous item types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getTimestamp(item: any): string {
    return (item.at ?? item.updated_at ?? item.merged_at ?? item.created_at ?? "") as string;
  }

  needsAction.sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)));
  prsWaiting.sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)));
  teamActivity.sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)));

  const result: PulseResult = {
    as_of: new Date().toISOString(),
    needs_your_action: needsAction,
    your_prs_waiting: prsWaiting,
    team_activity: teamActivity.slice(0, 30),
    stale_filtered: totalStale,
    data_age_minutes: Math.round((Date.now() - oldestUpdate) / 60000),
    warnings,
  };

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(result, null, 2),
    }],
  };
}
