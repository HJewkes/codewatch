"""The one model call that writes the review rubric, and its prompt."""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass

MAX_RUBRIC_WORDS = 300
MAX_PROMPT_VERDICTS = 60
DEFAULT_MODEL = "claude-sonnet-5-5"
LISTED_VERDICTS = ("confirmed", "justified")

SYSTEM_PROMPT = (
    "You write short review notes for the next coding session on a repository. "
    "You have no tools. Use only the material in the prompt and invent nothing."
)

INSTRUCTIONS = """\
Below are code review verdicts on this repository's latest changes, the rule violations that \
are new since the previous snapshot, and the changed symbols that the most files import.
A confirmed verdict marks a real problem. A justified verdict marks code that looks unusual \
but is right for this repository, so do not ask for it to change.

Write at most 250 words of plain Markdown in exactly three parts:
Themes: the recurring problems, in one to three sentences.
Fix first: the order in which to address the confirmed problems, naming files.
House style: the conventions this repository keeps, as the justified verdicts show them."""


@dataclass(frozen=True)
class ModelReply:
    text: str
    tokens: int
    usd: float


Model = Callable[[str], ModelReply]


def _verdict_line(row: dict) -> str:
    citation = (row.get("citations") or [{}])[0]
    where = f"{row.get('path', '')}:{citation.get('lineStart', '')}".rstrip(":")
    return f"- {row.get('verdict')} {row.get('signal')} {where}: {row.get('rationale', '')}"


def build_prompt(verdicts: list[dict], violations: list[dict], symbols: list[dict]) -> str:
    listed = sorted((r for r in verdicts if r.get("verdict") in LISTED_VERDICTS),
                    key=lambda r: LISTED_VERDICTS.index(r["verdict"]))[:MAX_PROMPT_VERDICTS]
    sections = [
        INSTRUCTIONS,
        "Verdicts:\n" + ("\n".join(_verdict_line(r) for r in listed) or "- none"),
        "New rule violations:\n" + ("\n".join(
            f"- {v.get('ruleId')} {v.get('path') or v.get('nodeId')}: {v.get('evidence') or v.get('message')}"
            for v in violations) or "- none"),
        "Changed symbols with the most importing files:\n" + ("\n".join(
            f"- {s['symbol']} ({s['importers']})" for s in symbols) or "- none"),
    ]
    return "\n\n".join(sections) + "\n"


def cap_words(text: str, limit: int = MAX_RUBRIC_WORDS) -> str:
    """The text cut after its `limit`-th word, keeping the line breaks before it."""
    kept: list[str] = []
    remaining = limit
    for line in text.strip().splitlines():
        words = line.split()
        if remaining <= 0:
            break
        kept.append(" ".join(words[:remaining]) if len(words) > remaining else line.rstrip())
        remaining -= len(words)
    return "\n".join(kept).strip() + "\n"


# Claude Code's built-in tools. `--disallowedTools` is the flag the pinned runner itself passes
# to CC 2.0.51, so it is known to parse there; an unknown name in the list is ignored.
BUILT_IN_TOOLS = ("Task", "Bash", "BashOutput", "KillShell", "Glob", "Grep", "Read", "Edit", "Write",
                  "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite", "ExitPlanMode", "SlashCommand", "Skill")


def claude_argv(model: str) -> list[str]:
    return ["claude", "-p", "--model", model, "--output-format", "json", "--max-turns", "1",
            "--disallowedTools", ",".join(BUILT_IN_TOOLS),
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
            "--system-prompt", SYSTEM_PROMPT]


def call_claude(prompt: str) -> ModelReply:
    """One headless `claude -p` turn with built-in tools disallowed, no MCP servers and no settings (so no hooks)."""
    model = os.environ.get("CW_SYNTHESIS_MODEL", DEFAULT_MODEL)
    done = subprocess.run(claude_argv(model), input=prompt, capture_output=True, text=True, timeout=300)
    reply = json.loads(done.stdout)
    if done.returncode != 0 or reply.get("is_error"):
        raise RuntimeError(f"claude exited {done.returncode}: {str(reply.get('result'))[:200]}")
    usage = reply.get("usage") or {}
    tokens = sum(int(usage.get(key) or 0) for key in (
        "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    return ModelReply(text=str(reply.get("result") or ""), tokens=tokens,
                      usd=float(reply.get("total_cost_usd") or 0.0))
