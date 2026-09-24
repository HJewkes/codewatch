import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "@titan-design/code-graph";
import type { RunnerResult } from "@titan-design/style-checker";
import type { SymbolSpan } from "../commands/audit-score.js";
import { runAuditCommand } from "../commands/audit.js";
import { PYTHON_TOOLS, type PythonRunners } from "../commands/audit-runners.js";
import { buildBundles, flaggedLines, type TriageBundle } from "../commands/triage-bundle.js";
import { ELISION } from "../commands/triage-excerpt.js";
import { planTriage } from "../commands/triage-plan.js";
import type { SelectedFile } from "../commands/triage-select.js";
import type { BundleSource } from "../commands/triage-source.js";

const PATH = "src/a.py";

function codeLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `    value_${i + 1} = compute(${i + 1})`);
}

function span(symbol: string, lineStart: number, lineEnd: number): SymbolSpan {
  return { path: PATH, symbol, lineStart, lineEnd };
}

function fakeSource(lineCount: number, spans: SymbolSpan[]): BundleSource {
  const text = codeLines(lineCount);
  return { lines: (p) => (p === PATH ? text : undefined), symbols: () => spans, caller: () => undefined };
}

function lineFinding(signal: string, line: number): Finding {
  return { id: `${signal}:${line}`, path: PATH, lineStart: line, lineEnd: line, signal, severity: "warning", tool: "t" };
}

function symbolFinding(signal: string, s: SymbolSpan): Finding {
  const base = { id: `${signal}:${s.symbol}`, path: PATH, symbol: s.symbol, signal, severity: "warning" as const };
  return { ...base, lineStart: s.lineStart, lineEnd: s.lineEnd, tool: "code-graph" };
}

const file = (findings: Finding[]): SelectedFile => ({ path: PATH, rank: 90, findings });

const shownLines = (bundle: TriageBundle, p = PATH): number[] => [...(bundle.shown.get(p) ?? [])].sort((a, b) => a - b);

function expectEveryFlaggedLineShown(bundles: readonly TriageBundle[]): void {
  for (const bundle of bundles) {
    const shown = new Set(shownLines(bundle));
    for (const { finding } of bundle.questions) {
      for (const line of flaggedLines(finding)) expect(shown.has(line), `${finding.id} line ${line}`).toBe(true);
    }
  }
}

describe("buildBundles with a fixed source", () => {
  it("shows the innermost symbol holding a line finding, with numbered lines", () => {
    const source = fakeSource(40, [span("Outer", 1, 30), span("Outer.inner", 10, 15)]);

    const { bundles } = buildBundles([file([lineFinding("ERA001", 12)])], source);

    expect(bundles).toHaveLength(1);
    expect(shownLines(bundles[0]!)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(bundles[0]!.excerpt).toContain("12|     value_12 = compute(12)");
  });

  it("splits by symbol over the cap and keeps every flagged line shown", () => {
    const spans = [span("first", 1, 150), span("second", 151, 300), span("third", 301, 400)];
    const findings = [...spans.map((s) => symbolFinding("symbol-cognitive", s)), lineFinding("ERA001", 200)];

    const { bundles } = buildBundles([file(findings)], fakeSource(400, spans), 1500);

    expect(bundles.map((b) => b.id)).toEqual([`${PATH}:part1`, `${PATH}:part2`, `${PATH}:part3`]);
    expect(bundles.every((b) => b.tokens <= 1500)).toBe(true);
    expect(bundles.flatMap((b) => b.questions)).toHaveLength(4);
    expectEveryFlaggedLineShown(bundles);
  });

  it("shows only flagged lines with context when one symbol is over the cap", () => {
    const whole = span("huge", 1, 400);
    const findings = [symbolFinding("symbol-cognitive", whole), lineFinding("ERA001", 200)];

    const { bundles } = buildBundles([file(findings)], fakeSource(400, [whole]), 500);

    const shown = shownLines(bundles[0]!);
    expect(shown).toContain(180);
    expect(shown).toContain(220);
    expect(shown).not.toContain(100);
    expect(bundles[0]!.excerpt).toContain(ELISION);
    expectEveryFlaggedLineShown(bundles);
  });

  it("gives questions over the same excerpt the same hash and over another excerpt a different one", () => {
    const spans = [span("one", 1, 10), span("two", 11, 20)];
    const findings = [lineFinding("ERA001", 3), lineFinding("SIM105", 4), lineFinding("ERA001", 15)];

    const [bundle] = buildBundles([file(findings)], fakeSource(20, spans)).bundles;

    const hashes = bundle!.questions.map((q) => q.excerptHash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it("skips a file the source cannot pin to the snapshot", () => {
    const missing: SelectedFile = { path: "src/other.py", rank: 90, findings: [] };

    const result = buildBundles([missing], fakeSource(10, []));

    expect(result).toEqual({ bundles: [], skippedFiles: ["src/other.py"] });
  });
});

const CORE_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const EMPTY: RunnerResult = { diagnostics: [], exitCode: 0, failures: [], skippedRules: [] };
const SILENT_RUNNERS: PythonRunners = Object.fromEntries(PYTHON_TOOLS.map((tool) => [tool, () => Promise.resolve(EMPTY)]));

describe("planTriage over a real audit", () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-bundle-"));
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("adds the one caller's excerpt to a single-caller-helper question", () => {
    const plan = planTriage({ path: dir, minRank: 0, includeTests: false });

    const bundle = plan.bundles.find((b) => b.path === "pkg/core.py")!;
    expect(bundle.questions.map((q) => q.finding.signal)).toEqual(["symbol-single-caller-helper"]);
    expect(shownLines(bundle, "pkg/core.py")).toEqual([1, 2, 3, 6, 7, 8]);
  });

  it("skips a file edited after the audit", () => {
    writeFileSync(join(dir, "pkg", "core.py"), `${CORE_SRC}\n# edited\n`);

    const plan = planTriage({ path: dir, minRank: 0, includeTests: false });

    expect(plan.skippedFiles).toEqual(["pkg/core.py"]);
    expect(plan.warnings.join("\n")).toContain("pkg/core.py changed since the audit's snapshot");
  });
});
