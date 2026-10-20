"""The final gate (C-248 S4): T1 blocks, T2 scores, T3 settles the middle band.

  T1  always blocks: the visible tests pass, C-242 `diffgate inloop` passes, no test bloat (C-238, relative
      to base), and own-body ΔCC_total <= the new-function count. Hidden tests are scored only in eval.
  T2  the family check (family.py): P5 and ownership reject; so does gain per new function under the floor,
      which no message ever names as a number. A broken B7.3 constraint goes to T3 with its evidence (the
      bag check stays T2, Q6). B7.6's graded utilities ride along in the report for the ledger.
  T3  t3.review on the constraint evidence: accept, reject, or hold as `review-unavailable`.
The result carries the outcome, the deciding tier and, on reject, the retry message in the self-check's
format (family.render).
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

from gate import t3
from gate.family import check_trees, render
from gate.measure import sources
from planner.units import HARNESS, module_units

CODE_CAP = 12000
VALUE_MESSAGE = "the change removes too little complexity for the functions it adds"


def _harness_gates():
    spec = importlib.util.spec_from_file_location("c239_gates", HARNESS / "gates.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HARNESS_GATES = _harness_gates()


def test_ratio(root: Path) -> float:
    """test:source in non-blank, non-comment lines over the tree's .py files (c239 gates.py's rules)."""
    lines = {True: 0, False: 0}
    for path in root.rglob("*.py"):
        rel = path.relative_to(root)
        if not HARNESS_GATES.SKIP.intersection(rel.parts):
            lines[HARNESS_GATES.is_test(rel)] += len(HARNESS_GATES.code_lines(path))
    return lines[True] / (lines[False] or 1)


def test_bloat(base: Path, head: Path) -> dict:
    """Bloat: test:source past 2x the base ratio, or past 2.0 when the change raised it (C-238)."""
    before, after = test_ratio(base), test_ratio(head)
    bloated = after > HARNESS_GATES.MAX_RATIO_GROWTH * max(before, 0.01) or (after > HARNESS_GATES.MAX_RATIO and after > before)
    return {"ratio": [round(before, 3), round(after, 3)], "pass": not bloated}


def tier1(report: dict, visible: dict, diffgate: dict, bloat: dict) -> list[str]:
    out = [] if visible.get("pass") else [f"visible tests fail: {', '.join(visible.get('failed') or []) or 'see the test run'}"]
    out += [] if diffgate.get("pass") else ["diffgate inloop: behaviour differs from the base"]
    out += [] if bloat["pass"] else [f"test bloat: test:source {bloat['ratio'][0]} -> {bloat['ratio'][1]}"]
    t1 = report["t1"]
    return out + ([] if t1["pass"] else [f"T1: own ΔCC {t1['cc_added']:+d} > {t1['new_fns']} new functions"])


def tier2(report: dict) -> list[str]:
    out = [f"{f} outside tolerance" for f in report["families"]["failed"]] + report["ownership"]
    value = report["value"]
    return out + ([] if value["gain_positive"] and value["floor"] else [VALUE_MESSAGE])


def touched_code(head: dict[str, str], keys: list[str]) -> str:
    parts = []
    for rel in sorted({k.split(":", 1)[0] for k in keys}):
        units = {u.key: u for u in module_units(rel, head[rel])[1]} if rel in head else {}
        parts += [f"# {k}\n{ast.unparse(units[k].node)}" for k in keys if k in units and k.startswith(rel + ":")]
    return "\n\n".join(parts)[:CODE_CAP]


def final_gate(base: Path, head: Path, task: dict, cfg: dict, visible: dict, diffgate: dict,
               model: t3.Model = t3.call_reviewer) -> dict:
    texts = sources(head)
    report = check_trees(sources(base), texts, task, cfg)
    failed = tier1(report, visible, diffgate, test_bloat(base, head))
    tier = "T1" if failed else "T2"
    failed = failed or tier2(report)
    if failed:
        return {"outcome": "reject", "tier": tier, "reasons": failed, "report": report,
                "retry_message": render(report, cfg, "FAIL: " + "; ".join(failed))}
    if not report["constraints"]:
        return {"outcome": "accept", "tier": "T2", "reasons": [], "report": report}
    review = t3.review(report, touched_code(texts, report["touched_after"]), model)
    out = {"outcome": review["outcome"], "tier": "T3", "reasons": t3.findings(report), "report": report, "review": review}
    if review["outcome"] == "reject":
        out["retry_message"] = render(report, cfg, "FAIL: a reviewer judged a constraint finding a real degradation")
    return out
