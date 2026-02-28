# Task 09: Diagnostic Runner + Assembler

## Architectural Context

The code-style project at `/Users/hjewkes/Documents/projects/code-style` has a diagnostic prompt suite (Task 08) with 15 test prompts and a judge prompt. This task builds the orchestration layer: a bash runner that executes prompts via `claude -p`, runs `code-style check` against generated code, runs the judge prompt for soft evaluation, and a TypeScript assembler that aggregates all results into a scorecard.

The design follows the brain project's diagnostic runner at `~/Documents/projects/brain/scripts/diagnostic/run.sh` and assembler at `~/Documents/projects/brain/scripts/diagnostic/assemble.ts`. Key differences: this system uses a style profile + skill export instead of brain CLI setup, adds a judge evaluation pass, and has 15 prompts (D-01 through D-15) instead of 30.

The profile schema has categories: `naming`, `structure`, `documentation`, `errorHandling`, `formatting`, `patterns`. The skill exporter (`packages/profile/src/exporters/skill.ts`) generates `skill.md`, `references/naming.md`, `references/patterns.md`, and `references/per-language/<lang>.md`. The CLI `code-style check` command outputs JSON with diagnostics including `file`, `line`, `column`, `severity`, `message`, `category`, `rule`.

## File Ownership

**May create:**
- `scripts/diagnostic/run.sh`
- `scripts/diagnostic/assemble.ts`
- `scripts/diagnostic/fixtures/test-profile.json`

**Must not touch:**
- `packages/**`
- `tests/**`
- `scripts/diagnostic/prompts/**` (Task 08 owns these)

**Read for context (do not modify):**
- `~/Documents/projects/brain/scripts/diagnostic/run.sh` — reference runner implementation
- `~/Documents/projects/brain/scripts/diagnostic/assemble.ts` — reference assembler implementation
- `packages/profile/src/exporters/skill.ts` — skill export logic
- `packages/cli/src/commands/check.ts` — check output format

## Steps

### Step 1: Create directory structure

```bash
cd /Users/hjewkes/Documents/projects/code-style
mkdir -p scripts/diagnostic/fixtures
```

### Step 2: Write `scripts/diagnostic/fixtures/test-profile.json`

Write the test profile fixture with the exact content specified below.

### Step 3: Write `scripts/diagnostic/run.sh`

Write the runner script with the exact content specified below. Make it executable:

```bash
chmod +x scripts/diagnostic/run.sh
```

### Step 4: Write `scripts/diagnostic/assemble.ts`

Write the assembler script with the exact content specified below.

### Step 5: Verify

```bash
# Check syntax
bash -n scripts/diagnostic/run.sh
npx tsx --eval "import './scripts/diagnostic/assemble.ts'" 2>&1 | head -5

# Check file structure
ls -la scripts/diagnostic/run.sh
ls -la scripts/diagnostic/assemble.ts
ls -la scripts/diagnostic/fixtures/test-profile.json
```

### Step 6: Commit

```bash
git add scripts/diagnostic/run.sh scripts/diagnostic/assemble.ts scripts/diagnostic/fixtures/test-profile.json
git commit -m "Add diagnostic runner and results assembler"
```

---

## File Contents

### `scripts/diagnostic/run.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Code-Style Diagnostic Runner
# Usage: ./scripts/diagnostic/run.sh <version> [options]
#   --profile <path>     Path to profile JSON (default: scripts/diagnostic/fixtures/test-profile.json)
#   --concurrency <n>    Parallel test agents (default: 3)
#   --budget <n>         Max budget per prompt in USD (default: 0.50)
#   --skip-check         Skip code-style check pass
#   --skip-judge         Skip judge evaluation pass

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_DIR"

VERSION="${1:?Usage: run.sh <version> [--profile <path>] [--concurrency <n>] [--budget <n>] [--skip-check] [--skip-judge]}"
shift

PROFILE_PATH="scripts/diagnostic/fixtures/test-profile.json"
CONCURRENCY=3
BUDGET="0.50"
SKIP_CHECK=false
SKIP_JUDGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_PATH="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    --skip-check) SKIP_CHECK=true; shift ;;
    --skip-judge) SKIP_JUDGE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

