"""The remediation session: one claude CLI run over the chosen items, capped at 30 turns.

It uses the solve's binary, model, permission mode and credential env, which the stage
agent passes in. Its traces land in the same `~/.claude` as the solve's, so it runs
under a fresh `--session-id` that `stages.json` records; the transcript audit and the
analysis tell the two apart by that id.

The prompt names only the workspace, its tests and the confirmed items. It never names
the grader, its tool or its metrics (design section 3).
"""

from __future__ import annotations

import json
import subprocess
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from .items import Item

MAX_TURNS = 30

PROMPT_HEAD = """\
A review of this workspace confirmed the items below. Fix them, in the order given.
Each item gives the question the reviewer answered, the answer, the evidence and a
one-line sketch of the fix. Stop at any item you cannot fix safely and move on.

Rules:
- Keep every test under tests/ passing. Run the tests before you finish.
- Do not change what the program prints, returns or writes, unless an item says to.
- Do not edit anything under .codewatch/.
"""


@dataclass(frozen=True)
class SessionResult:
    session_id: str
    exit_code: int | None
    timed_out: bool
    turns: int
    tokens: int
    usd: float
    subtype: str


Run = Callable[[Sequence[str], Mapping[str, str], str, float], tuple[int | None, str, bool]]


def render_item(index: int, item: Item) -> str:
    target = f"{item.path} ({item.symbol})" if item.symbol else item.path
    lines = [
        f"{index}. [{item.kind}] {target}",
        f"   Question: {item.question}",
        f"   Answer: {item.verdict}. {item.rationale}".rstrip(),
        f"   Evidence: {', '.join(item.citations) or 'none'}",
        f"   Fix: {item.fix}",
    ]
    return "\n".join(lines)


def render_prompt(items: Sequence[Item]) -> str:
    body = "\n\n".join(render_item(n, item) for n, item in enumerate(items, start=1))
    return f"{PROMPT_HEAD}\nItems:\n\n{body}\n"


def claude_argv(env: Mapping[str, str], session_id: str, prompt: str) -> list[str]:
    argv = [env.get("CW_CLAUDE_BINARY", "claude"), "--output-format", "stream-json", "--verbose"]
    if env.get("CW_MODEL"):
        argv += ["--model", env["CW_MODEL"]]
    argv += ["--max-turns", str(MAX_TURNS)]
    if env.get("CW_PERMISSION_MODE"):
        argv += ["--permission-mode", env["CW_PERMISSION_MODE"]]
    return argv + ["--session-id", session_id, "--print", "--", prompt]


def parse_result(stdout: str) -> dict:
    """The last `result` event of a stream-json run, or {} when none arrived."""
    found: dict = {}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("type") == "result":
            found = event
    return found


def _tokens(usage: Mapping) -> int:
    keys = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    return sum(int(usage.get(k) or 0) for k in keys)


def run_session(items: Sequence[Item], env: Mapping[str, str], cwd: str, timeout: float, run: Run) -> SessionResult:
    session_id = str(uuid.uuid4())
    exit_code, stdout, timed_out = run(claude_argv(env, session_id, render_prompt(items)), env, cwd, timeout)
    result = parse_result(stdout)
    return SessionResult(
        session_id=session_id, exit_code=exit_code, timed_out=timed_out,
        turns=int(result.get("num_turns") or 0), tokens=_tokens(result.get("usage") or {}),
        usd=float(result.get("total_cost_usd") or 0.0), subtype=str(result.get("subtype", "none")),
    )


def run_process(argv: Sequence[str], env: Mapping[str, str], cwd: str, timeout: float) -> tuple[int | None, str, bool]:
    try:
        done = subprocess.run(list(argv), env=dict(env), cwd=cwd, capture_output=True, text=True,
                              timeout=timeout, stdin=subprocess.DEVNULL, check=False)
    except subprocess.TimeoutExpired as expired:
        out = expired.stdout or ""
        return None, out.decode() if isinstance(out, bytes) else out, True
    return done.returncode, done.stdout, False
