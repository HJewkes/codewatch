import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";

interface Repo {
  dir: string;
  dbPath: string;
}

function git(repoDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
}

async function createRepo(): Promise<Repo> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-churn-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "alice@example.com"]);
  git(dir, ["config", "user.name", "alice"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return { dir, dbPath: path.join(dir, ".codewatch", "graph.db") };
}

async function writeFile(repoDir: string, relPath: string, contents: string): Promise<void> {
  const abs = path.join(repoDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

async function commit(repoDir: string, message: string, author?: string): Promise<void> {
  git(repoDir, ["add", "-A"]);
  if (author) {
    git(repoDir, [
      "-c",
      `user.name=${author}`,
      "-c",
      `user.email=${author}@example.com`,
      "commit",
      "-q",
      "-m",
      message,
    ]);
  } else {
    git(repoDir, ["commit", "-q", "-m", message]);
  }
}

describe("runGraphIndex with churn metrics", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(async () => {
    await fs.rm(repo.dir, { recursive: true, force: true });
  });

  it("records churn_30d/_commits/_authors per indexed file", async () => {
    await writeFile(repo.dir, "src/hot.ts", "export const x = 1;\n");
    await writeFile(repo.dir, "src/cold.ts", "export const y = 2;\n");
    await commit(repo.dir, "init");

    await writeFile(
      repo.dir,
      "src/hot.ts",
      ["export const x = 1;", "export const z = 3;", ""].join("\n"),
    );
    await commit(repo.dir, "extend hot", "bob");

    await writeFile(
      repo.dir,
      "src/hot.ts",
      ["export const x = 1;", "export const z = 3;", "export const q = 4;", ""].join("\n"),
    );
    await commit(repo.dir, "extend hot more");

    const result = await runGraphIndex({ rootDir: repo.dir, ref: "head" });
    const db = openDatabase(repo.dbPath);
    try {
      const all = db.listMetrics(result.snapshotId);
      const byKey = (id: string, name: string): number | undefined =>
        all.find((m) => m.nodeId === id && m.name === name)?.value ?? undefined;

      expect(byKey("src/hot.ts", "churn_30d")).toBeGreaterThan(0);
      expect(byKey("src/hot.ts", "churn_30d_commits")).toBe(3);
      expect(byKey("src/hot.ts", "churn_30d_authors")).toBe(2);
      expect(byKey("src/cold.ts", "churn_30d_commits")).toBe(1);
      expect(byKey("src/cold.ts", "churn_30d_authors")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("honours --churn-window via the option key in metric names", async () => {
    await writeFile(repo.dir, "src/a.ts", "export const a = 1;\n");
    await commit(repo.dir, "init");

    const result = await runGraphIndex({
      rootDir: repo.dir,
      ref: "head",
      churnWindowDays: 7,
    });
    const db = openDatabase(repo.dbPath);
    try {
      const all = db.listMetrics(result.snapshotId);
      const names = new Set(all.map((m) => m.name));
      expect(names.has("churn_7d")).toBe(true);
      expect(names.has("churn_7d_commits")).toBe(true);
      expect(names.has("churn_7d_authors")).toBe(true);
      expect(names.has("churn_30d")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("emits no churn metrics when computeChurn=false", async () => {
    await writeFile(repo.dir, "src/a.ts", "export const a = 1;\n");
    await commit(repo.dir, "init");

    const result = await runGraphIndex({
      rootDir: repo.dir,
      ref: "head",
      computeChurn: false,
    });
    const db = openDatabase(repo.dbPath);
    try {
      const all = db.listMetrics(result.snapshotId);
      expect(all.some((m) => m.name.startsWith("churn_"))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("produces git-root-relative ids even when indexing a subdir", async () => {
    // Scanning packages/ should still yield ids rooted at the git toplevel
    // (packages/foo/src/inside.ts, not foo/src/inside.ts) so that snapshots
    // taken from different cwds stay comparable. Files outside the scan
    // range (outside.ts at the repo root) are still excluded by the walker.
    await writeFile(repo.dir, "packages/foo/src/inside.ts", "export const a = 1;\n");
    await writeFile(repo.dir, "outside.ts", "export const b = 2;\n");
    await commit(repo.dir, "init");

    await writeFile(
      repo.dir,
      "packages/foo/src/inside.ts",
      ["export const a = 1;", "export const c = 3;", ""].join("\n"),
    );
    await commit(repo.dir, "edit inside");

    const result = await runGraphIndex({
      rootDir: path.join(repo.dir, "packages"),
      ref: "head",
    });
    const db = openDatabase(path.join(repo.dir, "packages", ".codewatch", "graph.db"));
    try {
      const all = db.listMetrics(result.snapshotId);
      const inside = all.find(
        (m) => m.nodeId === "packages/foo/src/inside.ts" && m.name === "churn_30d",
      );
      expect(inside?.value ?? 0).toBeGreaterThan(0);
      expect(all.some((m) => m.nodeId.includes("outside.ts"))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("attributes churn to the new path after a rename", async () => {
    await writeFile(repo.dir, "src/old.ts", "export const v = 1;\n");
    await commit(repo.dir, "init");

    git(repo.dir, ["mv", "src/old.ts", "src/new.ts"]);
    await writeFile(
      repo.dir,
      "src/new.ts",
      ["export const v = 1;", "export const w = 2;", ""].join("\n"),
    );
    await commit(repo.dir, "rename + edit");

    const result = await runGraphIndex({ rootDir: repo.dir, ref: "head" });
    const db = openDatabase(repo.dbPath);
    try {
      const all = db.listMetrics(result.snapshotId);
      const churnNew = all.find((m) => m.nodeId === "src/new.ts" && m.name === "churn_30d");
      expect(churnNew?.value ?? 0).toBeGreaterThan(0);
      const churnOld = all.find((m) => m.nodeId === "src/old.ts");
      expect(churnOld).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
