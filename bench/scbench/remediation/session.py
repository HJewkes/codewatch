"""The fix session: one claude CLI session that takes one item per call.

The first call starts the session under a fresh `--session-id`; each later item, and a
review conflict, resumes it with `--resume`. It uses the solve's binary, model,
permission mode and credential env, which the stage agent passes in. Its traces land in
the same `~/.claude` as the solve's; `stages.json` records the session id, so the
transcript audit and the analysis can tell the two apart.

There is no turn cap by default; `max_turns` is opt-in. The prompts name only the
workspace, its tests and the confirmed items, never the grader, its tool or its metrics
(design section 3).
"""

from __future__ import annotations

import contextlib
import json
import stat
import subprocess
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .items import Item

Run = Callable[[Sequence[str], Mapping[str, str], str, float | None], tuple[int | None, str, bool]]

PROMPT_HEAD = """\
A review of this workspace confirmed some items to fix. I will send them one at a time.
Each gives the question the reviewer answered, the answer, the evidence and a one-line
sketch of the fix. After each item, stop; I check the change before sending the next.

Rules:
- Keep every test under tests/ passing. Run the tests before you stop.
- Do not change what the program prints, returns or writes, unless an item says to.
- Do not edit anything under .codewatch/.
- Do not install packages; there is no network.
"""

PHASE_RULES = {
    1: "Add or strengthen tests only, under tests/; change no other file. The tests must pass on "
       "the current code. Use pytest-regressions or syrupy only if already installed; otherwise "
       "write golden files under tests/ and compare with plain asserts.",
    2: "Keep the behaviour the same; the full test suite must stay green.",
    3: "Keep the behaviour the same; the full test suite must stay green.",
}


@dataclass(frozen=True)
class CallResult:
    exit_code: int | None
    timed_out: bool
    subtype: str


@dataclass
class FixSession:
    env: Mapping[str, str]
    cwd: str
    run: Run
    max_turns: int | None = None
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started: bool = False
    turns: int = 0
    tokens: int = 0
    usd: float = 0.0

    def ask(self, prompt: str, timeout: float | None) -> CallResult:
        argv = claude_argv(self.env, self.session_id, prompt, resume=self.started, max_turns=self.max_turns)
        try:
            exit_code, stdout, timed_out = self.run(argv, self.env, self.cwd, timeout)
        finally:
            restore_claude_access(self.env)
        self.started = True
        result = parse_result(stdout)
        self.session_id = str(result.get("session_id") or self.session_id)
        self.turns += int(result.get("num_turns") or 0)
        self.tokens += _tokens(result.get("usage") or {})
        self.usd += float(result.get("total_cost_usd") or 0.0)
        return CallResult(exit_code, timed_out, str(result.get("subtype", "none")))


def render_item(index: int, item: Item, feedback: str = "") -> str:
    target = f"{item.path} ({item.symbol})" if item.symbol else item.path
    lines = [
        *([feedback, ""] if feedback else []),
        f"Item {index} [{'test gap' if item.phase == 1 else item.kind}] {target}",
        f"Question: {item.question}",
        f"Answer: {item.verdict}. {item.rationale}".rstrip(),
        f"Evidence: {', '.join(item.citations) or 'none'}",
        f"Fix: {item.fix}",
        f"Rule for this item: {PHASE_RULES[item.phase]}",
    ]
    return "\n".join(lines)


def first_prompt(item_text: str) -> str:
    return f"{PROMPT_HEAD}\n{item_text}\n"


def conflict_prompt(reason: str, spec_line: str | None) -> str:
    where = f" (specification line {spec_line})" if spec_line else ""
    return (f"A review of your last change found that it conflicts with the intended behaviour{where}: "
            f"{reason}\nRevise the change so the intended behaviour holds, then stop.")


def claude_argv(env: Mapping[str, str], session_id: str, prompt: str, resume: bool,
                max_turns: int | None = None) -> list[str]:
    argv = [env.get("CW_CLAUDE_BINARY", "claude"), "--output-format", "stream-json", "--verbose"]
    if env.get("CW_MODEL"):
        argv += ["--model", env["CW_MODEL"]]
    if max_turns is not None:
        argv += ["--max-turns", str(max_turns)]
    if env.get("CW_PERMISSION_MODE"):
        argv += ["--permission-mode", env["CW_PERMISSION_MODE"]]
    argv += ["--resume" if resume else "--session-id", session_id]
    return argv + ["--print", "--", prompt]


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


def restore_claude_access(env: Mapping[str, str]) -> None:
    """Gives the owner read and write access to ~/.claude again, as the stock agent's exit trap does."""
    if not env.get("HOME"):
        return
    for root, dirs, files in Path(env["HOME"], ".claude").walk():
        for name in dirs:
            _add_mode(root / name, stat.S_IRWXU)
        for name in files:
            _add_mode(root / name, stat.S_IRUSR | stat.S_IWUSR)


def _add_mode(path: Path, bits: int) -> None:
    with contextlib.suppress(OSError):
        if not path.is_symlink():
            path.chmod(path.stat().st_mode | bits)


def run_process(argv: Sequence[str], env: Mapping[str, str], cwd: str,
                timeout: float | None) -> tuple[int | None, str, bool]:
    try:
        done = subprocess.run(list(argv), env=dict(env), cwd=cwd, capture_output=True, text=True,
                              timeout=timeout, stdin=subprocess.DEVNULL, check=False)
    except subprocess.TimeoutExpired as expired:
        out = expired.stdout or ""
        return None, out.decode() if isinstance(out, bytes) else out, True
    return done.returncode, done.stdout, False