RESULTS_DIR="docs/diagnostic/v${VERSION}"
BENCH_DIR="${RESULTS_DIR}/test-bench"
PROMPTS_DIR="scripts/diagnostic/prompts/test-bench"
JUDGE_PROMPT="scripts/diagnostic/prompts/judge.md"

# Compute previous version for delta comparison
VERSION_NUM="${VERSION}"
PREV_NUM=$((VERSION_NUM - 1))
PREVIOUS_VERSION="${PREV_NUM}"

# Resolve absolute profile path
PROFILE_ABS="$(cd "$(dirname "$PROFILE_PATH")" && pwd)/$(basename "$PROFILE_PATH")"

echo "================================================================"
echo "  Code-Style Diagnostic — v${VERSION}"
echo "  Profile:     ${PROFILE_PATH}"
echo "  Concurrency: ${CONCURRENCY}"
echo "  Budget:      \$${BUDGET} per prompt"
echo "  Skip check:  ${SKIP_CHECK}"
echo "  Skip judge:  ${SKIP_JUDGE}"
echo "  Results:     ${RESULTS_DIR}/"
echo "================================================================"

# ── Phase 1: Setup ────────────────────────────────────

echo ""
echo "── Phase 1: Setup ──────────────────────────────────"

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "ERROR: Profile not found at ${PROFILE_PATH}"
  exit 1
fi

mkdir -p "${BENCH_DIR}"

# Export skill files from profile into temp directory
SKILL_DIR="$(mktemp -d)"
trap 'rm -rf "$SKILL_DIR"' EXIT

echo "  Exporting skill from profile..."
npx code-style export --format skill --profile "$PROFILE_PATH" --output "$SKILL_DIR"

if [[ ! -f "${SKILL_DIR}/skill.md" ]]; then
  echo "ERROR: Skill export failed — no skill.md in ${SKILL_DIR}"
  exit 1
fi

echo "  Skill exported to ${SKILL_DIR}"
echo "  Setup complete."

# ── Phase 2: Test Bench ──────────────────────────────

apply_template() {
  local content="$1"
  local output_dir="$2"

  echo "$content" | sed \
    -e "s|{{VERSION}}|v${VERSION}|g" \
    -e "s|{{PROFILE_PATH}}|${PROFILE_ABS}|g" \
    -e "s|{{SKILL_DIR}}|${SKILL_DIR}|g" \
    -e "s|{{OUTPUT_DIR}}|${output_dir}|g"
}

