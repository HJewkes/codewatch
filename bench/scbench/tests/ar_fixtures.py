"""Fixtures for the autoresearch adapter tests (C-256): a scored S7 run, a stub evaluator pin, replay lanes.

SCORED is an anonymised slice of one S7 run on a training seed: the gate numbers as recorded, the hidden
test ids and task ids replaced, nothing else kept.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from tests.gate_fixtures import BASE, COSMETIC, NARROW

BENCH = Path(__file__).resolve().parent.parent

HIDDEN_FAILED = [f"hidden/test_{i:02d}" for i in range(1, 17)]
SCORED = {
    "gates.json": {"gates": {"hidden": True, "growth": True, "helpers": False, "tests": True}, "pass": False,
                   "src_added": 16, "src_removed": 8, "src_net": 8, "cc_total": [232.0, 236.0], "single_caller": [3, 5],
                   "helpers_one_site": [3, 8], "helpers_multi_site": {"count": [0, 0], "added": []},
                   "cog_max": [34.0, 60], "cog_mean": [10.34, 10.58], "cog_over_15": [4, 7], "test_src": [1.09, 1.08],
                   "test_fns": [58, 58], "src_loc": [617, 625]},
    "regrade.json": {"before": {"hidden": {"passed": 200, "total": 216, "failed": HIDDEN_FAILED}},
                     "after": {"hidden": {"passed": 200, "total": 216, "failed": HIDDEN_FAILED}}},
    "result.json": {"total_cost_usd": 0.447034},
}
LEDGER = ([{"kind": "task", "outcome": "skip", "kept": False, "wave": 1}] * 2
          + [{"kind": "task", "outcome": "accept", "kept": True, "wave": 1, "new": []}] * 4
          + [{"kind": "task", "outcome": "skip", "kept": False, "wave": w} for w in (1, 2)])


def write_json(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) + "\n")
    return path


def write_ledger(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def write_scored_run(run: Path) -> Path:
    for name, data in SCORED.items():
        write_json(run / name, data)
    write_ledger(run / "cleanup" / "ledger.jsonl", LEDGER)
    return run


TRACE = 'printf "%s %s\\n" {stage} "{path}" >>"$AR_TRACE"\n'
PY_TRACE = ("import json, os, sys\nfrom pathlib import Path\n"
            "open(os.environ['AR_TRACE'], 'a').write('{stage} ' + str(Path(__file__).resolve()) + '\\n')\n")
FIXTURE_ENV = "AR_FIXTURE"


# The runner's lane trees run_s7.sh prunes unless --keep-lanes, and what it always keeps (relative to cleanup/).
LANE_TREES = ["base", "wave2/app.py__f/ws", "wave2/integration/all/tree", "wave2/app.py__f/a1/visible-ws"]
KEPT = ["wave2/app.py__f/a1/diffgate", "wave2/app.py__f/gate"]


def _stub_runner(root: Path) -> None:
    (root / "runner").mkdir(parents=True)
    (root / "runner" / "__init__.py").write_text("")
    (root / "runner" / "__main__.py").write_text(PY_TRACE.format(stage="runner") + (
        f"LANE_TREES, KEPT = {LANE_TREES!r}, {KEPT!r}\n"
        "out = Path(sys.argv[sys.argv.index('--out') + 1]); out.mkdir(parents=True, exist_ok=True)\n"
        "(out / 'run.json').write_text(json.dumps({'usd': 0.25, 'waves': []}))\n"
        "for tree in LANE_TREES + KEPT:\n    (out / tree).mkdir(parents=True, exist_ok=True)\n"
        "fixture = Path(os.environ['AR_FIXTURE'])\n"
        "(out / 'ledger.jsonl').write_text((fixture / 'cleanup' / 'ledger.jsonl').read_text())\n"))


def _stub_harness(harness: Path) -> None:
    harness.mkdir(parents=True)
    (harness / "measure.sh").write_text(TRACE.format(stage="measure", path="$0") + 'mkdir -p "$2"\n')
    (harness / "diffgate.sh").write_text(TRACE.format(stage="diffgate", path="$0")
                                         + 'mkdir -p "$5"; echo \'{"pass": true}\' >"$5/gate.json"\n')
    (harness / "gates.py").write_text(PY_TRACE.format(stage="gates") + (
        "src = Path(os.environ['AR_FIXTURE'], 'gates.json').read_text()\n"
        "Path(sys.argv[4], 'gates.json').write_text(src); print(src.replace(chr(10), ''))\n"))
    (harness / "cleanup_report.py").write_text(PY_TRACE.format(stage="cleanup_report")
                                               + "Path(sys.argv[sys.argv.index('--json') + 1]).write_text('{}')\n")


def stub_pin(root: Path) -> Path:
    """A pin checkout's bench: the real run_s7.sh, ar_eval.sh, score.py and holdout guard; every stage it
    calls is a stub that records its own path in $AR_TRACE and writes the $AR_FIXTURE run's numbers."""
    bench = root / "bench" / "scbench"
    _stub_harness(bench / "c239" / "harness")
    shutil.copy2(BENCH / "c239" / "harness" / "run_s7.sh", bench / "c239" / "harness")
    (bench / "regrade").mkdir()
    shutil.copy2(BENCH / "regrade" / "holdout.py", bench / "regrade")
    (bench / "regrade" / "__init__.py").write_text("")
    (bench / "regrade" / "__main__.py").write_text(PY_TRACE.format(stage="regrade") + (
        "def main():\n    out = Path(sys.argv[sys.argv.index('--out') + 1])\n"
        "    out.write_text(Path(os.environ['AR_FIXTURE'], 'regrade.json').read_text())\n    return 0\n"))
    (bench / "autoresearch").mkdir()
    for name in ("ar_eval.sh", "score.py"):
        shutil.copy2(BENCH / "autoresearch" / name, bench / "autoresearch")
    _stub_runner(bench)
    return bench


