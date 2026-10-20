"""gates.py <pre meas dir> <post meas dir> <regrade.json> <run dir>: the C-241 gates, checked mechanically.

Gates (C-238 forensics, stated to the implementer as hard rules):
  hidden   no hidden test that passed before fails after (must-not-regress guardrail)
  growth   non-test source net growth <= 10 lines or <= 25% of removed lines, unless total cyclomatic falls
  helpers  single-caller helper findings do not go up
  tests    test:source <= 2.0 and <= 2x the pre-run ratio
Writes <run dir>/gates.json and prints one JSON line.
"""

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
    gates = {
        "hidden": hidden_gate(regrade),
        "growth": net <= MAX_NET or net <= MAX_GROWTH * removed or cc1 < cc0,
        "helpers": m1.get("single_caller", 0) <= m0.get("single_caller", 0),
        "tests": m1["test_src_ratio"] <= MAX_RATIO and m1["test_src_ratio"] <= MAX_RATIO_GROWTH * max(m0["test_src_ratio"], 0.01),
    }
    out = {"gates": gates, "pass": all(gates.values()), "src_added": added, "src_removed": removed, "src_net": net,
           "cc_total": [cc0, cc1], "single_caller": [m0.get("single_caller"), m1.get("single_caller")],
           "cog_max": [m0.get("cog_max"), m1.get("cog_max")], "cog_mean": [m0.get("cog_mean"), m1.get("cog_mean")],
           "cog_over_15": [m0.get("cog_over_15"), m1.get("cog_over_15")],
           "test_src": [m0["test_src_ratio"], m1["test_src_ratio"]], "test_fns": [m0["test_fns"], m1["test_fns"]],
           "src_loc": [m0["src_loc"], m1["src_loc"]]}
    Path(run_dir, "gates.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:5]))
