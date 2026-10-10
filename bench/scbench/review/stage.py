"""Review one commit: gather the inputs, make the one model call, check the reply."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from synthesis.rubric import ModelReply

from .inputs import cap_diff, commit_diff, expected_output_diff, read_notes, read_spec, split_files
from .verdict import EXPECTED_OUTPUT, build_prompt, parse_reply, review_record

Model = Callable[[str], ModelReply]


@dataclass(frozen=True)
class Request:
    sha: str
    spec: Path
    workspace: Path
    mode: str
    tests_dir: str


def select_diff(request: Request) -> tuple[str, list[str]]:
    diff = commit_diff(request.sha, request.workspace)
    if request.mode == EXPECTED_OUTPUT:
        return expected_output_diff(diff, request.tests_dir)
    return diff, [path for path, _ in split_files(diff)]


def review(request: Request, model: Model) -> dict:
    """The report line: the hook reads `verdict`, `spec_line` and `reason`; the rest is for `stages.json`."""
    spec = read_spec(request.spec, request.workspace)
    diff, files = select_diff(request)
    base = {"commit": request.sha, "mode": request.mode, "files": files, "tokens": 0, "usd": 0.0}
    if not diff.strip():
        return {"verdict": "ok", "spec_line": None, "reason": f"no {request.mode} change to review",
                "citation": "none", **base}
    reply = model(build_prompt(request.mode, spec, read_notes(request.workspace), cap_diff(diff)))
    return {**review_record(parse_reply(reply.text), spec), **base, "tokens": reply.tokens, "usd": reply.usd}
