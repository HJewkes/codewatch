"""python3 -m gate.preflight --events stdout.jsonl --model M --max-output-tokens N: the run preflight (C-232).

Reads back what a cleanup session actually ran with, from its stream-json events, and fails on a mismatch
with what the run asked for:
  model       the first result event's `modelUsage` has the expected model
  output cap  that model's `maxOutputTokens` equals the expected cap (missing counts as a mismatch: a cap
              that cannot be read back is not known to hold)
  tools       the init event lists no MCP server and no `mcp__` tool: the cleanup session ships none
Exit 0 and {"pass": true}, or exit 1 with every problem.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def events(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            out.append(item)
    return out


def _tools(init: dict | None) -> list[str]:
    if init is None:
        return ["no init event"]
    servers = [s.get("name", s) if isinstance(s, dict) else s for s in init.get("mcp_servers") or []]
    tools = [t for t in init.get("tools") or [] if str(t).startswith("mcp__")]
    return ([f"MCP servers shipped: {servers}"] if servers else []) + ([f"MCP tools shipped: {tools}"] if tools else [])


def _limits(result: dict | None, model: str, cap: int) -> list[str]:
    if result is None:
        return ["no result event"]
    usage = result.get("modelUsage") or {}
    if model not in usage:
        return [f"model mismatch: expected {model}, ran {sorted(usage)}"]
    got = usage[model].get("maxOutputTokens")
    if got is None:
        return [f"output cap not reported for {model}"]
    return [] if got == cap else [f"output cap mismatch: expected {cap}, effective {got}"]


def preflight(stream: list[dict], model: str, cap: int) -> dict:
    init = next((e for e in stream if e.get("type") == "system" and e.get("subtype") == "init"), None)
    result = next((e for e in stream if e.get("type") == "result"), None)
    problems = _limits(result, model, cap) + _tools(init)
    return {"pass": not problems, "problems": problems}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python3 -m gate.preflight")
    p.add_argument("--events", type=Path, required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--max-output-tokens", type=int, required=True)
    a = p.parse_args(argv)
    report = preflight(events(a.events.read_text(errors="replace")), a.model, a.max_output_tokens)
    print(json.dumps(report))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
