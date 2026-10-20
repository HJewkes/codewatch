"""The runner's container steps, in the A1 image as newc_arm.sh and run_c246.sh run them (C-248 S6).

  session   one headless `claude -p` (sonnet-5.5) on the lane's workspace. `scbench gate` (scbench.sh)
            is mounted as its one codewatch tool, over a copy of gate/ and planner/; the image's own
            codewatch CLI and its install are masked. run.json records the cost and whether the tree
            changed (a no-op session is never a pass: the E2 parity lesson).
  visible   the workspace's own tests, on a copy.
  diffgate  C-242 `diffgate.sh inloop` against the wave base; its work dir is pruned once read. A case
            that timed out on the base (both base runs, or diffgate would call it nondeterministic) says
            nothing about the lane, so it is counted as inconclusive and left out of the verdict.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from runner.splice import SKIP, changed_files, tree_files

IMAGE = "codewatch-scbench:a1-cw0.7.0-eaf087f"
MODEL = "claude-sonnet-5-5"
BENCH = Path(__file__).resolve().parent.parent
TOKEN = Path.home() / ".config" / "scbench" / "claude-oauth-token-server"
ENV = {**os.environ, "DOCKER_HOST": "unix:///run/user/1000/docker.sock"}
SESSION = """git config --global --add safe.directory "*"
python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1
claude --output-format stream-json --verbose --model {model} --max-turns {turns} \\
  --permission-mode bypassPermissions --print -- "$(cat /tmp/prompt.md)"; chmod -R a+rwX /workspace 2>/dev/null"""
VISIBLE = """python -m venv /tmp/v >/dev/null && /tmp/v/bin/pip install -q -r requirements.txt pytest >/dev/null 2>&1
/tmp/v/bin/python -m pytest -q -rf -p no:cacheprovider tests"""


def copy_tree(src: Path, dst: Path) -> Path:
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst, symlinks=True, ignore=shutil.ignore_patterns(*SKIP))
    return dst


def gate_lib(dst: Path) -> Path:
    """The packages `python3 -m gate` imports, and nothing else of the bench."""
    for pkg in ("gate", "planner", "calibration"):
        shutil.copytree(BENCH / pkg, dst / pkg, ignore=shutil.ignore_patterns("__pycache__"), dirs_exist_ok=True)
    (dst / "c239" / "harness").mkdir(parents=True, exist_ok=True)
    shutil.copy2(BENCH / "c239" / "harness" / "dilution.py", dst / "c239" / "harness")
    return dst


def _session_argv(name: str, ws: Path, prompt: Path, gate: Path, base: Path, lib: Path, turns: int) -> list[str]:
    mounts = [f"{ws}:/workspace", f"{prompt}:/tmp/prompt.md:ro", f"{gate}:/opt/gate", f"{base}:/opt/base:ro",
              f"{lib}:/opt/cwlib:ro", f"{BENCH / 'runner' / 'scbench.sh'}:/usr/local/bin/scbench:ro",
              "/dev/null:/usr/local/bin/codewatch:ro"]
    env = {"CW_GATE_LIB": "/opt/cwlib", "CW_GATE_BASE": "/opt/base", "CW_GATE_PLAN": "/opt/gate/plan.json",
           "CW_GATE_CALLS": "/opt/gate/calls.json", "CW_GATE_REFUSED": "/opt/gate/refused"}
    return (["docker", "run", "--rm", "--name", name, "--tmpfs", "/opt/codewatch-a1", "-w", "/workspace",
             "-e", "CLAUDE_CODE_OAUTH_TOKEN", "-e", "DISABLE_NON_ESSENTIAL_MODEL_CALLS=1"]
            + [a for m in mounts for a in ("-v", m)] + [a for k, v in env.items() for a in ("-e", f"{k}={v}")]
            + ["--entrypoint", "bash", IMAGE, "-c", SESSION.format(model=MODEL, turns=turns)])


def result_event(stdout: Path) -> dict:
    for line in stdout.read_text(errors="replace").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") == "result":
            return event
    return {}


def session(name: str, ws: Path, prompt: str, gate: Path, base: Path, lib: Path, out: Path, turns: int = 40) -> dict:
    """Run one session; -> run.json's facts (exit, wall_s, usd, turns, tree_changed, changed_files)."""
    out.mkdir(parents=True, exist_ok=True)
    (out / "prompt.md").write_text(prompt)
    before = tree_files(ws)
    subprocess.run(["chmod", "-R", "a+rwX", str(ws), str(gate), str(out)], check=False)
    start = time.time()
    with (out / "stdout.jsonl").open("w") as so, (out / "stderr.log").open("w") as se:
        done = subprocess.run(_session_argv(name, ws, out / "prompt.md", gate, base, lib, turns), stdout=so,
                              stderr=se, env={**ENV, "CLAUDE_CODE_OAUTH_TOKEN": TOKEN.read_text().strip()}, check=False)
    shutil.rmtree(ws / ".venv", ignore_errors=True)
    event, changed = result_event(out / "stdout.jsonl"), changed_files(before, tree_files(ws))
    facts = {"exit": done.returncode, "wall_s": round(time.time() - start), "usd": event.get("total_cost_usd") or 0.0,
             "turns": event.get("num_turns"), "subtype": event.get("subtype"), "tree_changed": bool(changed),
             "changed_files": changed}
    (out / "run.json").write_text(json.dumps(facts, indent=1, sort_keys=True) + "\n")
    return facts


def visible(ws: Path, out: Path) -> dict:
    copy = copy_tree(ws, out / "visible-ws")
    subprocess.run(["chmod", "-R", "a+rwX", str(copy)], check=False)
    done = subprocess.run(["docker", "run", "--rm", "-v", f"{copy}:/workspace", "-w", "/workspace",
                           "--entrypoint", "bash", IMAGE, "-c", VISIBLE], capture_output=True, text=True, env=ENV, check=False)
    shutil.rmtree(copy, ignore_errors=True)
    failed = sorted({line.split()[1] for line in done.stdout.splitlines() if line.startswith("FAILED ")})
    result = {"pass": done.returncode == 0, "rc": done.returncode, "failed": failed,
              "summary": (done.stdout.strip().splitlines() or [""])[-1]}
    (out / "visible.json").write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
    return result


def diffgate(problem: str, n: int, base: Path, head: Path, out: Path) -> dict:
    dg = out / "diffgate"
    subprocess.run(["bash", str(BENCH / "c239" / "harness" / "diffgate.sh"), problem, str(n), str(base), str(head),
                    str(dg), "inloop"], capture_output=True, env=ENV, check=False)
    shutil.rmtree(dg / "work", ignore_errors=True)
    gate = dg / "gate.json"
    return settle_timeouts(json.loads(gate.read_text())) if gate.is_file() else {"pass": False, "error": "no gate.json"}


def settle_timeouts(gate: dict) -> dict:
    """The verdict without the differing cases whose base run timed out."""
    def base_timeout(item: dict) -> bool:
        return item.get("status") == "differs" and (item.get("base") or {}).get("rc") == "timeout"
    timed_out = [i["case"] for i in gate.get("differences", []) if base_timeout(i)]
    left = [i for i in gate.get("differences", []) if not base_timeout(i)]
    return {**gate, "pass": not any(i.get("status") == "differs" for i in left), "differences": left,
            "inconclusive": timed_out}
