"""targets.py <base dir> <head dir> <head graph.db>: the C-241 complexity targets, one line each.

The top source symbols by cognitive complexity (at least MIN_COGNITIVE) that the change base -> head
added or edited. If the change touched none, the top untouched ones, labelled as such.
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scan import functions

MIN_COGNITIVE = 15
TOP = 3


def symbol_metrics(db: str) -> dict[str, dict[str, float]]:
    c = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    rows = c.execute("select node_id, name, value from metric where snapshot_id = (select max(id) from snapshot) "
                     "and name in ('symbol_cognitive', 'symbol_cyclomatic', 'symbol_body_lines')").fetchall()
    out: dict[str, dict[str, float]] = {}
    for nid, name, value in rows:
        path, _, symbol = nid.partition("#")
        if symbol and not Path(path).name.startswith("test_") and not path.startswith("tests/"):
            out.setdefault(symbol, {})[name] = value
    return out


def main(base_dir: str, head_dir: str, db: str) -> int:
    base, head = functions(Path(base_dir)), functions(Path(head_dir))
    touched = {n for n, f in head.items() if n not in base or base[n].source != f.source}
    ranked = sorted(((m.get("symbol_cognitive", 0), s, m) for s, m in symbol_metrics(db).items()
                     if m.get("symbol_cognitive", 0) >= MIN_COGNITIVE), key=lambda r: -r[0])
    picked = [r for r in ranked if r[1] in touched][:TOP]
    label = "touched by this change"
    if not picked:
        picked, label = ranked[:TOP], "not touched by this change; the highest in the program"
    for cog, symbol, m in picked:
        print(f"- {symbol}: cognitive {cog:g}, cyclomatic {m.get('symbol_cyclomatic', 0):g}, "
              f"{m.get('symbol_body_lines', 0):g} body lines ({label})")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
