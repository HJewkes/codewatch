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
