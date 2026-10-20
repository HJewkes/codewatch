"""The integration gate (C-248 S6, B8.5): splice a wave's accepted lanes, check the result, and revert
in reverse splice order on a failure.

The check (`steps.integration`: the visible tests and diffgate inloop of the spliced tree against the
wave base) runs on all spliced lanes first. On a failure each lane is left out alone, last spliced
first, and the first tree that passes is kept, so one bad lane costs only itself. When no single
revert passes, lanes are peeled off cumulatively from the end; with none left the wave keeps its base.
A lane the splice could not place is reverted as a splice conflict without a check.
"""

from __future__ import annotations

from pathlib import Path

from runner.splice import splice, tree_files, write_tree


def _check(steps, base: Path, wave_dir: Path, base_files: dict, heads: dict, keep: list[str], label: str) -> dict:
    tree = wave_dir / "integration" / label / "tree"
    write_tree(tree, splice(base_files, {k: heads[k] for k in keep})["files"])
    gate = steps.integration(base, tree, tree.parent)
    return {"label": label, "kept": list(keep), "pass": bool(gate.get("pass")), "tree": tree}


def _revert(check, order: list[str]) -> tuple[dict | None, list[dict]]:
    """The first passing check, one lane left out at a time (last first), then cumulatively."""
    tried = []
    for lane in reversed(order):
        tried.append(check([k for k in order if k != lane], f"without-{order.index(lane) + 1}"))
        if tried[-1]["pass"]:
            return tried[-1], tried
    for size in range(len(order) - 2, 0, -1):
        tried.append(check(order[:size], f"first-{size}"))
        if tried[-1]["pass"]:
            return tried[-1], tried
    return None, tried


def integrate(steps, base: Path, wave_dir: Path, accepted: dict[str, Path]) -> dict:
    """-> {tree, splice: {spliced, conflicts}, checks, reverted: {lane: reason}}; `accepted` in splice order."""
    if not accepted:
        return {"tree": base, "splice": {"spliced": [], "conflicts": {}}, "checks": [], "reverted": {}}
    base_files = tree_files(base)
    heads = {lane: tree_files(ws) for lane, ws in sorted(accepted.items())}
    first = splice(base_files, heads)
    order = first["spliced"]
    reverted = {lane: "splice conflict in " + ", ".join(files) for lane, files in first["conflicts"].items()}

    def check(keep: list[str], label: str) -> dict:
        return _check(steps, base, wave_dir, base_files, heads, keep, label)
    checks = [check(order, "all")] if order else []
    kept = checks[0] if checks and checks[0]["pass"] else None
    if checks and kept is None:
        kept, tried = _revert(check, order)
        checks += tried
    keep = kept["kept"] if kept else []
    reason = f"integration gate failed with it spliced (reverse-order revert of {len(order)} lanes)"
    reverted |= {lane: reason for lane in order if lane not in keep}
    tree = kept["tree"] if kept else base
    return {"tree": tree, "splice": {"spliced": order, "conflicts": first["conflicts"]},
            "checks": [{k: c[k] for k in ("label", "kept", "pass")} for c in checks], "reverted": reverted}
