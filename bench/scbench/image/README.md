# Arm A1 agent image

The image for arm A1 of the SCBench pilot. It extends SCBench's native `claude_code` agent
image (`slop-code:claude_code-<cc version>-python3.12`, built by `slop-code docker
build-agent`) with:

- the codewatch CLI at `/usr/local/bin/codewatch`, built from a clean codewatch sha: a
  `pnpm deploy --filter @codewatch/cli --prod` directory at `/opt/codewatch-a1/node/codewatch`
- pyright and jscpd from npm, on the base image's Node 22
- ruff, vulture, pydoclint, import-linter, coverage.py and pytest in a separate venv; the
  pins are in `requirements.txt`
- the synthesis stage (`../synthesis`) at `/opt/codewatch-a1/synthesis`, the spec-aware
  commit review (`../review`) at `/opt/codewatch-a1/review`, the PR-flow stages
  (`../prflow`) at `/opt/codewatch-a1/prflow` and the remediation stage (`../remediation`)
  at `/opt/codewatch-a1/remediation`, plus Tier T (`../tiert`) at `/opt/codewatch-a1/tiert`.
  `build.sh` copies these packages into one staged build context, without `__pycache__`.
  It doesn't use named build contexts because those need buildx, and the rootless host
  has only the legacy builder.

The tools sit in `/opt/codewatch-a1/bin`. Only the `codewatch` wrapper puts that directory
on `PATH`, so the solve session sees the same `PATH` and `python` as arm A1a. Later stages
call the tools by their full path.

## Build

```sh
bench/scbench/image/build.sh
```

The script uses rootless Docker only. `DOCKER_HOST` defaults to
`unix:///run/user/<uid>/docker.sock`, and the script stops if the daemon is not rootless.
It then:

1. Refuses a dirty `CODEWATCH_SRC` (uncommitted or untracked files), installs and builds the
   CLI there, and runs `pnpm deploy` into the build context. `artifact.py` checks the tree
   again and hashes the deploy directory's sorted file list. The image tag is
   `a1-cw<version>-<sha7>`.
2. Builds the image. A build step (`assert-clean.sh`) fails the build if `scb-check`,
   `slop-code`, ast-grep or any ast-grep rule file is present.
3. Copies `fixture/` (three synthetic Python files and an import-linter contract) to the
   run directory. It runs `codewatch audit /fixture` with `--network none`, as container
   root (`--user 0:0`, like SCBench's rootless env config). The smoke test fails if the
   audit prints a `skipped <tool>` or tool-failure line, or if `findings.jsonl` lacks a
   ruff or code-graph finding. With no network, it also runs `rev-check.sh`, which commits a
   copy of the fixture into a repository whose `GIT_DIR` sits outside the work tree and runs
   `graph index --rev HEAD~1`. It checks that triage has no default budget, and that a login
   shell's `PATH` in the image does not include `/opt/codewatch-a1/bin`.
4. Writes the image ID (the digest of a local image), the base image ID, the tool versions
   and the smoke counts under `a1Image` in the run manifest, and the CLI's repo, source sha,
   `dirty: false`, version and artifact hash under `codewatch`.

| Variable | Default |
|---|---|
| `BASE_IMAGE` | `slop-code:claude_code-2.0.51-python3.12` |
| `CODEWATCH_SRC` | this checkout's root |
| `IMAGE` | `codewatch-scbench:a1-cw<codewatch version>-<sha7>` |
| `SCBENCH_RUN_DIR` | `~/.cache/codewatch-scbench` |
| `MANIFEST` | `$SCBENCH_RUN_DIR/manifest.json` |

`pnpm deploy` installs the CLI's dependencies from the source's lockfile, so no npm release
is needed. The version string stays the last release's until the next one, so compare
source shas and image digests across arms, not version strings. npm still resolves pyright
and jscpd when the image is built.
