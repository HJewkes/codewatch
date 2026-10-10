"""The PR report: a `codewatch-pr-report@1`-shaped summary of the ratchet, and its markdown form.

The shape follows titan-platform's `scripts/codewatch-report.mjs`: check, deltas and at
most 3 questions. Exports are left empty: this report reads only the check and diff
output, not the symbol layer.
"""

from __future__ import annotations

SCHEMA_ID = "codewatch-pr-report@1"
DELTA_LIMIT = 20
QUESTION_LIMIT = 3
QUESTION_MAX_CHARS = 200
NEAR_BUDGET_RATIO = 0.8
NEW_FILE_LOC = 250
# The indexer's file-level metric name to the report's metric name.
REPORT_METRIC = {"loc": "loc", "cyclomatic_max": "cyclomatic_max", "cognitive_max": "cognitive",
                 "max_nesting_depth": "max_nesting_depth"}


def pr_report(check: dict | None, diff: dict | None, rules: list[dict]) -> dict:
    """The report for one PR; with no check it reports none, with no diff it has no deltas."""
    snapshot = (check or {}).get("snapshot") or (diff or {}).get("to") or {}
    baseline = (check or {}).get("baselineSnapshot") or (diff or {}).get("from") or {}
    report = {
        "schema": SCHEMA_ID,
        "head": snapshot.get("commitHash"),
        "base": baseline.get("commitHash"),
        "indexVersion": snapshot.get("indexVersion"),
        "check": _check_block((check or {}).get("result")),
        "deltas": _deltas(((diff or {}).get("diff") or {}).get("metricDeltas") or [], _budgets(rules)),
        "exports": [],
    }
    return {**report, "deltas": report["deltas"][:DELTA_LIMIT], "questions": _questions(report)}


def _check_block(result: dict | None) -> dict | None:
    if not result:
        return None
    return {
        "passed": result.get("passed"),
        "newErrors": result.get("newErrors", 0),
        "newWarnings": result.get("newWarnings", 0),
        "carryover": (result.get("carryoverErrors") or 0) + (result.get("carryoverWarnings") or 0),
        "violations": [
            {"ruleId": v.get("ruleId"), "severity": v.get("severity"), "nodeId": v.get("nodeId"),
             "path": v.get("path") or v.get("nodeId"), "line": v.get("lineStart"), "message": v.get("message"),
             "isCarryover": v.get("isCarryover") is True}
            for v in result.get("violations") or [] if isinstance(v, dict)
        ],
    }


def _budgets(rules: list[dict]) -> dict[str, float]:
    return {REPORT_METRIC[r["metric"]]: r["max"] for r in rules
            if r.get("type") == "metric-max" and r.get("kind") == "file" and r.get("metric") in REPORT_METRIC}


def _deltas(metric_deltas: list[dict], budgets: dict[str, float]) -> list[dict]:
    rows = []
    for change in metric_deltas:
        metric = REPORT_METRIC.get(change.get("name"))
        if metric is None or change.get("after") is None:
            continue
        budget = budgets.get(metric)
        status = _delta_status(metric, change.get("before"), change["after"], budget)
        if status:
            rows.append({"path": change.get("nodeId"), "symbol": None, "metric": metric,
                         "before": change.get("before"), "after": change["after"], "budget": budget,
                         "status": status})
    return sorted(rows, key=lambda d: (-_budget_share(d), d["path"] or "", d["metric"]))


def _budget_share(delta: dict) -> float:
    return delta["after"] / delta["budget"] if delta["budget"] else 0


def _delta_status(metric: str, before: float | None, after: float, budget: float | None) -> str | None:
    def near(value: float | None) -> bool:
        return budget is not None and value is not None and value >= budget * NEAR_BUDGET_RATIO

    if near(after) and not near(before):
        return "near-budget"
    if before is None:
        return "new" if metric == "loc" and after > NEW_FILE_LOC else None
    return "worsened" if after > before else None


def _questions(report: dict) -> list[str]:
    """New violations, then deltas that are not merely worse: titan-platform's fixed order."""
    violations = (report["check"] or {}).get("violations") or []
    fresh = sorted((v for v in violations if not v["isCarryover"]),
                   key=lambda v: (v["path"] or "", v["line"] or 0, v["ruleId"] or ""))
    candidates = [
        *(f"{v['path']}:{v['line'] or 1} breaks {v['ruleId']} (new {v['severity']}): "
          "does this belong here, or should the code move?" for v in fresh),
        *(_delta_question(d) for d in report["deltas"] if d["status"] != "worsened"),
    ]
    return [_clip(q) for q in candidates[:QUESTION_LIMIT]]


def _delta_question(d: dict) -> str:
    if d["status"] == "new":
        return f"{d['path']}:1 is a new {d['after']}-line file: does it hold one responsibility, or should it start split?"
    was = "" if d["before"] is None else f", was {d['before']}"
    return f"{d['path']}:1 {d['metric']} is {d['after']} against a budget of {d['budget']}{was}: should it be split before it crosses?"


def _clip(text: str) -> str:
    return text if len(text) <= QUESTION_MAX_CHARS else f"{text[:QUESTION_MAX_CHARS - 1]}…"


def _short(sha: str | None) -> str:
    return sha[:12] if sha else "none"


def render_markdown(report: dict) -> str:
    """The report as markdown, as titan-platform's `codewatch-summary.mjs` renders it."""
    check = report["check"]
    lines = ["## codewatch report", ""]
    if check is None:
        lines.append("No check ran.")
    else:
        verdict = "passed" if check["passed"] else "failed"
        lines.append(f"Check {verdict}: {check['newErrors']} new error(s), {check['newWarnings']} new warning(s), "
                     f"{check['carryover']} carryover.")
    lines += [f"Head `{_short(report['head'])}` against base `{_short(report['base'])}`.",
              f"{len(report['deltas'])} metric delta(s), {len(report['exports'])} export change(s)."]
    if report["questions"]:
        lines += ["", "### Questions", "", *(f"- {q}" for q in report["questions"])]
    return "\n".join(lines) + "\n"
