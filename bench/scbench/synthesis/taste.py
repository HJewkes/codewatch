"""The one model call that writes a taste fragment, its prompt, and the provenance tags."""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass

MAX_FRAGMENT_WORDS = 300
MAX_PROMPT_VERDICTS = 60
DEFAULT_MODEL = "claude-sonnet-5-5"
LISTED_VERDICTS = ("confirmed", "justified")

SYSTEM_PROMPT = (
    "You write short convention notes for the next coding session on a repository. "
    "You have no tools. Use only the material in the prompt and invent nothing."
)

INSTRUCTIONS = """\
Below are numbered code review verdicts on this pull request's changes, the rule violations \
it adds against its merge-base, the changed symbols that the most files import, and the \
conventions already recorded for this repository.
A confirmed verdict marks a real problem. A justified verdict marks code that looks unusual \
but is right for this repository, so do not ask for it to change.

Write at most 12 Markdown bullet lines, and nothing else. Each line states one convention \
this repository keeps, or one problem not to repeat, naming files where it helps. Do not \
repeat a recorded convention. End each line with the number of the verdict it rests on in \
square brackets, such as [3]. A line without a listed number is dropped."""

_CITED_LINE = re.compile(r"^\s*[-*]\s+(?P<text>.+?)\s*\[(?P<n>\d+)\]\s*\.?\s*$")


@dataclass(frozen=True)
class ModelReply:
    text: str
    tokens: int
    usd: float


Model = Callable[[str], ModelReply]


def listed_verdicts(verdicts: list[dict]) -> list[dict]:
    """The verdicts the prompt numbers from 1: confirmed, then justified, each with a finding key."""
    keyed = (r for r in verdicts if r.get("verdict") in LISTED_VERDICTS and isinstance(r.get("key"), str))
    return sorted(keyed, key=lambda r: LISTED_VERDICTS.index(r["verdict"]))[:MAX_PROMPT_VERDICTS]


def _verdict_line(n: int, row: dict) -> str:
    citation = (row.get("citations") or [{}])[0]
    where = f"{row.get('path', '')}:{citation.get('lineStart', '')}".rstrip(":")
    return f"[{n}] {row.get('verdict')} {row.get('signal')} {where}: {row.get('rationale', '')}"


def build_prompt(listed: list[dict], violations: list[dict], symbols: list[dict], recorded: list[str]) -> str:
    sections = [
        INSTRUCTIONS,
        "Verdicts:\n" + ("\n".join(_verdict_line(n, r) for n, r in enumerate(listed, 1)) or "- none"),
        "New rule violations:\n" + ("\n".join(
            f"- {v.get('ruleId')} {v.get('path') or v.get('nodeId')}: {v.get('evidence') or v.get('message')}"
            for v in violations) or "- none"),
        "Changed symbols with the most importing files:\n" + ("\n".join(
            f"- {s['symbol']} ({s['importers']})" for s in symbols) or "- none"),
        "Recorded conventions:\n" + ("\n".join(recorded) or "- none"),
    ]
    return "\n\n".join(sections) + "\n"


def tagged_lines(reply: str, listed: list[dict], checkpoint: int) -> list[str]:
    """Each reply line that cites a listed verdict, its number replaced by the provenance tag."""
    lines = []
    for raw in reply.splitlines():
        match = _CITED_LINE.match(raw)
        n = int(match["n"]) if match else 0
        if 1 <= n <= len(listed):
            lines.append(f"- {match['text']} {{inferred cp{checkpoint} fp:{listed[n - 1]['key']}}}")
    return lines


def cap_lines(lines: list[str], limit: int = MAX_FRAGMENT_WORDS) -> list[str]:
    """The leading whole lines whose words, tags included, fit in `limit`: a tag is never cut off."""
    kept: list[str] = []
    remaining = limit
    for line in lines:
        words = len(line.split())
        if words > remaining:
            break
        kept.append(line)
        remaining -= words
    return kept


# Claude Code's built-in tools. `--disallowedTools` is the flag the pinned runner itself passes
# to CC 2.0.51, so it is known to parse there; an unknown name in the list is ignored.
BUILT_IN_TOOLS = ("Task", "Bash", "BashOutput", "KillShell", "Glob", "Grep", "Read", "Edit", "Write",
                  "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite", "ExitPlanMode", "SlashCommand", "Skill")


def claude_argv(model: str, system_prompt: str = SYSTEM_PROMPT) -> list[str]:
    return ["claude", "-p", "--model", model, "--output-format", "json", "--max-turns", "1",
            "--disallowedTools", ",".join(BUILT_IN_TOOLS),
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
            "--system-prompt", system_prompt]


def call_claude(prompt: str) -> ModelReply:
    return call_claude_no_tools(prompt, os.environ.get("CW_SYNTHESIS_MODEL", DEFAULT_MODEL), SYSTEM_PROMPT)


def call_claude_no_tools(prompt: str, model: str, system_prompt: str) -> ModelReply:
    """One headless `claude -p` turn with built-in tools disallowed, no MCP servers and no settings (so no hooks)."""
    done = subprocess.run(claude_argv(model, system_prompt), input=prompt, capture_output=True, text=True,
                          timeout=300, check=False)
    reply = json.loads(done.stdout)
    if done.returncode != 0 or reply.get("is_error"):
        raise RuntimeError(f"claude exited {done.returncode}: {str(reply.get('result'))[:200]}")
    usage = reply.get("usage") or {}
    tokens = sum(int(usage.get(key) or 0) for key in (
        "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    return ModelReply(text=str(reply.get("result") or ""), tokens=tokens,
                      usd=float(reply.get("total_cost_usd") or 0.0))
