import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { projectPulse } from "../project-pulse.js";

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe("projectPulse — open issues awareness bucket", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  async function writeStatus(slug: string, status: Record<string, unknown>) {
    const dir = join(tmpDir, "projects", slug, "github");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify(status));
  }

  async function run() {
    const res = await projectPulse({ vaultRoot: tmpDir });
    return JSON.parse(res.content[0].text);
  }

  function issue(over: Record<string, unknown>) {
    return {
      number: 0,
      title: "issue",
      state: "OPEN",
      assignee: "?",
      created_at: iso(DAY),
      updated_at: iso(DAY),
      labels: [],
      ...over,
    };
  }

  it("routes issues to recent_issues (not team_activity) with gold/new/active flags", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pulse-test-"));
    await writeStatus("repo-a", {
      repo: "repo-a",
      slug: "o/repo-a",
      updated_at: iso(5 * 60 * 1000),
      error: null,
      worked_on_recently: true,
      recently_merged: [
        { number: 9, title: "merged thing", author: "x", url: "",
          updated_at: iso(DAY), labels: [], merged_at: iso(DAY) },
      ],
      recent_issues: [
        issue({ number: 1, title: "brand new",
          created_at: iso(0.5 * DAY), updated_at: iso(0.2 * DAY) }),
        issue({ number: 2, title: "older but active", assignee: "jack",
          created_at: iso(10 * DAY), updated_at: iso(0.5 * DAY) }),
        issue({ number: 3, title: "older, touched mid-window",
          created_at: iso(20 * DAY), updated_at: iso(10 * DAY) }),
        issue({ number: 4, title: "gone quiet (beyond 14d)",
          created_at: iso(30 * DAY), updated_at: iso(20 * DAY) }),
      ],
    });

    const pulse = await run();

    // Issues live in their own bucket, never in team activity. #4 fell off (>14d).
    expect(pulse.recent_issues.map((i: { number: number }) => i.number).sort())
      .toEqual([1, 2, 3]);
    expect(pulse.team_activity.some(
      (t: { activity_type: string }) => t.activity_type === "issue")).toBe(false);
    // Merges still flow to team activity.
    expect(pulse.team_activity.some((t: { number: number }) => t.number === 9))
      .toBe(true);

    const byNum = Object.fromEntries(
      pulse.recent_issues.map((i: { number: number }) => [i.number, i]));
    // gold passes through from the repo's worked_on_recently flag
    expect(byNum[1].gold).toBe(true);
    // created <=2d -> new (new wins; never both)
    expect(byNum[1].is_new).toBe(true);
    expect(byNum[1].is_active).toBe(false);
    // older but in-window -> active, not new. Two-state: every kept issue is one or the other.
    expect(byNum[2].is_new).toBe(false);
    expect(byNum[2].is_active).toBe(true);
    expect(byNum[3].is_new).toBe(false);
    expect(byNum[3].is_active).toBe(true);
  });

  it("drops issues inactive beyond the 14-day window and defaults gold to false", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pulse-test-"));
    await writeStatus("repo-b", {
      repo: "repo-b",
      slug: "o/repo-b",
      updated_at: iso(5 * 60 * 1000),
      error: null,
      // worked_on_recently omitted -> gold must default false
      recent_issues: [
        issue({ number: 10, title: "fresh", created_at: iso(DAY), updated_at: iso(DAY) }),
        issue({ number: 11, title: "stale",
          created_at: iso(60 * DAY), updated_at: iso(40 * DAY) }),
      ],
    });

    const pulse = await run();
    const nums = pulse.recent_issues.map((i: { number: number }) => i.number);
    expect(nums).toContain(10);
    expect(nums).not.toContain(11); // beyond the 14-day activity window
    expect(pulse.recent_issues.find((i: { number: number }) => i.number === 10).gold)
      .toBe(false);
  });
});
