"""The per-cluster session prompt and the one retry message (C-248 S6).

The session gets every spec cp1..cpN with "earlier behaviour holds", the cluster's code, the plan
template (the chosen edits with their recipes and ONE pass condition) and C-231's line against own
harnesses, background jobs and `sleep`. `scbench gate` is its only codewatch tool; it gets no gate list.
On a reject the harness sends one deterministic message: for a diffgate failure "restore these messages
verbatim: ..." (C-246's recommendation), else the final gate's message in the self-check format.
"""

from __future__ import annotations

import json

from planner.units import module_units

MAX_RESTORE = 12
RESTORE = "restore these messages verbatim: "

HEADER = """\
You are maintaining the program in the current directory. Below are the specifications of every
checkpoint so far (1 to {n}; checkpoint {n} is the current one). Behaviour an earlier checkpoint defines
still holds unless a later checkpoint changes it.

Your task is one cleanup of one cluster of functions, described by the plan below. Make the edits it
names with the recipe it names, keep every behaviour the specifications define and keep every error
message verbatim. The plan's pass condition is the only goal.

Rules:
- Do not write your own test harnesses or helper scripts, do not start background jobs and do not use
  `sleep`. Run the existing tests with `.venv/bin/python -m pytest -q tests`.
- `scbench gate --cluster {task}` is an advisory self-check of your change against the plan. It is the
  only codewatch tool you have; it allows at most 3 calls.
- Edit only the functions the plan lists as owned, and place new functions where the plan says.
  Do not commit.
"""


def unit_source(text: str, rel: str, key: str) -> str:
    unit = next(u for u in module_units(rel, text)[1] if u.key == key)
    node = unit.node
    first = min([node.lineno] + [d.lineno for d in node.decorator_list])
    lines = text.splitlines()[first - 1:node.end_lineno]
    return f"# {key}  (lines {first}-{node.end_lineno})\n" + "\n".join(lines)


def cluster_code(texts: dict[str, str], task: dict) -> str:
    keys = [r["key"] for r in task["owned"]]
    return "\n\n".join(unit_source(texts[k.split(":", 1)[0]], k.split(":", 1)[0], k) for k in keys)


def build(task: dict, specs: list[str], texts: dict[str, str]) -> str:
    n = len(specs)
    parts = [HEADER.format(n=n, task=task["id"]), "## Plan\n\n" + task["template"],
             "## The cluster's code\n\n```python\n" + cluster_code(texts, task) + "\n```"]
    parts += [f"## Specification, checkpoint {k}\n\n{spec}" for k, spec in enumerate(specs, start=1)]
    return "\n\n".join(p.rstrip("\n") for p in parts) + "\n"


def retry_section(message: str) -> str:
    return ("\n## Your previous change was rejected\n\nThe change you made is still in the workspace. "
            "Fix it with this one message in mind, and change nothing else:\n\n" + message.rstrip("\n") + "\n")


def lost_messages(diffgate: dict) -> list[str]:
    """Base output lines a differing case no longer prints, in case order, without repeats."""
    out: list[str] = []
    for item in diffgate.get("differences", []):
        if item.get("status") != "differs":
            continue
        for field in ("stderr", "stdout"):
            head = set(str((item.get("head") or {}).get(field, "")).splitlines())
            out += [line for line in str((item.get("base") or {}).get(field, "")).splitlines()
                    if line.strip() and line not in head and line not in out]
    return out[:MAX_RESTORE]


def restore_message(diffgate: dict) -> str:
    lines = lost_messages(diffgate)
    if lines:
        return RESTORE + "; ".join(json.dumps(line, ensure_ascii=False) for line in lines)
    cases = [i["case"] for i in diffgate.get("differences", []) if i.get("status") == "differs"]
    return f"behaviour differs from the base in {len(cases)} cases: restore the base behaviour of " + ", ".join(cases[:5])


def retry_message(result: dict, diffgate: dict, reinline: list[str]) -> str:
    """The one deterministic message for a rejected attempt."""
    if not diffgate.get("pass", True):
        return restore_message(diffgate)
    if reinline:
        return "FAIL: " + "; ".join(reinline)
    return result.get("retry_message") or "FAIL: " + "; ".join(result.get("reasons", []))

