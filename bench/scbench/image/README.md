# Arm A1 agent image

The image for arm A1 of the SCBench pilot. It extends SCBench's native `claude_code` agent
image (`slop-code:claude_code-<cc version>-python3.12`, built by `slop-code docker
build-agent`) with:

- `@codewatch/cli` 0.7.0 at `/usr/local/bin/codewatch`
- pyright and jscpd from npm, on the base image's Node 22
- ruff, vulture, pydoclint, import-linter, coverage.py and pytest in a separate venv; the
  pins are in `requirements.txt`
- the synthesis stage (`../synthesis`) at `/opt/codewatch-a1/synthesis` and the PR-flow
  stages (`../prflow`) at `/opt/codewatch-a1/prflow`, each copied in as a named build
  context

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

1. Builds the image. A build step (`assert-clean.sh`) fails the build if `scb-check`,
   `slop-code`, ast-grep or any ast-grep rule file is present.
2. Copies `fixture/` (three synthetic Python files and an import-linter contract) to the
   run directory. It runs `codewatch audit /fixture` with `--network none`, as container
   root (`--user 0:0`, like SCBench's rootless env config). The smoke test fails if the
   audit prints a `skipped <tool>` or tool-failure line, or if `findings.jsonl` lacks a
   ruff or code-graph finding.
3. Writes the image ID (the digest of a local image), the base image ID, the tool versions
   and the smoke counts under `a1Image` in the run manifest.

| Variable | Default |
|---|---|
| `BASE_IMAGE` | `slop-code:claude_code-2.0.51-python3.12` |
| `CODEWATCH_VERSION` | `0.7.0` |
| `IMAGE` | `codewatch-scbench:a1-cw<codewatch version>` |
| `SCBENCH_RUN_DIR` | `~/.cache/codewatch-scbench` |
| `MANIFEST` | `$SCBENCH_RUN_DIR/manifest.json` |

npm resolves `@codewatch/cli`'s dependency ranges when the image is built. The image
digest in the manifest pins the result, so compare digests across arms, not version
strings.
