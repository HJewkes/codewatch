"""metrics.py <audited workspace>: size, test, complexity and finding metrics as one JSON object.

`audited` says whether the codewatch audit left its graph.db; the cognitive numbers do not need it.
"""
import ast
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from calibration.cognitive import cognitive  # noqa: E402
from scan import walk_defs  # noqa: E402

ws = Path(sys.argv[1])
SKIP = {".venv", "venv", ".codewatch", ".git", "__pycache__", ".evaluation_tests"}


def py_files():
    for p in sorted(ws.rglob("*.py")):
        if not SKIP.intersection(p.relative_to(ws).parts):
            yield p


def is_test(p):
    rel = p.relative_to(ws)
    return rel.parts[0] in ("tests", "test") or rel.name.startswith("test_") or rel.name == "conftest.py"


def lines(p):
    return sum(1 for l in p.read_text(errors="replace").splitlines() if l.strip() and not l.strip().startswith("#"))


def cognitive_values(paths):
    """scb-check's cognitive complexity of every function it finds in the files."""
    out = []
    for p in paths:
        try:
            tree = ast.parse(p.read_text(errors="replace"))
        except (SyntaxError, ValueError):
            continue
        out.extend(cognitive(fn) for _, fn in walk_defs(tree, ""))
    return out


def test_count(p):
    tree = ast.parse(p.read_text(errors="replace"))
    return sum(1 for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test"))


src = [p for p in py_files() if not is_test(p)]
tests = [p for p in py_files() if is_test(p)]
src_loc, test_loc = sum(map(lines, src)), sum(map(lines, tests))
out = {"src_loc": src_loc, "test_loc": test_loc, "test_fns": sum(map(test_count, tests)),
       "test_files": len(tests), "test_src_ratio": round(test_loc / max(src_loc, 1), 2)}

cog = cognitive_values(src)
out.update(audited=(ws / ".codewatch" / "graph.db").is_file(),
           cog_max=max(cog, default=0), cog_mean=round(sum(cog) / max(len(cog), 1), 2), src_symbols=len(cog),
           cog_over_15=sum(1 for v in cog if v > 15))

findings = ws / ".codewatch" / "audit" / "findings.jsonl"
if findings.is_file():
    rows = [json.loads(l) for l in findings.read_text().splitlines() if l.strip()]
    sig = collections.Counter(r.get("signal") for r in rows)
    out.update(findings=len(rows), single_caller=sig.get("symbol-single-caller-helper", 0),
               clones=sig.get("clone", 0), top_signals=dict(sig.most_common(8)))
print(json.dumps(out))
