#!/usr/bin/env bash
# Builds the arm A1 image on rootless Docker, runs the audit smoke test on the fixture
# with no network, and records the image digest in the run manifest.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
base_image="${BASE_IMAGE:-slop-code:claude_code-2.0.51-python3.12}"
codewatch_version="${CODEWATCH_VERSION:-0.7.0}"
image="${IMAGE:-codewatch-scbench:a1-cw${codewatch_version}}"
run_dir="${SCBENCH_RUN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/codewatch-scbench}"
manifest="${MANIFEST:-$run_dir/manifest.json}"
python_tools="ruff|vulture|pydoclint|pyright|import-linter|suppressions"

fail() {
  echo "build.sh: $1" >&2
  exit 1
}

require_rootless() {
  docker info --format '{{.SecurityOptions}}' | grep -q rootless || fail "$DOCKER_HOST is not a rootless Docker daemon"
}

require_base() {
  docker image inspect "$base_image" >/dev/null 2>&1 && return
  fail "base image $base_image is missing; build it in a slop-code-bench checkout with
  uv run slop-code docker build-agent configs/agents/claude_code.yaml configs/environments/docker-python3.12-uv-rootless.yaml"
}

build_image() {
  docker build --build-arg "BASE_IMAGE=$base_image" --build-arg "CODEWATCH_VERSION=$codewatch_version" \
    --build-context "synthesis=$here/../synthesis" --build-context "review=$here/../review" \
    --build-context "tiert=$here/../tiert" --build-context "prflow=$here/../prflow" \
    --build-context "remediation=$here/../remediation" \
    -t "$image" "$here"
}

count_tool() {
  jq -s --arg tool "$2" '[.[] | select(.tool == $tool)] | length' "$1"
}

# SCBench's rootless env config runs the agent as container root (docker.user "0:0"),
# which rootless Docker maps to the host user, so the bind-mounted fixture stays writable.
run_smoke() {
  local fixture="$run_dir/smoke-fixture" log="$run_dir/smoke.log"
  rm -rf "$fixture"
  cp -R "$here/fixture" "$fixture"
  docker run --rm --network none --user 0:0 -v "$fixture:/fixture" "$image" codewatch audit /fixture 2>&1 | tee "$log"
  if grep -Eq "^codewatch audit: (skipped )?($python_tools):" "$log"; then fail "the audit skipped or failed a tool (see $log)"; fi
  smoke_findings="$fixture/.codewatch/audit/findings.jsonl"
  [ "$(count_tool "$smoke_findings" ruff)" -ge 1 ] || fail "no ruff finding in $smoke_findings"
  [ "$(count_tool "$smoke_findings" code-graph)" -ge 1 ] || fail "no code-graph finding in $smoke_findings"
  local tiert_rows
  tiert_rows="$(docker run --rm --network none "$image" python3 /opt/codewatch-a1/tiert /opt/codewatch-a1/tiert/fixtures/flagged | wc -l)"
  [ "$tiert_rows" -eq 7 ] || fail "tiert gave $tiert_rows rows on its flagged fixture, expected 7"
}

record_manifest() {
  mkdir -p "$(dirname "$manifest")"
  [ -f "$manifest" ] || echo '{}' >"$manifest"
  jq \
    --arg image "$image" \
    --arg digest "$(docker image inspect --format '{{.Id}}' "$image")" \
    --arg base "$base_image" \
    --arg baseDigest "$(docker image inspect --format '{{.Id}}' "$base_image")" \
    --argjson labels "$(docker image inspect --format '{{json .Config.Labels}}' "$image")" \
    --argjson python "$(jq -R -s 'split("\n") | map(select(length > 0))' "$here/requirements.txt")" \
    --argjson findings "$(jq -s 'group_by(.tool) | map({key: .[0].tool, value: length}) | from_entries' "$smoke_findings")" \
    --arg builtAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.a1Image = {image: $image, digest: $digest, base: $base, baseDigest: $baseDigest, builtAt: $builtAt,
      codewatch: $labels["io.codewatch.scbench.codewatch-version"], pyright: $labels["io.codewatch.scbench.pyright-version"],
      jscpd: $labels["io.codewatch.scbench.jscpd-version"], python: $python, smokeFindingsByTool: $findings}' \
    "$manifest" >"$manifest.tmp"
  mv "$manifest.tmp" "$manifest"
  echo "build.sh: $image $(jq -r .a1Image.digest "$manifest") recorded in $manifest"
}

mkdir -p "$run_dir"
require_rootless
require_base
build_image
run_smoke
record_manifest
