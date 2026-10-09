"""The review prompt, and the checks on the model's reply.

The reply cites one spec line by number and copies its text. The citation counts only
when that line exists and contains the copied text; otherwise `spec_line` is dropped
and `citation` says so. The copied text is never passed on, and spec lines the model
repeats in its reason are replaced, so no spec text reaches `stages.json`.
"""

from __future__ import annotations

import json
import re

FIX, EXPECTED_OUTPUT = "fix", "expected-output"
VERDICTS = ("ok", "conflict")
SPEC_MARK = "<spec>"
MIN_REDACTED_LINE = 12

SYSTEM_PROMPT = (
    "You review one commit to a repository against the specification it implements. "
    "You have no tools. Use only the material in the prompt and invent nothing."
)

QUESTIONS = {
    FIX: """\
Does this commit change behaviour that the specification defines?
A commit that renames, moves or restructures code, or adds tests, without changing what the \
program does for any input the specification covers, is ok.
A commit that changes output, errors, accepted input or any other behaviour the \
specification defines is a conflict. Cite the line that defines the behaviour it changes.""",
    EXPECTED_OUTPUT: """\
The diff below shows only this commit's changes to expected outputs: snapshot or golden \
files, and edited test assertions.
Does the specification require each of these changes?
Answer ok only if specification lines require every change, and cite one of them.
Answer conflict if any change is not required by the specification, and cite the line that \
defines the behaviour the old expectation checked.""",
}

REPLY_FORMAT = """\
Reply with one JSON object and nothing else:
{"verdict": "ok" or "conflict", "spec_line": the number of the specification line you rely \
on, or null if none applies, "spec_quote": that line's text copied exactly, \
"reason": one sentence}"""


class ReplyError(ValueError):
    pass


def numbered(lines: list[str]) -> str:
    return "\n".join(f"{n:>4}| {line}" for n, line in enumerate(lines, start=1))


def build_prompt(mode: str, spec: list[str], notes: str, diff: str) -> str:
    sections = [
        QUESTIONS[mode],
        REPLY_FORMAT,
        "Specification (line numbers on the left):\n" + numbered(spec),
        "The repository's notes (NOTES.md):\n" + (notes.strip() or "(none)"),
        "Commit diff:\n" + diff,
    ]
    return "\n\n".join(sections) + "\n"


def parse_reply(text: str) -> dict:
    """The first `{` to the last `}` of the reply, as a JSON object with a known verdict."""
    start, end = text.find("{"), text.rfind("}")
    try:
        reply = json.loads(text[start:end + 1]) if 0 <= start < end else None
    except json.JSONDecodeError as error:
        raise ReplyError(f"reply is not JSON: {error}") from error
    if not isinstance(reply, dict) or reply.get("verdict") not in VERDICTS:
        raise ReplyError(f"reply has no ok or conflict verdict: {text[:200]!r}")
    return reply


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def check_citation(reply: dict, spec: list[str]) -> tuple[int | None, str]:
    """(spec_line, "verified" | "failed" | "none") for the reply's citation."""
    line = reply.get("spec_line")
    if line is None:
        return None, "none"
    try:
        number = int(line)
    except (TypeError, ValueError):
        return None, "failed"
    quote = _squash(str(reply.get("spec_quote") or ""))
    if not 1 <= number <= len(spec) or not quote or quote not in _squash(spec[number - 1]):
        return None, "failed"
    return number, "verified"


def redact(text: str, spec: list[str]) -> str:
    lines = sorted({s.strip() for s in spec if len(s.strip()) >= MIN_REDACTED_LINE}, key=len, reverse=True)
    for line in lines:
        text = text.replace(line, SPEC_MARK)
    return text


def review_record(reply: dict, spec: list[str]) -> dict:
    spec_line, citation = check_citation(reply, spec)
    return {"verdict": reply["verdict"], "spec_line": spec_line,
            "reason": redact(str(reply.get("reason") or ""), spec), "citation": citation}
