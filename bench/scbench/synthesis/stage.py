"""Run the synthesis stage over one workspace and return its `stages.json` report line."""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path

from .inputs import Cli, changed_symbols, new_violations, open_items, read_verdicts
from .rubric import Model, build_prompt, cap_words

RUBRIC = "rubric.md"
BRIEF = "session-brief.json"


def _guarded(read: Callable[[], list[dict]], what: str) -> list[dict]:
    """A failed input reads as empty, so the rest of the stage still runs."""
    try:
        return read()
    except Exception as error:  # noqa: BLE001 - one missing input must not stop the stage
        print(f"synthesis: {what} unavailable: {type(error).__name__}: {error}", file=sys.stderr)
        return []


def run_stage(workspace: Path, cli: Cli, model: Model) -> dict:
    codewatch = workspace / ".codewatch"
    db = codewatch / "graph.db"
    verdicts = _guarded(lambda: read_verdicts(codewatch / "audit" / "verdicts.jsonl"), "verdicts")
    violations = _guarded(lambda: new_violations(cli, db, codewatch / "check.json"), "ratchet") if db.is_file() else []
    symbols = _guarded(lambda: changed_symbols(cli, db), "changed symbols") if db.is_file() else []
    items = open_items(verdicts, violations)
    codewatch.mkdir(exist_ok=True)
    (codewatch / BRIEF).write_text(json.dumps({"openItems": items, "changedSymbols": symbols}, indent=2) + "\n")
    report = {"tokens": 0, "usd": 0.0, "items_in": len(verdicts) + len(violations) + len(symbols),
              "items_out": len(items) + len(symbols)}
    if report["items_in"] == 0:
        return {**report, "outcome": "no_input"}
    try:
        reply = model(build_prompt(verdicts, violations, symbols))
    except Exception as error:  # noqa: BLE001 - reported in stages.json; the brief is already written
        print(f"synthesis: model call failed: {type(error).__name__}: {error}", file=sys.stderr)
        return {**report, "outcome": "model_failed"}
    if reply.text.strip():
        (codewatch / RUBRIC).write_text(cap_words(reply.text))
    outcome = "written" if reply.text.strip() else "empty_reply"
    return {**report, "tokens": reply.tokens, "usd": reply.usd, "outcome": outcome}
