import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCommand } from "../commands/audit.js";
import { runTriage, type TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import { planTriage } from "../commands/triage-plan.js";
import type { VerdictRow } from "../commands/triage-prompt.js";
import { SPEC_PATH } from "../commands/triage-spec.js";
import { fakeReader, questionsIn, row, shownText, SILENT_RUNNERS, type AskedQuestion } from "./triage-fake-reader.js";

const CORE_SRC = "def summarise(values):\n    total = sum(values)\n    return round(max(values) / total, 2)\n";
const UTIL_SRC = "def share_of_max(values):\n    total = sum(values)\n    return round(max(values) / total, 2)\n";
const TEST_SRC = "from pkg.core import summarise\n\n\ndef test_summarise():\n    assert summarise([1, 3]) is not None\n";

const SPEC_LINES = ["# Scores, part 2", "", "The summarise command prints the largest value's share of the total.", "Shares are rounded to one decimal place from this part on."];


/** Rows in the findings.jsonl contract the test-shape checks and the clone finder write; the audit writes the test-kind gap itself. */
const PRODUCER_ROWS = [
  { id: "tier-t:tests/test_core.py:4", tool: "tier-t", signal: "symbol_weak_oracle_only", path: "tests/test_core.py", lineStart: 4, lineEnd: 5, symbol: "test_summarise", severity: "warning" },
  { id: "jscpd:pkg/util.py:2", tool: "jscpd", signal: "clone", path: "pkg/util.py", lineStart: 2, lineEnd: 3, severity: "warning", evidence: "duplicates pkg/core.py:2-3" },
];

const specCitation = (prompt: string, line: number): VerdictRow["citations"][number] => ({ path: SPEC_PATH, lineStart: line, lineEnd: line, quote: shownText(prompt, SPEC_PATH, line) });

/** Answers missing-test-kind by citing the spec's rounding line, and copies that line into the rationale. */
function specQuotingReader(prompts: string[]) {
  return fakeReader((q: AskedQuestion, prompt: string) => {
    prompts.push(prompt);
    if (q.path !== "pkg/core.py") return [row(q, prompt, "confirmed")];
    const cited = specCitation(prompt, 4);
    return [{ ...row(q, prompt, "justified"), rationale: `The spec says: ${SPEC_LINES[3]}`, citations: [cited] }];
  });
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((p) => join(dir, p)).filter((p) => statSync(p).isFile());
}

describe("triage questions for missing test kinds, weak oracles and clones", () => {
  let dir: string;
  let specDir: string;
  let specFile: string;
  const base = (): TriageRunOptions => ({ path: dir, specFile, minRank: 101, includeTests: false, model: "sonnet", concurrency: 1, budgetUsd: 5, controlCount: 0, seed: "fixed-seed" });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-spec-ws-"));
    specDir = mkdtempSync(join(tmpdir(), "triage-spec-file-"));
    specFile = join(specDir, "spec.md");
    writeFileSync(specFile, `${SPEC_LINES.join("\n")}\n`);
    for (const sub of ["pkg", "tests"]) mkdirSync(join(dir, sub));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    writeFileSync(join(dir, "pkg", "util.py"), UTIL_SRC);
    writeFileSync(join(dir, "tests", "test_core.py"), TEST_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
    appendFileSync(join(dir, ".codewatch", "audit", "findings.jsonl"), PRODUCER_ROWS.map((r) => `${JSON.stringify(r)}\n`).join(""));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(specDir, { recursive: true, force: true });
  });

  it("asks all three kinds whatever the file's rank or role, with the spec and the reaching tests beside the test-kind gap and the clone's other copy beside the clone", async () => {
    const prompts: string[] = [];

    await runTriage({ ...base(), runner: specQuotingReader(prompts) });

    const byPath = new Map(prompts.map((p) => [questionsIn(p)[0]!.path, p]));
    expect([...byPath.keys()].sort()).toEqual(["pkg/core.py", "pkg/util.py", "tests/test_core.py"]);
    expect(byPath.get("pkg/core.py")).toContain(`=== ${SPEC_PATH}\n`);
    expect(byPath.get("pkg/core.py")).toContain("=== tests/test_core.py\n");
    expect(byPath.get("pkg/util.py")).toContain("=== pkg/core.py\n");
    expect(prompts.filter((p) => p.includes(SPEC_LINES[3]!))).toEqual([byPath.get("pkg/core.py")]);
  });

  it("keeps a spec citation that matches the spec file", async () => {
    const reader = fakeReader((q, prompt) => [q.path === "pkg/core.py" ? { ...row(q, prompt, "justified"), citations: [specCitation(prompt, 3)] } : row(q, prompt, "confirmed")]);

    const { report, verdicts } = await runTriage({ ...base(), runner: reader });

    expect(report.dropped.total).toBe(0);
    expect(verdicts.find((v) => v.signal === "missing-test-kind")?.citations.map((c) => c.path)).toEqual([SPEC_PATH]);
  });

  it("drops a spec citation whose quote is not in the spec file", async () => {
    const drifted = (prompt: string) => ({ ...specCitation(prompt, 4), quote: "Shares are rounded to two decimal places" });
    const reader = fakeReader((q, prompt) => [q.path === "pkg/core.py" ? { ...row(q, prompt, "justified"), citations: [drifted(prompt)] } : row(q, prompt, "confirmed")]);

    const { report, verdicts } = await runTriage({ ...base(), runner: reader });

    expect(report.dropped.byReason).toEqual({ "quote-mismatch": 1 });
    expect(verdicts.map((v) => v.signal)).not.toContain("missing-test-kind");
  });

  it("writes no spec text under the workspace or into graph.db", async () => {
    const { verdicts } = await runTriage({ ...base(), runner: specQuotingReader([]) });

    const gap = verdicts.find((v) => v.signal === "missing-test-kind")!;
    expect(gap.citations).toEqual([{ path: SPEC_PATH, lineStart: 4, lineEnd: 4, quote: "" }]);
    expect(gap.rationale).toBe(`The spec says: ${SPEC_PATH}`);
    const written = filesUnder(dir);
    expect(written).toContain(join(dir, ".codewatch", "graph.db"));
    const distinct = SPEC_LINES.filter((l) => l.length >= 12);
    for (const file of written) {
      const bytes = readFileSync(file, "latin1");
      for (const line of distinct) expect(bytes.includes(line), `${file} holds "${line}"`).toBe(false);
    }
  });

  it("still asks a test-kind gap when no spec is given, and shows no spec", () => {
    const plan = planTriage({ path: dir, minRank: 101, includeTests: false });

    expect(plan.warnings).toEqual([]);
    expect(plan.bundles.flatMap((b) => b.questions.map((q) => q.finding.signal)).sort()).toEqual(["clone", "missing-test-kind", "symbol_weak_oracle_only"]);
    expect(plan.bundles.map((b) => b.excerpt).join("\n")).not.toContain(`=== ${SPEC_PATH}`);
  });

  it("names the symbol, its code kind and the missing test kind in the question", async () => {
    const prompts: string[] = [];

    await runTriage({ ...base(), runner: specQuotingReader(prompts) });

    const asked = prompts.find((p) => questionsIn(p)[0]!.path === "pkg/core.py")!;
    expect(asked).toContain("`summarise` is a `pure logic`. Its tests have no `exact-value test` (evidence: the test assertions attached).");
    expect(asked).toContain("If its output is deliberately unstable, or already pinned by another test, answer justified.");
  });

  it("refuses a spec file inside the workspace", () => {
    const inside = join(dir, "spec.md");
    writeFileSync(inside, "# Scores\n");

    expect(() => planTriage({ path: dir, specFile: inside, minRank: 101, includeTests: false })).toThrow(/inside the workspace/);
  });

  it("shows the test-kind control with its tests and never the run's spec", async () => {
    const control = loadControls().find((c) => c.kind === "missing-test-kind")!;
    const prompts: string[] = [];

    const { report } = await runTriage({ ...base(), controls: [control], controlCount: 1, runner: specQuotingReader(prompts) });

    const shown = prompts.find((p) => questionsIn(p)[0]!.path === control.path)!;
    expect(shown).toContain("=== tests/test_report.py\n");
    expect(shown).not.toContain(`=== ${SPEC_PATH}`);
    expect(shown).not.toContain(SPEC_LINES[3]);
    expect(report.controls.status).toBe("run");
  });
});
