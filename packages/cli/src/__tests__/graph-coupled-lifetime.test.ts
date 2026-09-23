import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  formatGraphCoupledJson,
  formatGraphCoupledText,
  runGraphCoupledCommand,
} from "../commands/graph-coupled.js";

const OLD_DATE = "2020-01-15T12:00:00Z";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: OLD_DATE,
      GIT_COMMITTER_DATE: OLD_DATE,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
}

async function commitBoth(repo: string, marker: string): Promise<void> {
  await fs.writeFile(path.join(repo, "a.ts"), `export const a = "${marker}";\n`);
  await fs.writeFile(path.join(repo, "b.ts"), `export const b = "${marker}";\n`);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", `edit ${marker}`]);
}

describe("graph coupled with a lifetime window", () => {
  let dir: string;
  let repo: string;
  let db: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-coupled-"));
    repo = path.join(dir, "repo");
    db = path.join(dir, "graph.db");
    await fs.mkdir(repo);
    git(repo, ["init", "-q"]);
    await commitBoth(repo, "one");
    await commitBoth(repo, "two");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns rows for co-edits older than any rolling window", () => {
    const rolling = runGraphCoupledCommand({ db, repoRoot: repo, windowDays: 30 });
    expect(rolling.rows).toHaveLength(0);

    const lifetime = runGraphCoupledCommand({ db, repoRoot: repo, windowDays: "lifetime" });
    expect(lifetime.windowDays).toBe("lifetime");
    expect(lifetime.rows).toHaveLength(1);
    expect(lifetime.rows[0]).toMatchObject({ fileA: "a.ts", fileB: "b.ts", count: 2 });
  });

  it("reports the window as lifetime in both output formats", () => {
    const result = runGraphCoupledCommand({ db, repoRoot: repo, windowDays: "lifetime" });
    expect(JSON.parse(formatGraphCoupledJson(result)).windowDays).toBe("lifetime");
    expect(formatGraphCoupledText(result)).toContain("all-time");
  });
});
