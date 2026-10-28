#!/usr/bin/env bash
# Builds the arm A1 image on rootless Docker from a `pnpm deploy` of a clean codewatch sha,
# runs the smoke tests on the fixture with no network, and records the image digest, the
# source sha and the artifact hash in the run manifest.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
base_image="${BASE_IMAGE:-slop-code:claude_code-2.0.51-python3.12}"
codewatch_src="${CODEWATCH_SRC:-$(cd "$here/../../.." && pwd)}"
run_dir="${SCBENCH_RUN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/codewatch-scbench}"
manifest="${MANIFEST:-$run_dir/manifest.json}"
context="$run_dir/build-context"
codewatch_entry="$run_dir/codewatch-entry.json"
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

# One staged context instead of named build contexts: `--build-context` needs buildx, and
# a rootless host may only have the legacy builder. Bytecode caches stay out of the image.
stage_packages="synthesis review tiert prflow remediation findings inject"

# The plugin comes from a committed sha, never the working tree, and the sha is a label.
repo_root="$(git -C "$here" rev-parse --show-toplevel)"
plugin_sha="$(git -C "$repo_root" rev-parse --verify "${CODEWATCH_PLUGIN_SHA:-HEAD}^{commit}")"

stage_plugin() {
  git -C "$repo_root" archive --prefix=plugin/ "$plugin_sha:plugins/codewatch" | tar -x -C "$1"
}

stage_context() {
  rm -rf "$context"
  mkdir -p "$context"
  cp -R "$here/." "$context/"
  for package in $stage_packages; do
    cp -R "$here/../$package" "$context/$package"
  done
  stage_plugin "$context"
  find "$context" -name __pycache__ -type d -prune -exec rm -rf {} +
}

# The CLI comes from the source's committed sha, never its working tree: artifact.py refuses a
# dirty tree before the build and again after it, when it hashes the deploy directory, and
# refuses a source whose HEAD moved off the checked sha in between.
stage_codewatch() {
  source_sha="$(python3 "$here/artifact.py" check-clean "$codewatch_src")" || fail "refusing to build from a dirty $codewatch_src"
  pnpm --dir "$codewatch_src" install --frozen-lockfile
  pnpm --dir "$codewatch_src" --filter "@codewatch/cli..." build
  pnpm --dir "$codewatch_src" --filter @codewatch/cli deploy --prod "$context/codewatch"
  # pnpm records the host's absolute store path here; nothing reads it at run time.
  rm -f "$context/codewatch/node_modules/.modules.yaml"
  # pnpm links the package to its own source checkout, which dangles in the image. Docker's
  # layer cache ignores symlink targets, so a deploy from another checkout reused a stale COPY.
  rm -f "$context/codewatch/node_modules/.pnpm/node_modules/@codewatch/cli"
  python3 "$here/artifact.py" entry "$codewatch_src" "$context/codewatch" "$source_sha" >"$codewatch_entry" \
    || fail "refusing to record an artifact: $codewatch_src is dirty or moved off $source_sha"
  codewatch_version="$(jq -r .version "$codewatch_entry")"
  image="${IMAGE:-codewatch-scbench:$(python3 "$here/artifact.py" tag "$codewatch_version" "$source_sha")}"
}

build_image() {
  docker build --build-arg "BASE_IMAGE=$base_image" --build-arg "CODEWATCH_VERSION=$codewatch_version" \
    --build-arg "CODEWATCH_SOURCE_SHA=$source_sha" \
    --build-arg "CODEWATCH_ARTIFACT_SHA256=$(jq -r .artifact_sha256 "$codewatch_entry")" \
    --build-arg "CODEWATCH_PLUGIN_SHA=$plugin_sha" -t "$image" "$context"
  rm -rf "$context"
}

# The image's CLI must be the artifact the manifest records, so it is rehashed inside the image.
verify_artifact() {
  local expected
  expected="$(jq -r .artifact_sha256 "$codewatch_entry")"
  docker run --rm --network none --user 0:0 -v "$here/artifact.py:/artifact.py:ro" "$image" \
    python3 -I /artifact.py hash /opt/codewatch-a1/node/codewatch "$expected" >/dev/null \
    || fail "the image's CLI does not hash to the recorded $expected"
  echo "build.sh: the image's CLI hashes to the recorded $expected"
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
  run_cli_checks
}

