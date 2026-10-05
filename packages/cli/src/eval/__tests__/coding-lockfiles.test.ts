import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emptyFunnel, mineCandidates, resolveMiningOptions } from "../coding-candidates.js";
import { lockfilesAt } from "../coding-git.js";

/**
 * Fixture history: the parent has only pnpm-lock.yaml; the fix commit edits a
 * source file and its test and also adds package-lock.json. The gate must see
 * the parent's lockfiles, not the fix commit's.
 */

let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();
}

function commit(message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

let parent: string;
let fix: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "codewatch-lockfiles-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "dev"]);
  git(["config", "commit.gpgsign", "false"]);
  parent = commit("feat: initial", {
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/value.ts": "export function value() {\n  return 1;\n}\n",
    "test/value.test.ts": 'import { value } from "../src/value";\nvalue();\n',
  });
  fix = commit("fix: value returns two", {
    "package-lock.json": "{}\n",
    "src/value.ts": "export function value() {\n  return 2;\n}\n",
    "test/value.test.ts": 'import { value } from "../src/value";\nexpect(value()).toBe(2);\n',
  });
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("lockfilesAt", () => {
  it("reads each commit's own tree", () => {
    expect(lockfilesAt(repo, parent)).toEqual(["pnpm-lock.yaml"]);
    expect(lockfilesAt(repo, fix).sort()).toEqual(["package-lock.json", "pnpm-lock.yaml"]);
  });
});

describe("mined candidate lockfiles", () => {
  it("records the parent commit's lockfiles, not the fix commit's", () => {
    const candidates = mineCandidates(repo, resolveMiningOptions({}), emptyFunnel());

    expect(candidates.map((c) => c.commit.sha)).toEqual([fix]);
    expect(candidates[0]!.lockfiles).toEqual(["pnpm-lock.yaml"]);
  });
});
