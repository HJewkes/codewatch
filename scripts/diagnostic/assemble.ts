/**
 * Diagnostic Results Assembler
 *
 * Reads structured JSON from test bench agents, check results, and judge
 * evaluations, then computes aggregates and writes a markdown scorecard.
 *
 * Usage: npx tsx scripts/diagnostic/assemble.ts v1
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface SelfAssessment {
  naming: number;
  structure: number;
  documentation: number;
  error_handling: number;
  overall: number;
}

interface TestResult {
  id: string;
  version: string;
  files_written: string[];
  tool_calls: number;
  skill_referenced: boolean;
  self_assessment: SelfAssessment;
}

interface JudgeScores {
  naming: number;
  structure: number;
  documentation: number;
  error_handling: number;
  overall: number;
}

interface JudgeViolation {
  line: number;
  category: string;
  description: string;
}

interface JudgeResult {
  scores: JudgeScores;
  violations: JudgeViolation[];
  strengths: string[];
  summary: string;
}

interface CheckSummary {
  errors: number;
  warnings: number;
  info: number;
  total: number;
}

interface CheckResult {
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    category: string;
    rule: string;
  }>;
  summary: CheckSummary;
}

interface PromptRecord {
  id: string;
  test: TestResult | null;
  check: CheckResult | null;
  judge: JudgeResult | null;
}

const DIMENSIONS = ["naming", "structure", "documentation", "error_handling", "overall"] as const;
type Dimension = (typeof DIMENSIONS)[number];

function extractJson(raw: string): string | null {
  let text = raw;

  // Handle claude -p --output-format json wrapping
  try {
    const outer = JSON.parse(text);
    if (outer.result) {
      text = outer.result;
    }
  } catch {
    // Not wrapped, use raw text
  }

  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  // Find JSON object boundaries
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;

  return text.slice(jsonStart, jsonEnd + 1);
}

function loadTestResult(path: string): TestResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const jsonStr = extractJson(raw);
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`  WARN: Failed to parse ${path}: ${(e as Error).message}`);
    return null;
  }
}

function loadCheckResult(path: string): CheckResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadJudgeResult(path: string): JudgeResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const jsonStr = extractJson(raw);
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function loadAllResults(benchDir: string): PromptRecord[] {
  const records: PromptRecord[] = [];

  for (let i = 1; i <= 15; i++) {
    const num = String(i).padStart(2, "0");
    const id = `D-${num}`;

    records.push({
      id,
      test: loadTestResult(join(benchDir, `${id}.json`)),
      check: loadCheckResult(join(benchDir, `${id}-check.json`)),
      judge: loadJudgeResult(join(benchDir, `${id}-judge.json`)),
    });
  }

  return records;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildHeadlineTable(records: PromptRecord[], prevRecords: PromptRecord[] | null): string {
  const tests = records.filter((r) => r.test).map((r) => r.test!);
  const judges = records.filter((r) => r.judge).map((r) => r.judge!);
  const checks = records.filter((r) => r.check).map((r) => r.check!);

  const prevTests = prevRecords?.filter((r) => r.test).map((r) => r.test!) ?? [];
  const prevJudges = prevRecords?.filter((r) => r.judge).map((r) => r.judge!) ?? [];
  const prevChecks = prevRecords?.filter((r) => r.check).map((r) => r.check!) ?? [];

  const skillRefRate = tests.length > 0
    ? (tests.filter((t) => t.skill_referenced).length / tests.length) * 100
    : 0;
  const prevSkillRefRate = prevTests.length > 0
    ? (prevTests.filter((t) => t.skill_referenced).length / prevTests.length) * 100
    : 0;

  const avgToolCalls = avg(tests.map((t) => t.tool_calls));
  const prevAvgToolCalls = avg(prevTests.map((t) => t.tool_calls));

  const avgSelfOverall = avg(tests.map((t) => t.self_assessment.overall));
  const prevAvgSelfOverall = avg(prevTests.map((t) => t.self_assessment.overall));

  const avgCheckViolations = checks.length > 0
    ? avg(checks.map((c) => c.summary.total))
    : 0;
  const prevAvgCheckViolations = prevChecks.length > 0
    ? avg(prevChecks.map((c) => c.summary.total))
    : 0;

  const avgJudgeOverall = avg(judges.map((j) => j.scores.overall));
  const prevAvgJudgeOverall = avg(prevJudges.map((j) => j.scores.overall));

  const zeroViolations = checks.filter((c) => c.summary.total === 0).length;
  const prevZeroViolations = prevChecks.filter((c) => c.summary.total === 0).length;

  const delta = (cur: number, prev: number, decimals = 1): string => {
    if (prev === 0 && cur === 0) return "—";
    if (prev === 0) return "—";
    const diff = cur - prev;
    if (Math.abs(diff) < 0.05) return "flat";
    const sign = diff > 0 ? "+" : "";
    return `**${sign}${diff.toFixed(decimals)}**`;
  };

  const hasPrev = prevRecords !== null && prevTests.length > 0;

  const lines = [
    "| Metric | Current | Previous | Delta |",
    "|--------|---------|----------|-------|",
    `| Prompts completed | ${tests.length}/15 | ${hasPrev ? prevTests.length + "/15" : "—"} | ${hasPrev ? delta(tests.length, prevTests.length, 0) : "—"} |`,
    `| Skill reference rate | ${skillRefRate.toFixed(0)}% | ${hasPrev ? prevSkillRefRate.toFixed(0) + "%" : "—"} | ${hasPrev ? delta(skillRefRate, prevSkillRefRate, 0) + "pp" : "—"} |`,
    `| Avg tool calls | ${avgToolCalls.toFixed(1)} | ${hasPrev ? prevAvgToolCalls.toFixed(1) : "—"} | ${hasPrev ? delta(avgToolCalls, prevAvgToolCalls) : "—"} |`,
    `| Avg self-assessment (overall) | ${avgSelfOverall.toFixed(1)}/5 | ${hasPrev ? prevAvgSelfOverall.toFixed(1) + "/5" : "—"} | ${hasPrev ? delta(avgSelfOverall, prevAvgSelfOverall) : "—"} |`,
    `| Avg check violations | ${avgCheckViolations.toFixed(1)} | ${hasPrev ? prevAvgCheckViolations.toFixed(1) : "—"} | ${hasPrev ? delta(avgCheckViolations, prevAvgCheckViolations) : "—"} |`,
    `| Prompts at 0 violations | ${zeroViolations}/${checks.length} | ${hasPrev ? prevZeroViolations + "/" + prevChecks.length : "—"} | ${hasPrev ? delta(zeroViolations, prevZeroViolations, 0) : "—"} |`,
    `| Avg judge score (overall) | ${avgJudgeOverall.toFixed(1)}/5 | ${hasPrev ? prevAvgJudgeOverall.toFixed(1) + "/5" : "—"} | ${hasPrev ? delta(avgJudgeOverall, prevAvgJudgeOverall) : "—"} |`,
  ];

  return lines.join("\n");
}

function buildJudgeDimensionTable(records: PromptRecord[], prevRecords: PromptRecord[] | null): string {
  const judges = records.filter((r) => r.judge).map((r) => r.judge!);
  const prevJudges = prevRecords?.filter((r) => r.judge).map((r) => r.judge!) ?? [];

  if (judges.length === 0) return "*No judge results available.*";

  const lines = [
    "| Dimension | Current Avg | Previous Avg | Delta |",
    "|-----------|-------------|--------------|-------|",
  ];

  for (const dim of DIMENSIONS) {
    const curAvg = avg(judges.map((j) => j.scores[dim]));
    const prevAvg = prevJudges.length > 0 ? avg(prevJudges.map((j) => j.scores[dim])) : 0;
    const hasPrev = prevJudges.length > 0;
    const diff = curAvg - prevAvg;
    const deltaStr = hasPrev
      ? Math.abs(diff) < 0.05
        ? "flat"
        : `**${diff > 0 ? "+" : ""}${diff.toFixed(1)}**`
      : "—";

    lines.push(
      `| ${dim} | ${curAvg.toFixed(1)}/5 | ${hasPrev ? prevAvg.toFixed(1) + "/5" : "—"} | ${deltaStr} |`,
    );
  }

  return lines.join("\n");
}

function buildPerPromptTable(records: PromptRecord[]): string {
  const lines = [
    "| Prompt | Calls | Skill | Self (O) | Check Violations | Judge (O) |",
    "|--------|-------|-------|----------|------------------|-----------|",
  ];

  for (const r of records) {
    const calls = r.test ? String(r.test.tool_calls) : "—";
    const skill = r.test ? (r.test.skill_referenced ? "yes" : "NO") : "—";
    const selfScore = r.test ? `${r.test.self_assessment.overall}/5` : "—";

    let checkViolations = "—";
    if (r.check) {
      const total = r.check.summary.total;
      checkViolations = total === 0 ? "**0**" : String(total);
    }

    const judgeScore = r.judge ? `${r.judge.scores.overall}/5` : "—";

    lines.push(
      `| ${r.id} | ${calls} | ${skill} | ${selfScore} | ${checkViolations} | ${judgeScore} |`,
    );
  }

  return lines.join("\n");
}

function buildViolationsSummary(records: PromptRecord[]): string {
  const allViolations: Array<{ prompt: string; line: number; category: string; description: string }> = [];

  for (const r of records) {
    if (!r.judge) continue;
    for (const v of r.judge.violations) {
      allViolations.push({ prompt: r.id, ...v });
    }
  }

  if (allViolations.length === 0) return "*No violations reported by judge.*";

  // Group by category
  const byCategory = new Map<string, number>();
  for (const v of allViolations) {
    byCategory.set(v.category, (byCategory.get(v.category) ?? 0) + 1);
  }

  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  const lines = [
    "| Category | Count | % of Total |",
    "|----------|-------|------------|",
  ];

  for (const [cat, count] of sorted) {
    const pct = ((count / allViolations.length) * 100).toFixed(0);
    lines.push(`| ${cat} | ${count} | ${pct}% |`);
  }

  lines.push("");
  lines.push(`**Total judge violations across all prompts:** ${allViolations.length}`);

  return lines.join("\n");
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: npx tsx scripts/diagnostic/assemble.ts <version>");
    console.error("Example: npx tsx scripts/diagnostic/assemble.ts v1");
    process.exit(1);
  }

  const resultsDir = `docs/diagnostic/${version}`;
  const benchDir = join(resultsDir, "test-bench");

  if (!existsSync(benchDir)) {
    console.error(`ERROR: Results directory not found: ${benchDir}`);
    process.exit(1);
  }

  console.log(`  Loading results from ${benchDir}/`);
  const records = loadAllResults(benchDir);
  const completedCount = records.filter((r) => r.test).length;
  console.log(`  Found ${completedCount} test results`);

  // Load previous version if available
  const versionNum = parseInt(version.replace("v", ""), 10);
  const prevVersion = `v${versionNum - 1}`;
  const prevBenchDir = join(`docs/diagnostic/${prevVersion}`, "test-bench");
  let prevRecords: PromptRecord[] | null = null;

  if (existsSync(prevBenchDir)) {
    console.log(`  Loading previous results from ${prevBenchDir}/`);
    prevRecords = loadAllResults(prevBenchDir);
    const prevCount = prevRecords.filter((r) => r.test).length;
    console.log(`  Found ${prevCount} previous results`);
  } else {
    console.log(`  No previous results at ${prevBenchDir}`);
  }

  const today = new Date().toISOString().split("T")[0];

  const scorecard = `# Code-Style Diagnostic Scorecard — ${version.toUpperCase()}

**Date:** ${today}
**Agent model:** claude-sonnet-4-6
**Prompts run:** ${completedCount}/15
**Previous version:** ${prevRecords ? prevVersion : "none"}

---

## Headline Metrics

${buildHeadlineTable(records, prevRecords)}

---

## Judge Scores by Dimension

${buildJudgeDimensionTable(records, prevRecords)}

---

## Per-Prompt Breakdown

${buildPerPromptTable(records)}

---

## Violation Categories (Judge)

${buildViolationsSummary(records)}
`;

  const outPath = join(resultsDir, "scorecard.md");
  writeFileSync(outPath, scorecard);
  console.log(`  Wrote ${outPath}`);
}

main();
