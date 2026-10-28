import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openCodeGraph } from "@titan-design/code-graph";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(HERE, "../../dist/index.js");
const CI_WORKFLOW = path.resolve(HERE, "../../../../.github/workflows/ci.yml");
const HOT_FILE = "src/a.ts";
const SPAWN_TIMEOUT_MS = 60_000;
const HISTORY_METRICS = ["churn_30d", "recency_30d", "file_age_days"];

function git(cwd: string, args: string[], date?: string): void {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

async function commitFile(repo: string, file: string, body: string, date: string): Promise<void> {
  await fs.writeFile(path.join(repo, file), body);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `edit ${file}`], date);
}

function indexRev(repo: string, ref: string): number {
  const args = [CLI_ENTRY, "graph", "index", "src", "--rev", "HEAD", "--ref", ref, "--json"];
  const run = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout).snapshotId;
}

function historyMetrics(repo: string, snapshotId: number): Record<string, number | null> {
  const store = openCodeGraph(path.join(repo, ".codewatch", "graph.db"));
  try {
    const metrics = store.listMetricsForNode(snapshotId, HOT_FILE);
    return Object.fromEntries(
      metrics.filter((m) => HISTORY_METRICS.includes(m.name)).map((m) => [m.name, m.value]),
    );
  } finally {
    store.close();
  }
}

describe("fitness gate history metrics for a file the head commit leaves alone", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codewatch-gate-dates-")));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "fixture@example.com"]);
    git(repo, ["config", "user.name", "fixture"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    await fs.mkdir(path.join(repo, "src"));
    await commitFile(repo, HOT_FILE, "export const a = 1;\n", "2020-03-01T00:00:00Z");
    await commitFile(repo, HOT_FILE, "export const a = 2;\n", "2020-03-05T00:00:00Z");
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("dates churn and recency from the rev's commit, not the wall clock", () => {
    const baseline = indexRev(repo, "baseline");

    expect(historyMetrics(repo, baseline)).toEqual({ churn_30d: 3, recency_30d: 0.133, file_age_days: 4 });
  }, SPAWN_TIMEOUT_MS);

  it("gives identical churn and recency in baseline and head", async () => {
    const baseline = indexRev(repo, "baseline");
    await commitFile(repo, "src/b.ts", "export const b = 1;\n", "2020-03-05T00:00:00Z");

    const head = indexRev(repo, "head");

    expect(historyMetrics(repo, head)).toEqual(historyMetrics(repo, baseline));
  }, SPAWN_TIMEOUT_MS);
});

describe("CI fitness gate", () => {
  it("indexes every snapshot from a git rev, so head and baseline share one clock", () => {
    const indexCommands = readFileSync(CI_WORKFLOW, "utf8")
      .split(/\n(?!\s+--)/)
      .filter((command) => command.includes("graph index"));

    expect(indexCommands.length).toBeGreaterThanOrEqual(2);
    for (const command of indexCommands) expect(command).toMatch(/--rev\s/);
  });
});
