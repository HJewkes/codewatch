"""table_c241.py <runs dir>: the C-241 §2b table, one markdown row per run (regrade.json + gates.json + result.json)."""

import json
import sys
from pathlib import Path

HEADER = ("| run | hidden | eros-xT | verb-xT | eros (official) | cog max / mean | single-caller | src lines Δ (+/-) "
          "| cc total | t:src | gates | $ | wall |")


def arrow(pair: list, fmt: str = "{:g}") -> str:
    a, b = pair
    return fmt.format(a) if a == b else f"{fmt.format(a)} → {fmt.format(b)}"


def row(run: Path) -> str:
    g = json.loads((run / "gates.json").read_text())
    r = json.loads((run / "regrade.json").read_text())
    res = json.loads((run / "result.json").read_text() or "{}")
    b, a = r["before"], r["after"]
    hidden = f"{a['hidden']['passed']}/{a['hidden']['total']}"
    m = lambda k: f"{b[k]:.3f} → {a[k]:.3f}"
    failed =[k for k, ok in g["gates"].items() if not ok]
    cog = f"{arrow(g['cog_max'])} / {arrow(g['cog_mean'])}"
    cost = res.get("total_cost_usd")
    wall = json.loads((run / "run.json").read_text())["wall_s"]
    return (f"| {run.name} | {hidden} | {m('erosion_ex_tests')} | {m('verbosity_ex_tests')} | {m('erosion')} | {cog} "
            f"| {arrow(g['single_caller'])} | {g['src_net']:+d} (+{g['src_added']}/-{g['src_removed']}) "
            f"| {arrow(g['cc_total'])} | {arrow(g['test_src'])} | {'pass' if not failed else 'FAIL ' + ','.join(failed)} "
            f"| {cost:.2f} | {wall / 60:.1f} min |")


def main(runs_dir: str) -> int:
    print(HEADER)
    print("|" + "---|" * (HEADER.count("|") - 1))
    for run in sorted(Path(runs_dir).iterdir()):
        if (run / "gates.json").is_file():
            print(row(run))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
