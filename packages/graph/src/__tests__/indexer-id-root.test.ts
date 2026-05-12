import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), prefix));
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function writeFile(dir: string, rel: string, body: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

describe("runGraphIndex id-root behavior", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await makeTempDir("code-style-id-root-");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("uses rootDir as id-root when the target is not in a git repo", async () => {
    await writeFile(scratch, "src/a.ts", "export const a = 1;\n");
    const result = await runGraphIndex({
      rootDir: scratch,
      ref: "test",
      computeChurn: false,
      detectRenames: false,
    });
    const db = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
    try {
      const fileIds = db
        .listNodes(result.snapshotId)
        .filter((n) => n.kind === "file")
        .map((n) => n.id);
      // Non-git → relative to scan root (no enclosing toplevel exists).
      expect(fileIds).toContain("src/a.ts");
    } finally {
      db.close();
    }
  });

  it("uses git toplevel as id-root regardless of where indexing was started", async () => {
    // Set up a git repo with two packages; index just one of them and verify
    // ids include the package prefix (i.e., are rooted at the repo, not the
    // package).
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["config", "user.email", "t@e.test"]);
    git(scratch, ["config", "user.name", "t"]);
    git(scratch, ["config", "commit.gpgsign", "false"]);
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");
    await writeFile(scratch, "pkg-b/src/b.ts", "export const b = 2;\n");

    const result = await runGraphIndex({
      rootDir: path.join(scratch, "pkg-a"),
      ref: "test",
      computeChurn: false,
      detectRenames: false,
    });
    const db = openDatabase(path.join(scratch, "pkg-a", ".codewatch", "graph.db"));
    try {
      const fileIds = db
        .listNodes(result.snapshotId)
        .filter((n) => n.kind === "file")
        .map((n) => n.id);
      // Id is repo-rooted: pkg-a/src/a.ts, not src/a.ts.
      expect(fileIds).toContain("pkg-a/src/a.ts");
      expect(fileIds).not.toContain("src/a.ts");
      // pkg-b/src/b.ts is outside the scan range and must not appear.
      expect(fileIds).not.toContain("pkg-b/src/b.ts");
    } finally {
      db.close();
    }
  });

  it("produces matching ids whether indexing the full repo or a single package", async () => {
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["config", "user.email", "t@e.test"]);
    git(scratch, ["config", "user.name", "t"]);
    git(scratch, ["config", "commit.gpgsign", "false"]);
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");
    await writeFile(scratch, "pkg-b/src/b.ts", "export const b = 2;\n");

    const fromRoot = await runGraphIndex({
      rootDir: scratch,
      ref: "from-root",
      computeChurn: false,
      detectRenames: false,
    });
    const fromPkg = await runGraphIndex({
      rootDir: path.join(scratch, "pkg-a"),
      ref: "from-pkg",
      computeChurn: false,
      detectRenames: false,
    });

    const dbRoot = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
    const dbPkg = openDatabase(path.join(scratch, "pkg-a", ".codewatch", "graph.db"));
    try {
      const idsRoot = new Set(
        dbRoot
          .listNodes(fromRoot.snapshotId)
          .filter((n) => n.kind === "file")
          .map((n) => n.id),
      );
      const idsPkg = new Set(
        dbPkg
          .listNodes(fromPkg.snapshotId)
          .filter((n) => n.kind === "file")
          .map((n) => n.id),
      );
      // The subset-indexed run must agree with the full-repo run on every id
      // it captures — that's the property the rest of the system relies on.
      for (const id of idsPkg) expect(idsRoot.has(id)).toBe(true);
    } finally {
      dbRoot.close();
      dbPkg.close();
    }
  });
});
