"""gates.py <pre meas dir> <post meas dir> <regrade.json> <run dir>: the C-241 gates, checked mechanically.

Gates (C-238 forensics, stated to the implementer as hard rules):
  hidden   no hidden test that passed before fails after (must-not-regress guardrail)
  growth   non-test source net growth <= 10 lines or <= 25% of removed lines, unless total cyclomatic falls
  helpers  single-caller helpers called from one site do not go up. A single-caller helper called
           from 2+ sites inside its one caller (C-246: s-execution_server's _timeout and _flag) is
           neither a pass nor a fail: it is counted and named under helpers_multi_site.
  tests    test:source <= 2.0 and <= 2x the pre-run ratio
Writes <run dir>/gates.json and prints one JSON line.
"""

import ast
import difflib
import json
import sqlite3
import sys
from pathlib import Path

SKIP = {".venv", "venv", ".codewatch", ".git", "__pycache__", ".evaluation_tests"}
MAX_NET, MAX_GROWTH, MAX_RATIO, MAX_RATIO_GROWTH = 10, 0.25, 2.0, 2.0


def is_test(rel: Path) -> bool:
    return rel.parts[0] in ("tests", "test") or rel.name.startswith("test_") or rel.name == "conftest.py"


def code_lines(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return [l.strip() for l in path.read_text(errors="replace").splitlines() if l.strip() and not l.strip().startswith("#")]


def source_files(root: Path) -> set[Path]:
    return {p.relative_to(root) for p in root.rglob("*.py")
            if not SKIP.intersection(p.relative_to(root).parts) and not is_test(p.relative_to(root))}


def source_diff(before: Path, after: Path) -> tuple[int, int]:
    added = removed = 0
    for rel in sorted(source_files(before) | source_files(after)):
        for line in difflib.ndiff(code_lines(before / rel), code_lines(after / rel)):
            added += line.startswith("+ ")
            removed += line.startswith("- ")
    return added, removed


def total_cyclomatic(db: Path) -> float:
    c = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    rows = c.execute("select node_id, value from metric where name = 'symbol_cyclomatic' "
                     "and snapshot_id = (select max(id) from snapshot)").fetchall()
    return sum(v for nid, v in rows if "#" in nid and not is_test(Path(nid.split("#", 1)[0])))


def _call_name(node: ast.Call) -> str | None:
    func = node.func
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None


def call_sites(root: Path) -> dict[str, dict[str, int]]:
    """Called name -> {calling function -> call count}, over the non-test source.

    Names match by spelling only, so a collision (another `get`) adds callers and can only move a
    helper back under the gate, never out of it."""
    sites: dict[str, dict[str, int]] = {}
    for rel in source_files(root):
        try:
            tree = ast.parse((root / rel).read_text(errors="replace"))
        except SyntaxError:
            continue
        for fn in (n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and (name := _call_name(node)):
                    callers = sites.setdefault(name, {})
                    callers[f"{rel}:{fn.lineno}"] = callers.get(f"{rel}:{fn.lineno}", 0) + 1
    return sites


def is_multi_site(callers: dict[str, int]) -> bool:
    return len(callers) == 1 and next(iter(callers.values())) >= 2


def single_caller_helpers(ws: Path) -> dict[str, list[str]]:
    """Split the single-caller helper findings into one-site and multi-site (2+ calls in the one caller)."""
    findings = ws / ".codewatch" / "audit" / "findings.jsonl"
    rows = [json.loads(l) for l in findings.read_text().splitlines() if l.strip()] if findings.is_file() else []
    sites = call_sites(ws)
    split: dict[str, list[str]] = {"one_site": [], "multi_site": []}
    for row in rows:
        if row.get("signal") == "symbol-single-caller-helper":
            kind = "multi_site" if is_multi_site(sites.get(row["symbol"], {})) else "one_site"
            split[kind].append(f"{row['path']}#{row['symbol']}")
    return {kind: sorted(names) for kind, names in split.items()}


def hidden_gate(regrade: dict) -> bool:
    before, after = regrade["before"]["hidden"], regrade["after"]["hidden"]
    return after["passed"] >= before["passed"] and set(after["failed"]) <= set(before["failed"])


def main(pre_dir: str, post_dir: str, regrade_file: str, run_dir: str) -> int:
    pre, post = Path(pre_dir), Path(post_dir)
    m0, m1 = (json.loads((d / "metrics.json").read_text()) for d in (pre, post))
    regrade = json.loads(Path(regrade_file).read_text())
    added, removed = source_diff(pre / "ws", post / "ws")
    net = added - removed
    cc0, cc1 = (total_cyclomatic(d / "ws" / ".codewatch" / "graph.db") for d in (pre, post))
    h0, h1 = (single_caller_helpers(d / "ws") for d in (pre, post))
    gates = {
        "hidden": hidden_gate(regrade),
        "growth": net <= MAX_NET or net <= MAX_GROWTH * removed or cc1 < cc0,
        "helpers": len(h1["one_site"]) <= len(h0["one_site"]),
        "tests": m1["test_src_ratio"] <= MAX_RATIO and m1["test_src_ratio"] <= MAX_RATIO_GROWTH * max(m0["test_src_ratio"], 0.01),
    }
    out = {"gates": gates, "pass": all(gates.values()), "src_added": added, "src_removed": removed, "src_net": net,
           "cc_total": [cc0, cc1], "single_caller": [m0.get("single_caller"), m1.get("single_caller")],
           "helpers_one_site": [len(h0["one_site"]), len(h1["one_site"])],
           "helpers_multi_site": {"count": [len(h0["multi_site"]), len(h1["multi_site"])],
                                  "added": sorted(set(h1["multi_site"]) - set(h0["multi_site"]))},
           "cog_max": [m0.get("cog_max"), m1.get("cog_max")], "cog_mean": [m0.get("cog_mean"), m1.get("cog_mean")],
           "cog_over_15": [m0.get("cog_over_15"), m1.get("cog_over_15")],
           "test_src": [m0["test_src_ratio"], m1["test_src_ratio"]], "test_fns": [m0["test_fns"], m1["test_fns"]],
           "src_loc": [m0["src_loc"], m1["src_loc"]]}
    Path(run_dir, "gates.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:5]))
