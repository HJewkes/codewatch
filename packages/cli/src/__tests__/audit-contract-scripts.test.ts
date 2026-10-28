import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Finding } from "@titan-design/code-graph";
import { runAuditCommand } from "../commands/audit.js";

const GEN_BASE = `import { fileURLToPath } from "node:url";
function stale() { return []; }
function main() {
  if (process.argv.includes("--check")) process.exit(stale().length > 0 ? 1 : 0);
  if (process.argv.includes("--verbose")) console.log("verbose");
  if (process.argv.includes("--debug")) console.log("debug");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
`;

/** run() gains exit code 2 for a missing dist and drops --verbose and --debug. */
const GEN_HEAD = `import { fileURLToPath } from "node:url";
function stale() { return []; }
function hasDist() { return false; }
export function run(argv) {
  if (!hasDist()) return 2;
  if (argv.includes("--check")) return stale().length > 0 ? 1 : 0;
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
`;

const packageJson = (release: string): string => `{
  "scripts": {
    "gen": "node scripts/gen.mjs",
    "gen:check": "node scripts/gen.mjs --check --verbose",
    "release": "${release}"
  }
}
`;

const SYNC_BASE = `import sys


def main():
    return 0 if sys.argv[1:] else 1


if __name__ == "__main__":
    sys.exit(main())
`;

const BASE_FILES: Readonly<Record<string, string>> = {
  "scripts/gen.mjs": GEN_BASE,
  "package.json": packageJson("changeset version && node scripts/gen.mjs"),
  "scripts/new-thing.mjs": `import { execFileSync } from "node:child_process";
import { join } from "node:path";
execFileSync(process.execPath, [join("scripts", "gen.mjs")]);
`,
  ".github/workflows/ci.yml": `jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm gen:check
`,
  "tools/sync.py": SYNC_BASE,
  Makefile: "sync:\n\tpython tools/sync.py\n",
  "README.md": "Run scripts/gen.mjs to regenerate.\n",
};

const HEAD_FILES: Readonly<Record<string, string>> = {
  "scripts/gen.mjs": GEN_HEAD,
  "package.json": packageJson("changeset version && node scripts/gen.mjs --catalog-only"),
  "tools/sync.py": SYNC_BASE.replace("def main():\n", "def main():\n    if not sys.stdin.isatty():\n        return 3\n"),
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** BASE committed, HEAD left in the working tree, so `--changed-from HEAD` is the change. */
function commitBaseThenEdit(repo: string): void {
  writeFiles(repo, BASE_FILES);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  writeFiles(repo, HEAD_FILES);
}

const evidenceOf = (rows: readonly Finding[], idSuffix: string): string => rows.find((f) => f.id.endsWith(idSuffix))?.evidence ?? "";

let scratch: string;
let rows: Finding[];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "c236-scripts-"));
  const repo = join(scratch, "repo");
  mkdirSync(repo);
  commitBaseThenEdit(repo);
  const result = await runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, changedFrom: "HEAD", out: join(scratch, "out") });
  rows = result.findings.filter((f) => f.signal === "contract-change");
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("script contract-change findings against --changed-from", () => {
  it("flags a new exit code whose invokers are outside the diff", () => {
    expect(rows.map((f) => f.id)).toEqual([
      "codewatch:contract-change:scripts/gen.mjs:exit-code-added:2",
      "codewatch:contract-change:scripts/gen.mjs:flag-removed:--verbose",
      "codewatch:contract-change:tools/sync.py:exit-code-added:3",
    ]);
    expect(rows[0]).toMatchObject({ path: "scripts/gen.mjs", lineStart: 9, severity: "warning", tool: "codewatch" });
    expect(rows[0]!.symbol).toBeUndefined();
    expect(rows[0]!.evidence).toBe(
      [
        "change: exit codes {0,1} -> {0,1,2} (added 2)",
        'invokers not in diff: .github/workflows/ci.yml:5 via gen:check, package.json:3 "gen", package.json:4 "gen:check", scripts/new-thing.mjs:3',
        'invokers in diff: package.json:5 "release"',
        "tests not in diff: none",
      ].join("\n"),
    );
  });

  it("names only invokers that pass a removed flag", () => {
    const evidence = evidenceOf(rows, ":flag-removed:--verbose");
    expect(evidence).toContain('invokers not in diff: .github/workflows/ci.yml:5 via gen:check, package.json:4 "gen:check"\n');
    expect(evidence).not.toContain('"gen",');
    expect(evidence).not.toContain("new-thing.mjs");
    expect(rows.filter((f) => f.id.includes("--debug"))).toEqual([]);
  });

  it("ignores documentation", () => {
    expect(rows.filter((f) => f.evidence?.includes("README.md"))).toEqual([]);
  });

  it("reaches a Python script through a Makefile", () => {
    const evidence = evidenceOf(rows, "tools/sync.py:exit-code-added:3");
    expect(evidence).toContain("change: exit codes {0,1} -> {0,1,3} (added 3)");
    expect(evidence).toContain("invokers not in diff: Makefile:2");
  });
});
