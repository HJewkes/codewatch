"""Freeze an arm's permitted checkpoint inventory before reading its snapshots."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from analysis.inputs import CHECKPOINT_DIR
from regrade.yardstick_metrics import METRICS, ScoreFailed, score


def freeze(root, held):
    paths = {}
    for problem in sorted(root.iterdir()) if root.is_dir() else ():
        if not problem.is_dir() or problem.name in held:
            continue
        for checkpoint in problem.glob("checkpoint_*"):
            match = CHECKPOINT_DIR.fullmatch(checkpoint.name)
            if match and (checkpoint / "snapshot").is_dir():
                paths[problem.name, int(match[1])] = checkpoint
    return {"captured_at": datetime.now(timezone.utc).isoformat(), "paths": paths}


def average(rows, field):
    return {k: sum(row[field][k] for row in rows) / len(rows) if rows else None for k in METRICS}


def compare(result, inventory, scratch, workers=2, scorer=score):
    references = {(r["problem"], r["checkpoint"]): r["reference"]
                  for r in result["rows"] if r["status"] == "ok"}
    matched = [(key, path) for key, path in sorted(inventory["paths"].items()) if key in references]

    def grade(item):
        (problem, checkpoint), path = item
        row = {"problem": problem, "checkpoint": checkpoint,
               "reference": references[problem, checkpoint]}
        try:
            return {**row, "seed": scorer(path, scratch), "status": "ok"}
        except ScoreFailed:
            return {**row, "status": "scoring_failed"}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(grade, matched))
    successful = [r for r in rows if r["status"] == "ok"]
    return {"captured_at": inventory["captured_at"],
            "frozen_problems": sorted({key[0] for key in inventory["paths"]}),
            "frozen_checkpoints": len(inventory["paths"]),
            "matched_checkpoints": len(successful), "failures": len(rows) - len(successful),
            "missing_reference": len(inventory["paths"]) - len(matched), "rows": rows,
            "reference_mean": average(successful, "reference"), "seed_mean": average(successful, "seed")}
