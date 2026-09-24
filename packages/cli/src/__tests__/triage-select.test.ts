import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, NodeRole } from "@titan-design/code-graph";
import type { FileScore, ScoreTable } from "../commands/audit-score.js";
import { readAuditOutputs, selectTriageFiles, type AuditOutputs } from "../commands/triage-select.js";

function finding(path: string, signal: string, line = 10): Finding {
  return { id: `${signal}:${path}:${line}`, path, lineStart: line, signal, severity: "warning", tool: "test" };
}

function score(path: string, rank: number): FileScore {
  return { path, loc: 100, cognitiveMax: 5, rank, findings: {}, total: 0 };
}

const AUDIT: AuditOutputs = {
  findings: [
    finding("src/top.py", "symbol-cognitive"),
    finding("src/top.py", "pydoclint/DOC105"),
    finding("src/edge.py", "ERA001"),
    finding("src/under.py", "ERA001"),
    finding("tests/test_top.py", "symbol-single-caller-helper"),
  ],
  scores: {
    files: [score("src/top.py", 95), score("src/edge.py", 70), score("src/under.py", 69), score("tests/test_top.py", 90)],
    symbols: [],
  },
};

const ROLES = new Map<string, NodeRole>([
  ["src/top.py", "source"],
  ["src/edge.py", "source"],
  ["src/under.py", "source"],
  ["tests/test_top.py", "test"],
]);

const paths = (options: { minRank: number; includeTests: boolean }): string[] =>
  selectTriageFiles(AUDIT, ROLES, options).files.map((f) => f.path);

describe("selectTriageFiles", () => {
  it("keeps a file at exactly the minimum rank and drops one just below it", () => {
    const selection = selectTriageFiles(AUDIT, ROLES, { minRank: 70, includeTests: false });

    expect(selection.files.map((f) => f.path)).toEqual(["src/top.py", "src/edge.py"]);
    expect(selection.excluded.belowRank).toBe(1);
  });

  it("asks no question about a pydoclint finding", () => {
    const selection = selectTriageFiles(AUDIT, ROLES, { minRank: 70, includeTests: false });

    const top = selection.files.find((f) => f.path === "src/top.py")!;
    expect(top.findings.map((f) => f.signal)).toEqual(["symbol-cognitive"]);
    expect(selection.ineligible).toBe(1);
  });

  it("leaves test files out unless tests are included", () => {
    expect(paths({ minRank: 70, includeTests: false })).not.toContain("tests/test_top.py");
    expect(paths({ minRank: 70, includeTests: true })).toEqual(["src/top.py", "tests/test_top.py", "src/edge.py"]);
  });

  it("counts eligible findings in files the score table lacks as unscored", () => {
    const audit = { ...AUDIT, findings: [finding("gone.py", "ERA001")] };

    const selection = selectTriageFiles(audit, ROLES, { minRank: 0, includeTests: true });

    expect(selection.files).toEqual([]);
    expect(selection.excluded.unscored).toBe(1);
  });
});

describe("readAuditOutputs", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads every findings line and the score table", () => {
    dir = mkdtempSync(join(tmpdir(), "triage-select-"));
    const scores: ScoreTable = { files: [score("a.py", 50)], symbols: [] };
    writeFileSync(join(dir, "findings.jsonl"), AUDIT.findings.map((f) => JSON.stringify(f)).join("\n") + "\n");
    writeFileSync(join(dir, "scores.json"), JSON.stringify(scores));

    const outputs = readAuditOutputs(dir);

    expect(outputs.findings).toHaveLength(5);
    expect(outputs.scores.files[0]!.rank).toBe(50);
  });
});
