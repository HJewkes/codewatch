"""The credential smoke's container side: one triage run, one 2-turn fix session, one review.

Run by `credential_smoke.py` inside the A1 image as `python3 -P /opt/smoke/in_container.py`.
The credential arrives only as `CLAUDE_CODE_OAUTH_TOKEN` in the environment. Each step
prints one JSON report line and writes its raw output under /out; nothing here prints
the environment.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, "/opt/codewatch-a1")

from remediation.items import QUESTIONS, TEST_GAP, UNCOVERED_SIGNAL, Item  # noqa: E402
from remediation.session import FixSession, first_prompt, render_item, run_process  # noqa: E402

WORKSPACE = Path("/workspace")
SPEC = Path("/spec/spec.md")
OUT = Path("/out")
MODEL = "claude-sonnet-5-5"
NO_SIDE_CALLS = "DISABLE_NON_ESSENTIAL_MODEL_CALLS"
FIX_TURNS = 2
CALL_TIMEOUT_S = 900
FIX_ITEM = Item(
    kind=TEST_GAP, signal=UNCOVERED_SIGNAL, path="inventory.py", symbol="restock",
    question=QUESTIONS[UNCOVERED_SIGNAL], verdict="confirmed",
    rationale="No test calls restock.", citations=("inventory.py:13",),
    fix="Add tests/test_restock.py covering a normal restock and an unreadable file.",
)


def _run(argv: list[str], **kwargs) -> subprocess.CompletedProcess:
    env = {**(kwargs.pop("env", None) or os.environ), NO_SIDE_CALLS: "1"}
    return subprocess.run(argv, capture_output=True, text=True, check=False, timeout=CALL_TIMEOUT_S, env=env, **kwargs)


def _token_sum(node) -> int:
    if isinstance(node, dict):
        return sum(v if isinstance(v, int) and "okens" in k else _token_sum(v) for k, v in node.items())
    if isinstance(node, list):
        return sum(_token_sum(v) for v in node)
    return 0


def triage() -> dict:
    audit = _run(["codewatch", "audit", str(WORKSPACE)])
    if audit.returncode != 0:
        return {"status": "failed", "exit": audit.returncode, "error": audit.stderr[-300:]}
    # The image pins @codewatch/cli 0.7.0, whose triage has no --spec and whose --model
    # defaults to the `sonnet` alias, which CC 2.0.51 resolves to an older Sonnet.
    done = _run(["codewatch", "triage", str(WORKSPACE), "--budget-usd", "0.2", "--min-rank", "0",
                 "--model", MODEL])
    (OUT / "triage.stdout.txt").write_text(done.stdout)
    (OUT / "triage.stderr.txt").write_text(done.stderr)
    report_file = WORKSPACE / ".codewatch" / "audit" / "triage.json"
    report = json.loads(report_file.read_text()) if report_file.is_file() else {}
    calls = report.get("calls", {})
    succeeded = calls.get("succeeded", 0)
    return {"status": "ok" if done.returncode == 0 and succeeded > 0 else "failed", "exit": done.returncode,
            "usd": report.get("cost", {}).get("spentUsd", 0.0), "tokens": _token_sum(report.get("traces", [])),
            "calls_planned": calls.get("planned", 0), "calls_succeeded": succeeded,
            "calls_failed": len(calls.get("failed", [])), "verdicts": report.get("verdicts", {}).get("written", 0),
            "errors": [f.get("error", "")[:200] for f in calls.get("failed", [])][:3],
            "stderr_tail": done.stderr[-300:] if done.returncode else ""}


def _recorded_run(argv, env, cwd, timeout):
    exit_code, stdout, timed_out = run_process(argv, env, cwd, timeout)
    with (OUT / "fix.stream.jsonl").open("a") as stream:
        stream.write(stdout)
    return exit_code, stdout, timed_out


def fix() -> dict:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.update({NO_SIDE_CALLS: "1", "CW_MODEL": MODEL, "CW_PERMISSION_MODE": "bypassPermissions", "CW_CLAUDE_BINARY": "claude"})
    session = FixSession(env=env, cwd=str(WORKSPACE), run=_recorded_run, max_turns=FIX_TURNS)
    result = session.ask(first_prompt(render_item(1, FIX_ITEM)), CALL_TIMEOUT_S)
    completed = result.exit_code is not None and not result.timed_out and result.subtype != "none"
    return {"status": "ok" if completed else "failed", "exit": result.exit_code, "subtype": result.subtype,
            "turns": session.turns, "tokens": session.tokens, "usd": round(session.usd, 6),
            "session_id": session.session_id}


def _commit_fix() -> str:
    git = ["git", "-c", "user.name=smoke", "-c", "user.email=smoke@invalid"]
    _run([*git, "add", "-A"], cwd=WORKSPACE)
    _run([*git, "commit", "-q", "-m", "Apply the smoke fix"], cwd=WORKSPACE)
    return _run(["git", "rev-parse", "HEAD"], cwd=WORKSPACE).stdout.strip()


def review() -> dict:
    sha = _commit_fix()
    env = {**os.environ, "PYTHONPATH": "/opt/codewatch-a1"}
    done = _run([sys.executable, "-P", "-m", "review", sha, "--spec", str(SPEC), "--workspace", str(WORKSPACE)],
                cwd=WORKSPACE, env=env)
    (OUT / "review.stdout.txt").write_text(done.stdout)
    (OUT / "review.stderr.txt").write_text(done.stderr)
    lines = done.stdout.strip().splitlines()
    report = json.loads(lines[-1]) if done.returncode == 0 and lines else {}
    return {"status": "ok" if report.get("verdict") not in (None, "error") else "failed", "exit": done.returncode,
            "verdict": report.get("verdict"), "files": report.get("files", []), "commit": sha,
            "tokens": report.get("tokens", 0), "usd": report.get("usd", 0.0), "error": done.stderr[-300:]}


def step(name: str, call) -> dict:
    start = time.time()
    try:
        record = call()
    except Exception as error:  # noqa: BLE001 - a failed step is reported, and the next still runs
        record = {"status": "failed", "error": f"{type(error).__name__}: {error}"[:300]}
    record = {"stage": name, "start": start, "end": time.time(), **record}
    print(json.dumps(record), flush=True)
    return record


def main() -> int:
    records = [step("triage", triage), step("fix", fix), step("review", review)]
    (OUT / "results.json").write_text(json.dumps(records, indent=1) + "\n")
    return 0 if all(r["status"] == "ok" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
