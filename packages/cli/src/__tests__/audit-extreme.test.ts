import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DELETION_CANDIDATE_SIGNAL,
  PSEUDO_TESTED_SIGNAL,
  type ExtremeMutationOptions,
  type ExtremeMutationResult,
  type Finding,
} from "@titan-design/code-graph";
import { runAuditCommand } from "../commands/audit.js";
import { buildScoreTable } from "../commands/audit-score.js";

const PSEUDO_TESTED: Finding = {
  id: "code-graph:pseudo-tested:src/add.ts#add",
  path: "src/add.ts",
  lineStart: 1,
  lineEnd: 3,
  symbol: "add",
  signal: PSEUDO_TESTED_SIGNAL,
  severity: "warning",
  tool: "code-graph",
  evidence: "covered at abc1234; body made to return at once; built; 1 tests in . ran, none failed",
};

const CANDIDATE: Finding = {
  id: "code-graph:test-deletion-candidate:src/add.test.ts::logs a sum",
  path: "src/add.test.ts",
  symbol: "logs a sum",
  signal: DELETION_CANDIDATE_SIGNAL,
  severity: "warning",
  tool: "code-graph",
  evidence: "passed at abc1234; failed under none of 1 body-delete mutants it reaches (add); advisory only, never deleted",
};

const RESULT: ExtremeMutationResult = {
  findings: [PSEUDO_TESTED, CANDIDATE],
  summary: {
    head: "abc1234",
    targets: 1,
    survived: 1,
    caught: 0,
    caughtError: 0,
    excluded: 0,
    unverified: 0,
    truncated: 0,
    skipped: {
      uncovered: 0,
      unchanged: 0,
      "expression-body": 0,
      constructor: 0,
      generator: 0,
      "overload-or-abstract": 0,
      "find-not-unique": 0,
      "find-over-cap": 0,
      capped: 0,
    },
    deletionCandidates: 1,
    builds: 2,
    wallMs: 5,
  },
  report: {
    head: "abc1234",
    suites: { ".": ["src/add.test.ts"] },
    baseline: [{ test: "logs a sum", file: "src/add.test.ts", status: "passed" }],
    runs: [],
    unrun: [],
    wallMs: 5,
    builds: 2,
  },
};

function recordingExtreme(): ((o: ExtremeMutationOptions) => Promise<ExtremeMutationResult>) & { calls: ExtremeMutationOptions[] } {
  const calls: ExtremeMutationOptions[] = [];
  const run = (o: ExtremeMutationOptions): Promise<ExtremeMutationResult> => {
    calls.push(o);
    return Promise.resolve(RESULT);
  };
  return Object.assign(run, { calls });
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

let scratch: string;
let repo: string;
let coverage: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "c263-extreme-"));
  repo = join(scratch, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "add.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  writeFileSync(join(repo, "src", "add.ts"), "export function add(a: number, b: number): number {\n  return b + a;\n}\n");
  coverage = join(scratch, "coverage-final.json");
  writeFileSync(coverage, JSON.stringify({ [join(repo, "src", "add.ts")]: { fnMap: {}, f: {} } }));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("codewatch audit --extreme-coverage", () => {
  it("writes the extreme-mutation findings to findings.jsonl and the summary to extreme.json", async () => {
    const extremeMutation = recordingExtreme();
    const out = join(scratch, "out");

    const result = await runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, changedFrom: "HEAD", extremeCoverage: coverage, extremeMutation, out });

    const written = readFileSync(join(out, "findings.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Finding);
    expect(written).toContainEqual(PSEUDO_TESTED);
    expect(written).toContainEqual(CANDIDATE);
    const extreme = JSON.parse(readFileSync(join(out, "extreme.json"), "utf8")) as { summary: unknown; report: Record<string, unknown> };
    expect(extreme.summary).toEqual(RESULT.summary);
    expect(extreme.report).not.toHaveProperty("baseline");
    expect(result.extreme).toEqual(RESULT.summary);
    expect(extremeMutation.calls[0]).toMatchObject({ head: "HEAD", changed: new Map([["src/add.ts", [[2, 2]]]]), coverage: { head: "HEAD" } });
  });

  it("refuses to run without --changed-from", async () => {
    const extremeMutation = recordingExtreme();

    const run = runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, extremeCoverage: coverage, extremeMutation, out: join(scratch, "bare") });

    await expect(run).rejects.toThrow("--extreme-coverage needs --changed-from <ref>");
    expect(extremeMutation.calls).toHaveLength(0);
  });

  it("writes no extreme.json without --extreme-coverage", async () => {
    const out = join(scratch, "plain");

    await runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, changedFrom: "HEAD", out });

    expect(readdirSync(out)).not.toContain("extreme.json");
  });

  it("counts neither extreme-mutation signal in the score table", () => {
    const files = [{ path: "src/add.ts", loc: 3, cognitiveMax: 0 }];
    const symbols = [{ path: "src/add.ts", symbol: "add", lineStart: 1, lineEnd: 3, cognitive: 0, cyclomatic: 1 }];

    const table = buildScoreTable(files, symbols, [PSEUDO_TESTED, { ...CANDIDATE, path: "src/add.ts" }]);

    expect(table.files[0]!.total).toBe(0);
    expect(table.symbols[0]!.total).toBe(0);
  });
});

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("extreme-mutation call sites", () => {
  it("leaves runExtremeMutation to audit.ts alone, so no other CLI path turns its findings into work", () => {
    const callers = sourceFiles(SRC).filter((file) => /\brunExtremeMutation\b/.test(readFileSync(file, "utf8")));

    expect(callers.map((file) => relative(SRC, file))).toEqual(["commands/audit.ts"]);
  });
});