def stub_idea(root: Path) -> Path:
    bench = root / "bench" / "scbench"
    _stub_runner(bench)
    return bench


def stub_inputs(root: Path, case: str, case_set: str, problem: str) -> dict[str, str]:
    """S7_INPUTS with one prepped case, and a HOME whose holdout manifest seals nothing; -> the env."""
    inputs, home = root / "c246", root / "home"
    write_json(inputs / "prep" / f"{case}.json", {"set": case_set, "problem": problem, "key": case, "n": 1})
    (inputs / "frozen" / case_set / f"{problem}_cp1").mkdir(parents=True)
    (inputs / "frozen" / case_set / f"{problem}_cp1" / "app.py").write_text("x = 1\n")
    write_json(home / ".cache" / "codewatch-scbench" / "manifest.json", {"holdout": {"problems": {}}})
    return {"S7_INPUTS": str(inputs), "HOME": str(home)}


def _tree(root: Path, app: str, other: str) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "app.py").write_text(app)
    (root / "other.py").write_text(other)
    return root


def _other(source: str) -> str:
    return source.replace("def handle(", "def handle_b(").replace("_size_label", "_size_label_b")


PLAN = {"tasks": [{"id": "app.py:handle", "owned": [{"key": "app.py:handle"}], "chosen": None},
                  {"id": "other.py:handle_b", "owned": [{"key": "other.py:handle_b"}], "chosen": None}]}
GREEN_DIFFGATE = {"pass": True, "differences": []}
# The ledger's `wave` is the planner's: the runner's wave 2 is the planner's wave 1, so both rows say 1.
LEDGER_BY_RUNNER_WAVE = [
    {"kind": "task", "cluster": "app.py:handle", "run": "k", "outcome": "accept", "kept": True, "wave": 1,
     "new": ["app.py:_size_label"]},
    {"kind": "task", "cluster": "app.py:handle", "run": "k", "outcome": "reject", "kept": False, "wave": 1, "new": []}]
# run.json records absolute paths from the host that ran it
RECORDED_TREE = "/elsewhere/runs/k/cleanup/wave1/integration/all/tree"


def _lane(cleanup: Path, wave: int, task: str, head: Path, attempts: list[tuple[dict, dict]]) -> dict:
    """attempts: (visible.json, final.json) per attempt; the lane's ws is the last attempt's tree."""
    lane = cleanup / f"wave{wave}" / task.replace("/", "_").replace(":", "__")
    shutil.copytree(head, lane / "ws")
    write_json(lane / "gate" / "plan.json", PLAN)
    for n, (visible, final) in enumerate(attempts, start=1):
        write_json(lane / f"a{n}" / "visible.json", visible)
        write_json(lane / f"a{n}" / "diffgate" / "gate.json", GREEN_DIFFGATE)
        write_json(lane / f"a{n}" / "final.json", final)
    return {"task": task, "attempts": [{"n": n, "outcome": f["outcome"]} for n, (_, f) in enumerate(attempts, start=1)]}


def replay_run(run: Path, scratch: Path) -> Path:
    """A --keep-lanes run dir: wave 1 accepts one split (on its retry) and rejects a cosmetic edit; wave 2
    re-submits wave 1's tree unchanged, a reject only when judged against wave 1's tree, not the base."""
    cleanup = run / "cleanup"
    _tree(cleanup / "base", BASE, _other(BASE))
    split = _tree(scratch / "split", NARROW, _other(BASE))
    cosmetic = _tree(scratch / "cosmetic", BASE, _other(COSMETIC))
    tree1 = cleanup / "wave1" / "integration" / "all" / "tree"
    shutil.copytree(split, tree1)
    green, red = {"pass": True, "failed": []}, {"pass": False, "failed": ["tests/test_app.py::test_x"]}
    accept, reject = {"outcome": "accept", "tier": "T2"}, {"outcome": "reject", "tier": "T2"}
    wave1 = [_lane(cleanup, 1, "app.py:handle", split, [(red, {"outcome": "reject", "tier": "T1"}), (green, accept)]),
             _lane(cleanup, 1, "other.py:handle_b", cosmetic, [(green, reject)])]
    wave2 = [_lane(cleanup, 2, "app.py:handle", tree1, [(green, reject)])]
    write_json(cleanup / "run.json", {"waves": [
        {"wave": 1, "sessions": wave1, "tree": RECORDED_TREE, "rows": 1},
        {"wave": 2, "sessions": wave2, "tree": RECORDED_TREE, "rows": 1}], "final_tree": RECORDED_TREE, "usd": 0.3})
    write_ledger(cleanup / "ledger.jsonl", LEDGER_BY_RUNNER_WAVE)
    return run