# The CLI features A1 needs (C-184): `graph index --rev` under a GIT_DIR outside the work tree,
# as the PR-flow stages run it, and a triage with no default budget (record_manifest.py relies
# on that for a source build). The solve session's PATH must not reach the pinned tools.
run_cli_checks() {
  docker run --rm --network none --user 0:0 -v "$here/fixture:/fixture-src:ro" -v "$here/rev-check.sh:/rev-check.sh:ro" \
    "$image" bash /rev-check.sh /fixture-src >"$run_dir/rev-check.json" || fail "graph index --rev failed under GIT_DIR"
  python3 "$here/rev_check.py" "$run_dir/rev-check.json" || fail "graph index --rev did not read HEAD~1 (see $run_dir/rev-check.json)"
  local triage_help solve_path
  triage_help="$(docker run --rm --network none "$image" codewatch triage --help)"
  grep -q -- '--budget-usd.*(default: no' <<<"$triage_help" || fail "the image's triage has a default budget"
  solve_path="$(docker run --rm --network none --user 0:0 "$image" bash -lc 'printf %s "$PATH"')"
  case ":$solve_path:" in *:/opt/codewatch-a1/bin:*) fail "the solve PATH includes /opt/codewatch-a1/bin" ;; esac
}

count_signal() {
  jq -s --arg signal "$2" '[.[] | select(.signal == $signal)] | length' "$1"
}

# The audit stage's own command on a fixture PR: the fixture plus fixture-pr's one test and
# planted clone. repo-init and pr-open give it a merge-base that predates every file, so the
# functions the test skips are uncovered. The plain fixture stays test-free for the CLI's tests.
run_findings_smoke() {
  local fixture="$run_dir/findings-fixture" log="$run_dir/findings-smoke.log" findings
  local stage="PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m"
  rm -rf "$fixture"
  cp -R "$here/fixture" "$fixture"
  cp -R "$here/fixture-pr/." "$fixture/"
  docker run --rm --network none --user 0:0 -e CW_CHECKPOINT=1 -v "$fixture:/workspace" "$image" \
    bash -c "$stage prflow repo-init && $stage prflow pr-open && $stage findings.audit_stage" 2>&1 | tee "$log"
  findings="$fixture/.codewatch/audit/findings.jsonl"
  [ "$(count_signal "$findings" diff-uncovered)" -ge 1 ] || fail "no diff-uncovered finding in $findings (see $log)"
  [ "$(count_signal "$findings" clone)" -ge 1 ] || fail "no clone finding in $findings (see $log)"
}

# The inject stage's own command, then the SessionStart hook it enabled, on a synthetic carry.
run_inject_smoke() {
  local fixture="$run_dir/inject-fixture" log="$run_dir/inject-smoke.log"
  local stage="PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m"
  local hook='import json, os; print(json.load(open(os.path.expanduser("~/.claude/settings.json")))["hooks"]["SessionStart"][0]["hooks"][0]["command"])'
  rm -rf "$fixture"
  mkdir -p "$fixture/.codewatch"
  echo "- Keep money in integer cents. {owner}" >"$fixture/.codewatch/taste.md"
  docker run --rm --network none --user 0:0 -e HOME=/tmp/cw-home -e CLAUDE_PROJECT_DIR=/workspace \
    -v "$fixture:/workspace" "$image" \
    bash -c "$stage inject --workspace /workspace --plugin-root /opt/codewatch-a1/plugin && sh -c \"\$(/opt/codewatch-a1/py/bin/python -c '$hook')\"" \
    2>&1 | tee "$log"
  grep -q "Keep money in integer cents" "$log" || fail "the SessionStart hook did not carry taste.md (see $log)"
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
      codewatch: $labels["io.codewatch.scbench.codewatch-version"],
      codewatchSourceSha: $labels["io.codewatch.scbench.codewatch-source-sha"],
      pyright: $labels["io.codewatch.scbench.pyright-version"],
      jscpd: $labels["io.codewatch.scbench.jscpd-version"],
      codewatchPluginSha: $labels["io.codewatch.scbench.codewatch-plugin-sha"], python: $python, smokeFindingsByTool: $findings}' \
    "$manifest" >"$manifest.tmp"
  mv "$manifest.tmp" "$manifest"
  MANIFEST="$manifest" python3 "$here/../prompts/record_manifest.py" --codewatch "$codewatch_entry"
  echo "build.sh: $image $(jq -r .a1Image.digest "$manifest") recorded in $manifest"
}

mkdir -p "$run_dir"
require_rootless
require_base
stage_context
stage_codewatch
build_image
verify_artifact
run_smoke
run_findings_smoke
run_inject_smoke
record_manifest
