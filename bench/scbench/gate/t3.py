"""T3: a reviewer settles the middle band, a change that T1 and P5 pass but that breaks a constraint.

C-229 slice 2's contract: the reviewer gets the constraint evidence and the touched code, and answers one
JSON object; the reply is schema-checked, with one retry that names the schema error. It fails closed: a
model error or a second invalid reply HOLDS the task as `review-unavailable`, never passes it.
The model is any `str -> ModelReply`; `call_reviewer` is the default, a headless no-tools `claude -p`
turn with no MCP servers and no settings (synthesis/taste.py).
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable

from synthesis.taste import DEFAULT_MODEL, ModelReply, call_claude_no_tools

Model = Callable[[str], ModelReply]
VERDICTS = ("accept", "reject")
HOLD = "review-unavailable"

SYSTEM_PROMPT = ("You review one refactoring change for structural quality. You have no tools. "
                 "Use only the material in the prompt and invent nothing.")

QUESTION = """\
A refactoring passed its tests and its complexity checks, but a structural check found the findings \
listed below in the code it changed. For each finding, decide whether it is a real new degradation \
(state shared through a mutable parameter or module, a new flag parameter, a forwarding wrapper, an \
unused name, hidden dynamic calls, a class split badly) or acceptable here (for example a library's \
in-place idiom, or an accumulator the function exists to fill).
Answer reject if any finding is a real degradation, else accept."""

REPLY_FORMAT = """\
Reply with one JSON object and nothing else:
{"verdict": "accept" or "reject", "findings": [{"id": the finding's number, "real": true or false}, \
one entry per finding], "reason": one sentence}"""


class ReplyError(ValueError):
    pass


def findings(report: dict) -> list[str]:
    return [f"{kind}: {item}" for kind, items in sorted(report["constraints"].items()) for item in items]


def build_prompt(report: dict, code: str, error: str | None = None) -> str:
    listed = "\n".join(f"{n}. {f}" for n, f in enumerate(findings(report), start=1))
    retry = [f"Your previous reply was rejected: {error}. Answer again in the exact format."] if error else []
    return "\n\n".join([QUESTION, REPLY_FORMAT, *retry, "Findings:\n" + listed, "Changed code (after):\n" + code]) + "\n"


def parse_reply(text: str, count: int) -> dict:
    """The first `{` to the last `}`, checked against the reply schema."""
    start, end = text.find("{"), text.rfind("}")
    if not 0 <= start < end:
        raise ReplyError("not JSON (no object)")
    try:
        reply = json.loads(text[start:end + 1])
    except json.JSONDecodeError as error:
        raise ReplyError(f"not JSON ({error.msg})") from error
    if not isinstance(reply, dict) or reply.get("verdict") not in VERDICTS:
        raise ReplyError("no accept or reject verdict")
    items = reply.get("findings")
    if not isinstance(items, list) or not all(isinstance(i, dict) and isinstance(i.get("real"), bool) for i in items):
        raise ReplyError("findings is not a list of {id, real}")
    if sorted(i.get("id") for i in items) != list(range(1, count + 1)):
        raise ReplyError(f"findings must answer ids 1..{count} once each")
    if not isinstance(reply.get("reason"), str) or not reply["reason"].strip():
        raise ReplyError("no reason")
    if (reply["verdict"] == "reject") != any(i["real"] for i in items):
        raise ReplyError("verdict disagrees with the findings")
    return reply


def review(report: dict, code: str, model: Model) -> dict:
    """{outcome: accept | reject | review-unavailable, attempts, tokens, usd, reason}."""
    count, error, spent = len(findings(report)), None, {"tokens": 0, "usd": 0.0}
    for attempt in (1, 2):
        try:
            reply = model(build_prompt(report, code, error))
        except Exception as failure:  # noqa: BLE001 - any model failure holds the task (fail closed)
            return {"outcome": HOLD, "attempts": attempt, **spent, "reason": f"reviewer error: {failure}"[:300]}
        spent = {"tokens": spent["tokens"] + reply.tokens, "usd": round(spent["usd"] + reply.usd, 6)}
        try:
            parsed = parse_reply(reply.text, count)
        except ReplyError as invalid:
            error = str(invalid)
            continue
        return {"outcome": parsed["verdict"], "attempts": attempt, **spent, "reason": parsed["reason"],
                "real": [n["id"] for n in parsed["findings"] if n["real"]]}
    return {"outcome": HOLD, "attempts": 2, **spent, "reason": f"invalid reply twice: {error}"}


def call_reviewer(prompt: str) -> ModelReply:
    return call_claude_no_tools(prompt, os.environ.get("CW_GATE_REVIEW_MODEL", DEFAULT_MODEL), SYSTEM_PROMPT)
