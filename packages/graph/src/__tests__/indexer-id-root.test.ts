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
    // Default db lands at the git toplevel, not the indexed subdir (C-22).
    const db = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
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

    // Both runs default to the same git-toplevel db (C-22): the full-repo run
    // and the subdir run share one snapshot store.
    const db = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
    try {
      const idsRoot = new Set(
        db
          .listNodes(fromRoot.snapshotId)
          .filter((n) => n.kind === "file")
          .map((n) => n.id),
      );
      const idsPkg = new Set(
        db
          .listNodes(fromPkg.snapshotId)
          .filter((n) => n.kind === "file")
          .map((n) => n.id),
      );
      // The subset-indexed run must agree with the full-repo run on every id
      // it captures — that's the property the rest of the system relies on.
      expect(idsPkg.size).toBeGreaterThan(0);
      for (const id of idsPkg) expect(idsRoot.has(id)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("uses git toplevel even when GIT_DIR is inherited (pre-commit hook env)", async () => {
    // Git sets GIT_DIR (and GIT_INDEX_FILE) for hook subprocesses. When those
    // leak into our `git rev-parse --show-toplevel` call, git returns the cwd
    // instead of the real toplevel — so id-root falls back to the scan root
    // and snapshots produced by the hook lose the packages/ prefix vs
    // snapshots produced outside the hook. Verify the indexer strips those
    // vars internally so behavior is identical with or without them set.
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["config", "user.email", "t@e.test"]);
    git(scratch, ["config", "user.name", "t"]);
    git(scratch, ["config", "commit.gpgsign", "false"]);
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");
    const gitDir = path.join(scratch, ".git");

    const prevGitDir = process.env.GIT_DIR;
    const prevGitIndex = process.env.GIT_INDEX_FILE;
    const prevGitWork = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = gitDir;
    process.env.GIT_INDEX_FILE = path.join(gitDir, "index");
    try {
      const result = await runGraphIndex({
        rootDir: path.join(scratch, "pkg-a"),
        ref: "hook-env",
        computeChurn: false,
        detectRenames: false,
      });
      // Default db lands at the git toplevel, not the indexed subdir (C-22).
      const db = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
      try {
        const fileIds = db
          .listNodes(result.snapshotId)
          .filter((n) => n.kind === "file")
          .map((n) => n.id);
        // Repo-rooted id, not scan-rooted — proves env-var stripping worked.
        expect(fileIds).toContain("pkg-a/src/a.ts");
        expect(fileIds).not.toContain("src/a.ts");
      } finally {
        db.close();
      }
    } finally {
      restoreEnv("GIT_DIR", prevGitDir);
      restoreEnv("GIT_INDEX_FILE", prevGitIndex);
      restoreEnv("GIT_WORK_TREE", prevGitWork);
    }
  });
  it("walks every entry in rootDirs and produces a single unified snapshot", async () => {
    // git toplevel = scratch. Two sibling subtrees the caller wants in one
    // snapshot: pkg-a/src/ and tests/integration/.
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");
    await writeFile(
      scratch,
      "tests/integration/sample.test.ts",
      "import { a } from '../../pkg-a/src/a.js';\nexport const used = a;\n",
    );
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["add", "."]);
    git(scratch, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);

    const result = await runGraphIndex({
      rootDirs: [
        path.join(scratch, "pkg-a"),
        path.join(scratch, "tests"),
      ],
      ref: "test",
      computeChurn: false,
      detectRenames: false,
    });
    // Default db lands at the git toplevel, not the first indexed subdir (C-22).
    const db = openDatabase(path.join(scratch, ".codewatch", "graph.db"));
    try {
      const fileIds = db
        .listNodes(result.snapshotId)
        .filter((n) => n.kind === "file")
        .map((n) => n.id)
        .sort();
      // Both subtrees indexed; ids rooted at git toplevel so the importer
      // in tests/ resolves into pkg-a/.
      expect(fileIds).toContain("pkg-a/src/a.ts");
      expect(fileIds).toContain("tests/integration/sample.test.ts");
    } finally {
      db.close();
    }
  });

  it("dedupes a file that appears under two overlapping rootDirs", async () => {
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["add", "."]);
    git(scratch, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);

    const result = await runGraphIndex({
      rootDirs: [
        path.join(scratch, "pkg-a"),
        path.join(scratch, "pkg-a/src"),
      ],
      ref: "test",
      computeChurn: false,
      detectRenames: false,
    });
    expect(result.files).toBe(1);
  });

  it("defaults the db to the git toplevel, not the indexed subdir (C-22)", async () => {
    // Regression: `graph index <subdir>` without --db used to derive the db
    // path from the indexed subdir, silently writing to
    // <subdir>/.codewatch/graph.db instead of the canonical toplevel db — the
    // footgun that kept resurrecting a second stray db.
    git(scratch, ["init", "-q", "-b", "main"]);
    git(scratch, ["config", "user.email", "t@e.test"]);
    git(scratch, ["config", "user.name", "t"]);
    git(scratch, ["config", "commit.gpgsign", "false"]);
    await writeFile(scratch, "pkg-a/src/a.ts", "export const a = 1;\n");

    await runGraphIndex({
      rootDir: path.join(scratch, "pkg-a"),
      ref: "test",
      computeChurn: false,
      detectRenames: false,
    });

    expect(await exists(path.join(scratch, ".codewatch", "graph.db"))).toBe(true);
    expect(
      await exists(path.join(scratch, "pkg-a", ".codewatch", "graph.db")),
    ).toBe(false);
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
