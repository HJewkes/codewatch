import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckDiagnostic, RunnerResult } from "@titan-design/style-checker";
import { runAuditCommand } from "../commands/audit.js";
import type { PythonRunner } from "../commands/audit-runners.js";
import { buildScoreTable, percentileRanks } from "../commands/audit-score.js";

const TANGLED_SRC = `def tangled(items, flag, limit):
    total = 0
    for item in items:
        if item > 0 and flag or limit:
            for k in range(item):
                if k % 2 == 0:
                    total += k
                elif k > limit:
                    total -= k
        else:
            total -= 1
        while total > limit:
            total -= 1
    return total
`;

const PLAIN_SRC = `from pkg.tangled import tangled


def simple(items):
    return tangled(items, True, 3)
`;

const RECORDED_RUFF: CheckDiagnostic = {
  file: "pkg/tangled.py",
  line: 4,
  endLine: 4,
  column: 9,
  severity: "warn",
  message: "Boolean positional value in function call",
  category: "ruff",
  rule: "FBT003",
  fixable: false,
};

function recordingRunner(diagnostics: CheckDiagnostic[]): PythonRunner & { calls: Array<{ files: string[]; cwd: string }> } {
  const calls: Array<{ files: string[]; cwd: string }> = [];
  const runner = (files: string[], options: { cwd: string }): Promise<RunnerResult> => {
    calls.push({ files, cwd: options.cwd });
    return Promise.resolve({ diagnostics, exitCode: 1, failures: [], skippedRules: [] });
  };
  return Object.assign(runner, { calls });
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "c103-audit-"));
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg", "__init__.py"), "");
  writeFileSync(join(dir, "pkg", "tangled.py"), TANGLED_SRC);
  writeFileSync(join(dir, "pkg", "plain.py"), PLAIN_SRC);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("codewatch audit", () => {
  it("reports the one function over the cognitive threshold as a code-graph finding with its span", async () => {
    const result = await runAuditCommand({ path: dir, noRuff: true });

    const graphFindings = result.findings.filter((f) => f.tool === "code-graph");
    expect(graphFindings).toHaveLength(1);
    expect(graphFindings[0]).toMatchObject({
      path: "pkg/tangled.py",
      lineStart: 1,
      lineEnd: 14,
      symbol: "tangled",
      signal: "symbol-cognitive",
      tool: "code-graph",
    });
    const written = readFileSync(join(dir, ".codewatch", "audit", "findings.jsonl"), "utf8").trim().split("\n");
    expect(written.map((line) => JSON.parse(line))).toEqual(result.findings);
  });

  it("merges a ruff diagnostic as a ruff finding whose signal is the ruff code", async () => {
    const runner = recordingRunner([RECORDED_RUFF]);

    const result = await runAuditCommand({ path: dir, runners: { ruff: runner } });

    const ruffFinding = result.findings.find((f) => f.tool === "ruff");
    expect(ruffFinding).toMatchObject({ path: "pkg/tangled.py", lineStart: 4, signal: "FBT003", severity: "warning" });
    expect(runner.calls[0]!.files.sort()).toEqual(["pkg/__init__.py", "pkg/plain.py", "pkg/tangled.py"]);
    const tangled = result.scores.symbols.find((s) => s.symbol === "tangled");
    expect(tangled?.findings).toEqual({ "symbol-cognitive": 1, FBT003: 1 });
  });

  it("--no-ruff never invokes the ruff runner", async () => {
    const runner = recordingRunner([RECORDED_RUFF]);

    const result = await runAuditCommand({ path: dir, noRuff: true, runners: { ruff: runner } });

    expect(runner.calls).toHaveLength(0);
    expect(result.findings.some((f) => f.tool === "ruff")).toBe(false);
    expect(result.warnings).toContain("ruff skipped (--no-ruff)");
  });
});

describe("audit score percentiles", () => {
  it("places each value by the share of other values it exceeds, sharing a percentile on ties", () => {
    expect(percentileRanks([30, 10, 50, 20, 40])).toEqual([50, 0, 100, 25, 75]);
    expect(percentileRanks([5, 5, 10])).toEqual([0, 0, 100]);
    expect(percentileRanks([7])).toEqual([0]);
  });

  it("ranks the largest, most complex file first and averages its two percentiles", () => {
    const files = [
      { path: "small.py", loc: 10, cognitiveMax: 1 },
      { path: "big-simple.py", loc: 900, cognitiveMax: 2 },
      { path: "big-tangled.py", loc: 1000, cognitiveMax: 40 },
    ];

    const table = buildScoreTable(files, [], []);

    expect(table.files.map((f) => [f.path, f.rank])).toEqual([
      ["big-tangled.py", 100],
      ["big-simple.py", 50],
      ["small.py", 0],
    ]);
  });
});
