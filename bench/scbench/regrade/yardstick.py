"""Evaluation-only reference yardstick; never used by codewatch agent stages."""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from analysis.inputs import CHECKPOINT_DIR, SCB_CHECK_VERSION
from regrade import holdout
from regrade.yardstick_metrics import METRICS, ScoreFailed, score
from regrade.yardstick_report import render
from regrade.yardstick_seeds import compare, freeze


def checkpoints(catalog):
    result = []
    for problem in sorted(catalog.iterdir()):
        if problem.is_dir():
            for path in (problem / "solutions").glob("checkpoint_*"):
                match = CHECKPOINT_DIR.fullmatch(path.name)
                if path.is_dir() and match:
                    result.append((problem.name, int(match[1]), path))
    return sorted(result, key=lambda r: (r[0], r[1]))


class Aggregate:
    def __init__(self):
        self.count = 0
        self.sums = dict.fromkeys(METRICS, 0)

    def add(self, row):
        self.count += 1
        for key in METRICS:
            self.sums[key] += row[key]

    def result(self):
        return {"checkpoints": self.count,
                "mean": {k: v / self.count if self.count else None for k, v in self.sums.items()}}


def evaluate(item, seeds, scratch, scorer):
    problem, checkpoint, path = item
    try:
        reference = scorer(path, scratch)
    except ScoreFailed:
        return {"problem": problem, "checkpoint": checkpoint, "status": "scoring_failed"}
    seed = seeds / problem / f"checkpoint_{checkpoint}"
    seed_status, seed_score = "missing", None
    if (seed / "snapshot").is_dir():
        try:
            seed_score, seed_status = scorer(seed, scratch), "ok"
        except ScoreFailed:
            seed_status = "scoring_failed"
    return {"problem": problem, "checkpoint": checkpoint, "reference": reference,
            "seed": seed_score, "seed_status": seed_status, "status": "ok"}


def collect(items, held, seeds, scratch, workers=2, scorer=score):
    if any(item[0] in held for item in items):
        raise holdout.HoldoutRefused("sealed checkpoints cannot enter the yardstick")
    groups = {name: Aggregate() for name in
              ("reference_dev", "matched_reference", "a1a_seed")}
    rows, failures = [], 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = pool.map(lambda item: evaluate(item, seeds, scratch, scorer), items)
        for row in results:
            if row["status"] != "ok":
                failures += 1
            else:
                groups["reference_dev"].add(row["reference"])
                failures += int(row["seed_status"] == "scoring_failed")
                if row["seed"] is not None:
                    groups["matched_reference"].add(row["reference"])
                    groups["a1a_seed"].add(row["seed"])
            rows.append(row)
    return {"rows": rows, "aggregates": {k: v.result() for k, v in groups.items()},
            "failures": failures}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--catalog", type=Path, default=Path.home() / ".cache/scbench/problems")
    p.add_argument("--seeds", type=Path, default=Path.home() / ".local/share/codewatch-scbench/seeds/c209-a1a")
    p.add_argument("--suite-seeds", type=Path, default=Path.home() / ".local/share/codewatch-scbench/seeds/c209-suite")
    p.add_argument("--scratch", type=Path, default=Path.home() / ".cache/scbench-yardstick")
    p.add_argument("--workers", type=int, choices=range(1, 5), default=2)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    return p


def run(args, scorer=score):
    held = holdout.holdout_problems()
    items = checkpoints(args.catalog)
    refused = {row[0] for row in items if row[0] in held}
    for problem in refused:
        try:
            holdout.check([problem])
        except holdout.HoldoutRefused:
            continue
        raise ScoreFailed("unexpected holdout authorization")
    refused_checkpoints = sum(row[0] in held for row in items)
    items = [r for r in items if r[0] not in held]
    suite = freeze(args.suite_seeds, held)
    args.scratch.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = collect(items, held, args.seeds, args.scratch, args.workers, scorer)
    result["suite"] = compare(result, suite, args.scratch, args.workers, scorer)
    result["failures"] += result["suite"]["failures"]
    result.update(scb_check_version=SCB_CHECK_VERSION, split="dev",
                  catalog_problems=len({r[0] for r in items}), requested_checkpoints=len(items),
                  refused_problems=len(refused), refused_checkpoints=refused_checkpoints,
                  elapsed_seconds=round(time.monotonic() - started, 3),
                  board={"GPT 5.5": {"erosion": .494, "verbosity": .269},
                         "Claude (approximate)": {"erosion": .74, "verbosity": .32}})
    payload = json.dumps(result, indent=2) + "\n"
    markdown = render(result)
    if any(name in payload or name in markdown for name in held):
        raise ScoreFailed("sealed identity detected; refusing output")
    for path, text in ((args.out, payload), (args.report, markdown)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return result


def main(argv=None):
    try:
        result = run(parser().parse_args(argv))
    except holdout.HoldoutRefused:
        print("yardstick: sealed scoring requires an approved milestone; no output written", file=sys.stderr)
        return holdout.REFUSED_EXIT
    except (ScoreFailed, OSError, ValueError):
        print("yardstick: evaluation failed; identifying details withheld", file=sys.stderr)
        return 1
    print(f"yardstick: {result['requested_checkpoints']} checkpoints; {result['failures']} failures")
    return int(result["failures"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
