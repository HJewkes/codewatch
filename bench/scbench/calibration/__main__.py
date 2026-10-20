"""python3 -I bench/scbench/calibration <command> ...

  upstream <problems dir> <out.json>            PyPI names the non-holdout reference solutions import
  select <top.json> <upstream.json> <cache> <manifest.json> [--top N] [--target N] [--jobs N]
  curves <cache> <manifest.json> <curves.json> <version>
  score <curves.json> <out.json> <root>...      band shares of trees, pooled by SLOC
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from calibration import select  # noqa: E402
from calibration.curves import QUANTILES, derive, score  # noqa: E402
from calibration.measure import measure_project  # noqa: E402

METHOD = ("Alves, Ypma & Visser 2010: entity weight = SLOC share of its system for that entity kind, "
          "systems weighted equally, lower weighted quantile")


def cmd_curves(args) -> int:
    manifest = json.loads(Path(args.manifest).read_text())
    systems = [json.loads((Path(args.cache) / "raw" / f"{p['project']}.json").read_text())
               for p in manifest["projects"]]
    curves = {"version": args.version, "language": "python", "quantiles": list(QUANTILES), "method": METHOD,
              "corpus": {"projects": len(systems), "sloc": sum(s["sloc"] for s in systems),
                         "manifest": Path(args.manifest).name},
              "families": derive(systems)}
    Path(args.out).write_text(json.dumps(curves, indent=2) + "\n")
    return 0


def cmd_score(args) -> int:
    families = json.loads(Path(args.curves).read_text())["families"]
    systems = [measure_project(Path(root)) for root in args.roots]
    pooled = {kind: [r for s in systems for r in s[kind]] for kind in ("units", "classes", "modules")}
    out = {"trees": len(systems), "sloc": sum(s["sloc"] for s in systems), "pooled": score(pooled, families)}
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out["pooled"], indent=1))
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="calibration")
    sub = p.add_subparsers(dest="command", required=True)
    up = sub.add_parser("upstream")
    up.add_argument("problems")
    up.add_argument("out")
    sel = sub.add_parser("select")
    for name in ("top", "upstream", "cache", "manifest"):
        sel.add_argument(name)
    sel.add_argument("--top", dest="limit", type=int, default=300)
    sel.add_argument("--target", type=int, default=80)
    sel.add_argument("--jobs", type=int, default=6)
    cur = sub.add_parser("curves")
    for name in ("cache", "manifest", "out", "version"):
        cur.add_argument(name)
    sc = sub.add_parser("score")
    sc.add_argument("curves")
    sc.add_argument("out")
    sc.add_argument("roots", nargs="+")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    commands = {"upstream": select.cmd_upstream, "select": select.cmd_select, "curves": cmd_curves,
                "score": cmd_score}
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
