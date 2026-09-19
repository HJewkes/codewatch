import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadChurnEntries } from "@titan-design/code-graph/history";
import { loadHistoryMetrics } from "../history-adapter.js";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";
import type { GraphNode } from "../types.js";

const DAY = 86400;
const NOW = Date.parse("2025-06-01T00:00:00Z") / 1000;

const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codewatch-history-")));
  dirs.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function git(dir: string, args: string[], epoch?: number): void {
  const date = epoch === undefined ? {} : { GIT_AUTHOR_DATE: `@${epoch}`, GIT_COMMITTER_DATE: `@${epoch}` };
  execFileSync("git", args, {
    cwd: dir,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, ...date },
  });
}

async function commitFile(dir: string, rel: string, body: string, author: string, epoch?: number): Promise<void> {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), body);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", `user.name=${author}`, "-c", `user.email=${author}@example.com`, "commit", "-q", "-m", rel], epoch);
}

function fileNode(id: string): GraphNode {
  return { id, kind: "file", name: path.basename(id), attrs: {} } as GraphNode;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe("history metric names and windows", () => {
  it("pins every metric the adapter emits for a fixed-date repo", async () => {
    const dir = await makeRepo();
    await commitFile(dir, "b.ts", "b\n", "alice", NOW - 200 * DAY);
    await commitFile(dir, "a.ts", "a\n", "alice", NOW - 100 * DAY);
    await commitFile(dir, "a.ts", "a\na\na\n", "bob", NOW - 10 * DAY);

    const loaded = loadHistoryMetrics([fileNode("a.ts"), fileNode("b.ts")], dir, {
      churnWindowDays: 30,
      includeLifetime: true,
      nowEpoch: NOW,
    });

    const rows = loaded!.metrics.map((m) => `${m.nodeId} ${m.name} ${m.value} ${m.unit}`).sort();
    expect(rows).toEqual([
      "a.ts bus_factor_30d 1 count",
      "a.ts bus_factor_lifetime 1 count",
      "a.ts churn_180d 3 lines",
      "a.ts churn_180d_authors 2 count",
      "a.ts churn_180d_commits 2 count",
      "a.ts churn_30d 2 lines",
      "a.ts churn_30d_authors 1 count",
      "a.ts churn_30d_commits 1 count",
      "a.ts churn_90d 2 lines",
      "a.ts churn_90d_authors 1 count",
      "a.ts churn_90d_commits 1 count",
      "a.ts churn_lifetime 3 lines",
      "a.ts churn_lifetime_authors 2 count",
      "a.ts churn_lifetime_commits 2 count",
      "a.ts file_age_days 100 days",
      "a.ts recency_180d 0.556 ratio",
      "a.ts recency_30d 1 ratio",
      "a.ts recency_90d 1 ratio",
      "a.ts recency_lifetime 1 ratio",
      "a.ts top_author_share_30d 1 ratio",
      "a.ts top_author_share_lifetime 0.667 ratio",
      "b.ts bus_factor_lifetime 1 count",
      "b.ts churn_lifetime 1 lines",
      "b.ts churn_lifetime_authors 1 count",
      "b.ts churn_lifetime_commits 1 count",
      "b.ts file_age_days 200 days",
      "b.ts recency_lifetime 1 ratio",
      "b.ts top_author_share_lifetime 1 ratio",
    ]);
    expect(loaded!.primaryEntries.map((e) => e.filePath)).toEqual(["a.ts"]);
  });
});

describe("paths codewatch hands to the history engine", () => {
  it("keys history on the same repo-relative ids the indexer gives file nodes, through a symlinked root and a subdir", async () => {
    const dir = await makeRepo();
    await commitFile(dir, "packages/a/src/x.ts", "export const x = 1;\n", "alice");
    await commitFile(dir, "packages/a/src/x.ts", "export const x = 2;\n", "bob");
    await commitFile(dir, "packages/b/y.ts", "export const y = 1;\n", "alice");
    const link = `${dir}-link`;
    await fs.symlink(dir, link);
    dirs.push(link);

    const result = await runGraphIndex({ rootDirs: [path.join(link, "packages", "a")], ref: "head" });
    const db = openDatabase(path.join(dir, ".codewatch", "graph.db"));
    try {
      const fileIds = db.listNodes(result.snapshotId).filter((n) => n.kind === "file").map((n) => n.id);
      const churned = db.listMetrics(result.snapshotId).filter((m) => m.name === "churn_30d").map((m) => m.nodeId);
      const enginePaths = new Set(loadChurnEntries({ repoRoot: dir })!.map((e) => e.filePath));

      expect(fileIds).toEqual(["packages/a/src/x.ts"]);
      expect(churned).toEqual(fileIds);
      expect(enginePaths.has("packages/a/src/x.ts")).toBe(true);
    } finally {
      db.close();
    }
  });
});
