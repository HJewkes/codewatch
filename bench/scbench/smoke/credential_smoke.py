"""U10 credential smoke: the A1 image's three model paths, with the OAuth token from env only.

Run from bench/scbench, with the token as an env prefix (the value never goes on argv):

    DOCKER_HOST=unix:///run/user/1000/docker.sock \
    CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/scbench/claude-oauth-token-server)" \
    python3 -m smoke.credential_smoke --out "$HOME/.cache/codewatch-scbench/runs/U10/<UTC ts>"

It copies the synthetic fixture into `<out>/workspace` as a git repository, then runs
`in_container.py` in the A1 image. `docker run` gets `-e CLAUDE_CODE_OAUTH_TOKEN` by name,
and reads the value from this process's environment. The container uses the default
bridge network, because the calls need the API. It runs as 0:0 with `IS_SANDBOX=1`, as the
pilot env does. Claude's home is `<out>/home`, so its traces sit beside the results for
the leak scan. The three report lines go into `<out>/stages.json` through U2's writer.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from agent.output_guard import refuse_repo_run_dir
from agent.stages import StageRecord, write_stages_json

HERE = Path(__file__).resolve().parent
DEFAULT_IMAGE = "codewatch-scbench:a1-cw0.7.0"
TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN"
CONTAINER_NAME_PREFIX = "scbench-u10-smoke-"
REPORT_KEYS = ("tokens", "usd")


def prepare(out: Path) -> None:
    workspace = out / "workspace"
    shutil.copytree(HERE / "fixture", workspace)
    for sub in ("home", "out", "spec"):
        (out / sub).mkdir(parents=True)
    shutil.copy(HERE / "spec.md", out / "spec" / "spec.md")
    git = ["git", "-c", "user.name=smoke", "-c", "user.email=smoke@invalid"]
    subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
    (workspace / ".git" / "info" / "exclude").write_text(".codewatch/\n__pycache__/\n")
    subprocess.run([*git, "add", "-A"], cwd=workspace, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "Add the smoke fixture"], cwd=workspace, check=True)


def docker_argv(out: Path, image: str, name: str) -> list[str]:
    mounts = {out / "workspace": "/workspace", out / "home": "/smoke-home", out / "out": "/out",
              out / "spec": "/spec:ro", HERE / "in_container.py": "/opt/smoke/in_container.py:ro"}
    argv = ["docker", "run", "--rm", "--name", name, "--user", "0:0",
            "-e", TOKEN_ENV, "-e", "IS_SANDBOX=1", "-e", "HOME=/smoke-home", "--workdir", "/workspace"]
    for host, container in mounts.items():
        argv += ["-v", f"{host}:{container}"]
    return argv + ["--entrypoint", "python3", image, "-P", "/opt/smoke/in_container.py"]


def report_lines(stdout: str) -> list[dict]:
    rows = []
    for line in stdout.splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and "stage" in row:
            rows.append(row)
    return rows


def _iso(epoch: float | None) -> str | None:
    return datetime.fromtimestamp(epoch, UTC).isoformat() if epoch else None


def stage_record(row: dict) -> StageRecord:
    extra = {k: v for k, v in row.items() if k not in {"stage", "status", "start", "end", "exit", *REPORT_KEYS}}
    return StageRecord(stage=f"smoke-{row['stage']}", status=row["status"], start=_iso(row.get("start")),
                       end=_iso(row.get("end")), exit=row.get("exit"), tokens=int(row.get("tokens") or 0),
                       usd=float(row.get("usd") or 0.0), extra=extra)


def run(out: Path, image: str) -> int:
    if not os.environ.get(TOKEN_ENV):
        sys.exit(f"credential_smoke: set {TOKEN_ENV} as an env prefix; it is passed to docker by name")
    refuse_repo_run_dir(str(out))
    if out.exists():
        sys.exit(f"credential_smoke: {out} already exists")
    prepare(out)
    name = CONTAINER_NAME_PREFIX + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    done = subprocess.run(docker_argv(out, image, name), capture_output=True, text=True, check=False)
    (out / "container.stdout.txt").write_text(done.stdout)
    (out / "container.stderr.txt").write_text(done.stderr)
    rows = report_lines(done.stdout)
    write_stages_json(out / "stages.json", checkpoint=1, records=[stage_record(r) for r in rows], mcp_tool_calls=0)
    for row in rows:
        print(json.dumps({k: row.get(k) for k in ("stage", "status", "exit", "tokens", "usd")}))
    ok = done.returncode == 0 and len(rows) == 3
    print(f"credential_smoke: container exit {done.returncode}; {'all three calls completed' if ok else 'FAILED'}")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m smoke.credential_smoke")
    p.add_argument("--out", type=Path, required=True, help="a new directory outside any checkout")
    p.add_argument("--image", default=DEFAULT_IMAGE)
    args = p.parse_args(argv)
    return run(args.out.resolve(), args.image)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