run_test_bench() {
  echo ""
  echo "── Phase 2: Test Bench (${CONCURRENCY} concurrent) ────────"

  local total=0
  local failed=0

  for batch_start in $(seq 1 "$CONCURRENCY" 15); do
    local pids=()
    local batch_ids=()

    for i in $(seq "$batch_start" $((batch_start + CONCURRENCY - 1))); do
      [[ $i -gt 15 ]] && break

      local num
      num=$(printf "%02d" "$i")
      local prompt_file="${PROMPTS_DIR}/D-${num}.md"
      local output_file="${BENCH_DIR}/D-${num}.json"
      local output_dir="${BENCH_DIR}/D-${num}-files"

      if [[ ! -f "$prompt_file" ]]; then
        echo "  SKIP: ${prompt_file} not found"
        continue
      fi

      mkdir -p "$output_dir"

      local prompt_content
      prompt_content="$(cat "$prompt_file")"
      local templated
      templated="$(apply_template "$prompt_content" "$output_dir")"

      (
        env -u CLAUDECODE claude -p \
          --model sonnet \
          --output-format json \
          --max-budget-usd "$BUDGET" \
          --permission-mode bypassPermissions \
          --no-session-persistence \
          "$templated" > "$output_file" 2>/dev/null
      ) &
      pids+=($!)
      batch_ids+=("D-${num}")
      ((total++))
    done

    if [[ ${#pids[@]} -gt 0 ]]; then
      echo "  Running: ${batch_ids[*]}"
      for pid in "${pids[@]}"; do
        if ! wait "$pid"; then
          ((failed++))
        fi
      done
    fi
  done

  echo "  Test bench complete: ${total} prompts, ${failed} failures"
}

# ── Phase 3: Code-Style Check ────────────────────────

run_check() {
  echo ""
  echo "── Phase 3: Code-Style Check ─────────────────────"

  local checked=0
  local skipped=0

  for i in $(seq 1 15); do
    local num
    num=$(printf "%02d" "$i")
    local result_file="${BENCH_DIR}/D-${num}.json"
    local files_dir="${BENCH_DIR}/D-${num}-files"
    local check_file="${BENCH_DIR}/D-${num}-check.json"

    if [[ ! -f "$result_file" ]]; then
      ((skipped++))
      continue
    fi

    # Extract files_written from the result JSON
    local files_written
    files_written=$(
      node -e "
        const fs = require('fs');
        const raw = fs.readFileSync('${result_file}', 'utf-8');
        try {
          const parsed = JSON.parse(raw);
          let result = parsed.result || JSON.stringify(parsed);
          result = result.replace(/^\`\`\`(?:json)?\s*\n?/, '').replace(/\n?\`\`\`\s*$/, '');
          const jsonStart = result.indexOf('{');
          const jsonEnd = result.lastIndexOf('}');
          if (jsonStart === -1) { process.exit(0); }
          const obj = JSON.parse(result.slice(jsonStart, jsonEnd + 1));
          if (obj.files_written) {
            obj.files_written.forEach(f => console.log(f));
          }
        } catch (e) {
          // skip unparseable results
        }
      " 2>/dev/null
    )

    if [[ -z "$files_written" ]]; then
      ((skipped++))
      continue
    fi

    # Build list of absolute file paths
    local abs_files=()
    while IFS= read -r relpath; do
      local abs_path="${files_dir}/${relpath}"
      if [[ -f "$abs_path" ]]; then
        abs_files+=("$abs_path")
      fi
    done <<< "$files_written"

    if [[ ${#abs_files[@]} -eq 0 ]]; then
      ((skipped++))
      continue
    fi

    echo "  Checking D-${num}: ${#abs_files[@]} file(s)"
    npx code-style check --format json --profile "$PROFILE_PATH" "${abs_files[@]}" > "$check_file" 2>/dev/null || true
    ((checked++))
  done

  echo "  Check complete: ${checked} checked, ${skipped} skipped"
}

# ── Phase 4: Judge Evaluation ────────────────────────

run_judge() {
  echo ""
  echo "── Phase 4: Judge Evaluation ──────────────────────"

  if [[ ! -f "$JUDGE_PROMPT" ]]; then
    echo "  ERROR: Judge prompt not found at ${JUDGE_PROMPT}"
    return
  fi

  local profile_json
  profile_json="$(cat "$PROFILE_PATH")"

  local judged=0
  local skipped=0

  for i in $(seq 1 15); do
    local num
    num=$(printf "%02d" "$i")
    local files_dir="${BENCH_DIR}/D-${num}-files"
    local judge_file="${BENCH_DIR}/D-${num}-judge.json"

    if [[ ! -d "$files_dir" ]]; then
      ((skipped++))
      continue
    fi

    # Collect all code content from the output directory
    local code_content=""
    while IFS= read -r -d '' codefile; do
      local relname="${codefile#${files_dir}/}"
      code_content+="--- ${relname} ---"$'\n'
      code_content+="$(cat "$codefile")"$'\n\n'
    done < <(find "$files_dir" -type f -name "*.ts" -o -name "*.json" -print0 2>/dev/null | sort -z)

    if [[ -z "$code_content" ]]; then
      ((skipped++))
      continue
    fi

    # Build judge prompt with template variables
    local judge_content
    judge_content="$(cat "$JUDGE_PROMPT")"
    judge_content="${judge_content//\{\{PROFILE_JSON\}\}/$profile_json}"
    judge_content="${judge_content//\{\{CODE_CONTENT\}\}/$code_content}"

    echo "  Judging D-${num}..."
    env -u CLAUDECODE claude -p \
      --model sonnet \
      --output-format json \
      --max-budget-usd 0.25 \
      --permission-mode bypassPermissions \
      --no-session-persistence \
      "$judge_content" > "$judge_file" 2>/dev/null || true
    ((judged++))
  done

  echo "  Judge complete: ${judged} judged, ${skipped} skipped"
}

# ── Phase 5: Assemble ───────────────────────────────

run_assemble() {
  echo ""
  echo "── Phase 5: Assemble Results ──────────────────────"

  npx tsx scripts/diagnostic/assemble.ts "v${VERSION}"

  echo "  Wrote ${RESULTS_DIR}/scorecard.md"
}

# ── Execute ──────────────────────────────────────────

run_test_bench

if [[ "$SKIP_CHECK" == false ]]; then
  run_check
fi

if [[ "$SKIP_JUDGE" == false ]]; then
  run_judge
fi

run_assemble

echo ""
echo "================================================================"
echo "  Diagnostic v${VERSION} complete"
echo "  Results:   ${RESULTS_DIR}/"
echo "  Scorecard: ${RESULTS_DIR}/scorecard.md"
echo "================================================================"
```

### `scripts/diagnostic/assemble.ts`

```typescript
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
```

### `scripts/diagnostic/fixtures/test-profile.json`

```json
{
  "$schema": "../../packages/profile/profile-schema.json",
  "schemaVersion": "1.0.0",
  "author": "testuser",
  "generated": "2026-02-28",
  "sources": ["testuser/sample-repo"],
  "naming": {
    "variables": {
      "convention": "camelCase",
      "confidence": 0.94,
      "stability": "high",
      "description": "Use camelCase for all local variables and parameters.",
      "examples": [
        { "good": "const userProfile = await fetchUser(id);" },
        { "bad": "const user_profile = await fetchUser(id);" }
      ]
    },
    "functions": {
      "convention": "camelCase",
      "confidence": 0.97,
      "stability": "high",
      "description": "Use camelCase for all function names.",
      "examples": [
        { "good": "function getUserById(id: string) {}" },
        { "bad": "function get_user_by_id(id: string) {}" }
      ]
    },
    "types": {
      "convention": "PascalCase",
      "confidence": 0.99,
      "stability": "high",
      "description": "Use PascalCase for interfaces, types, classes, and enums."
    },
    "constants": {
      "convention": "UPPER_SNAKE_CASE",
      "confidence": 0.88,
      "stability": "high",
      "description": "Use UPPER_SNAKE_CASE for module-level constants."
    },
    "files": {
      "convention": "kebab-case",
      "confidence": 0.85,
      "stability": "medium",
      "description": "Use kebab-case for file names."
    }
  },
  "structure": {
    "importOrder": {
      "convention": ["builtin", "external", "internal", "relative"],
      "confidence": 0.91,
      "fixability": "safe",
      "description": "Group imports: Node builtins, then external packages, then internal aliases, then relative paths. Separate groups with a blank line."
    },
    "maxFunctionLength": {
      "convention": "30 lines",
      "confidence": 0.78,
      "stability": "medium",
      "description": "Functions should be at most ~30 lines. Extract helpers for longer logic."
    },
    "preferredPatterns": {
      "convention": ["guard-clauses", "early-return", "composition"],
      "confidence": 0.82,
      "description": "Use guard clauses and early returns. Prefer composition over inheritance."
    },
    "exportStyle": {
      "convention": "named-exports",
      "confidence": 0.90,
      "stability": "high",
      "description": "Use named exports. Avoid default exports."
    }
  },
  "documentation": {
    "functionDocs": {
      "convention": "jsdoc-selective",
      "confidence": 0.80,
      "description": "Add JSDoc to exported functions only. Rely on TypeScript types instead of @param tags."
    },
    "moduleHeader": {
      "convention": "brief-comment",
      "confidence": 0.65,
      "stability": "medium",
      "description": "Add a brief module-level comment describing purpose. No license headers."
    },
    "inlineComments": {
      "convention": "why-not-what",
      "confidence": 0.85,
      "stability": "high",
      "description": "Comments explain why, not what. Code should be self-documenting."
    }
  },
  "errorHandling": {
    "catchStyle": {
      "convention": "typed-catch",
      "confidence": 0.76,
      "stability": "medium",
      "description": "Use typed error handling. Narrow unknown errors before accessing properties. Never use bare catch blocks."
    },
    "errorTypes": {
      "convention": "custom-error-classes",
      "confidence": 0.70,
      "stability": "medium",
      "description": "Define custom error classes for domain errors. Extend Error with meaningful names."
    },
    "earlyReturn": {
      "convention": "guard-clause",
      "confidence": 0.88,
      "stability": "high",
      "description": "Validate inputs at the top of functions and return/throw early."
    }
  },
  "formatting": {
    "semicolons": {
      "convention": "always",
      "confidence": 0.95,
      "stability": "high"
    },
    "quotes": {
      "convention": "double",
      "confidence": 0.92,
      "stability": "high"
    },
    "trailingComma": {
      "convention": "all",
      "confidence": 0.88,
      "stability": "high"
    },
    "indentation": {
      "convention": "2 spaces",
      "confidence": 0.97,
      "stability": "high"
    }
  },
  "patterns": {
    "preferPureFunctions": {
      "convention": "strong",
      "confidence": 0.82,
      "stability": "medium",
      "description": "Prefer pure functions over stateful methods. Isolate side effects at boundaries."
    },
    "avoidClassInheritance": {
      "convention": "moderate",
      "confidence": 0.68,
      "stability": "medium",
      "description": "Prefer composition over class inheritance. Use interfaces and dependency injection."
    },
    "asyncPatterns": {
      "convention": "async-await",
      "confidence": 0.95,
      "stability": "high",
      "description": "Use async/await over raw Promises. Avoid .then() chains."
    }
  },
  "idioms": {
    "detected": [
      {
        "name": "nullish-coalescing",
        "description": "Use ?? over || for default values",
        "frequency": 42,
        "confidence": 0.90
      },
      {
        "name": "optional-chaining",
        "description": "Use ?. for nested property access",
        "frequency": 38,
        "confidence": 0.88
      }
    ]
  },
  "antiPatterns": {
    "acknowledged": [
      {
        "pattern": "any type",
        "reason": "Avoid 'any' — use 'unknown' and narrow instead"
      },
      {
        "pattern": "nested callbacks",
        "reason": "Use async/await instead of nested callbacks"
      }
    ]
  },
  "overrides": [],
  "severityThresholds": {
    "error": 0.85,
    "warn": 0.60,
    "info": 0.40
  }
}
```

---

## Success Criteria

- [ ] `bash -n scripts/diagnostic/run.sh` passes (valid bash syntax)
- [ ] `scripts/diagnostic/run.sh` is executable
- [ ] `scripts/diagnostic/assemble.ts` compiles without TypeScript errors
- [ ] `scripts/diagnostic/fixtures/test-profile.json` is valid JSON matching the profile schema
- [ ] Runner creates `docs/diagnostic/v${VERSION}/test-bench/` directory structure
- [ ] Runner replaces all four template variables: `{{VERSION}}`, `{{PROFILE_PATH}}`, `{{SKILL_DIR}}`, `{{OUTPUT_DIR}}`
- [ ] Runner respects `--skip-check` and `--skip-judge` flags
- [ ] Runner runs prompts in batches of `$CONCURRENCY`
- [ ] Assembler handles missing/malformed results gracefully
- [ ] Assembler produces `scorecard.md` with headline metrics, per-prompt breakdown, and judge dimension table
- [ ] Assembler computes deltas against previous version when available

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not modify prompt files in `scripts/diagnostic/prompts/` — Task 08 owns those
5. Do not add npm dependencies — use only Node.js built-ins and existing workspace packages
6. Do not make the runner part of the CI test suite — this runs manually
7. Do not hardcode model names in the assembler — only the runner decides which model to use
