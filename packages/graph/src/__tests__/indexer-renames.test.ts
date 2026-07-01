import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";
import { diffSnapshots } from "../diff.js";

interface Repo {
  dir: string;
  dbPath: string;
}

function git(repoDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
}

async function createRepo(): Promise<Repo> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-renames-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return { dir, dbPath: path.join(dir, ".codewatch", "graph.db") };
}

async function commitFile(
  repoDir: string,
  relPath: string,
  contents: string,
  message: string,
): Promise<void> {
  const abs = path.join(repoDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
  git(repoDir, ["add", relPath]);
  git(repoDir, ["commit", "-q", "-m", message]);
}

async function renameFile(
  repoDir: string,
  oldPath: string,
  newPath: string,
  message: string,
): Promise<void> {
  await fs.mkdir(path.join(repoDir, path.dirname(newPath)), { recursive: true });
  git(repoDir, ["mv", oldPath, newPath]);
  git(repoDir, ["commit", "-q", "-m", message]);
}

describe("runGraphIndex with git rename detection", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(async () => {
    await fs.rm(repo.dir, { recursive: true, force: true });
  });

  it("populates id_alias when a file is renamed between snapshots", async () => {
    await commitFile(
      repo.dir,
      "src/a.ts",
      "export const A = 1;\n",
      "init",
    );
    await commitFile(
      repo.dir,
      "src/b.ts",
      "export const B = 2;\n",
      "add b",
    );

    const first = await runGraphIndex({
      rootDir: repo.dir,
      ref: "main",
    });
    expect(first.aliases).toBe(0);

    await renameFile(repo.dir, "src/a.ts", "src/renamed.ts", "rename a → renamed");

    const second = await runGraphIndex({
      rootDir: repo.dir,
      ref: "head",
    });
    expect(second.aliases).toBeGreaterThanOrEqual(2);

    const db = openDatabase(repo.dbPath);
    try {
      const aliases = db.listAliases(second.snapshotId);
      const oldIds = new Set(aliases.map((a) => a.oldId));
      expect(oldIds.has("src/a.ts")).toBe(true);
      expect(oldIds.has("src/a")).toBe(true);
      const fileAlias = aliases.find((a) => a.oldId === "src/a.ts")!;
      expect(fileAlias.newId).toBe("src/renamed.ts");
      expect(fileAlias.reason).toBe("rename");

      const diff = diffSnapshots(db, {
        fromSnapshotId: first.snapshotId,
        toSnapshotId: second.snapshotId,
      });
      expect(diff.summary.removedNodes).toBe(0);
      expect(diff.summary.addedNodes).toBe(0);
      expect(diff.summary.renamedNodes).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
  });

  it("classifies cross-directory renames as 'move'", async () => {
    await commitFile(repo.dir, "src/a.ts", "export const A = 1;\n", "init");
    const first = await runGraphIndex({ rootDir: repo.dir, ref: "main" });
    await renameFile(repo.dir, "src/a.ts", "lib/a.ts", "move a to lib");
    const second = await runGraphIndex({ rootDir: repo.dir, ref: "head" });

    const db = openDatabase(repo.dbPath);
    try {
      const aliases = db.listAliases(second.snapshotId);
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases.every((a) => a.reason === "move")).toBe(true);
    } finally {
      db.close();
    }

    expect(second.aliases).toBeGreaterThan(0);
    expect(first.aliases).toBe(0);
  });

  it("stamps commit_hash from HEAD when not provided", async () => {
    await commitFile(repo.dir, "src/a.ts", "export const A = 1;\n", "init");
    const result = await runGraphIndex({ rootDir: repo.dir, ref: "main" });

    const db = openDatabase(repo.dbPath);
    try {
      const snap = db.getSnapshot(result.snapshotId);
      expect(snap?.commitHash).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      db.close();
    }
  });

  it("emits no aliases when detectRenames=false", async () => {
    await commitFile(repo.dir, "src/a.ts", "export const A = 1;\n", "init");
    await runGraphIndex({ rootDir: repo.dir, ref: "main" });
    await renameFile(repo.dir, "src/a.ts", "src/renamed.ts", "rename");
    const second = await runGraphIndex({
      rootDir: repo.dir,
      ref: "head",
      detectRenames: false,
    });
    expect(second.aliases).toBe(0);
  });
});
