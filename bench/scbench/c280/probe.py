"""C-280 S4: the mutation probe. Measure only; it feeds nothing back to the agent.

For each audit unit (an R-none test node id) it mutates the entry-module lines the unit
reaches (`mutants.sample`), then:

1. runs the unit alone against the mutant: a failure is a kill;
2. only for a kill, runs the kept tests whose contexts cover that line: if they pass, the
   kill is unique (the unit caught what the kept suite misses);
3. for a mutant the unit does not kill, runs the full R-none suite: if that passes too, the
   mutant is listed as possibly equivalent.

Pre-registered rule (plan §1.4), computed in `rule_verdict` and never tuned here: S1 may gate
if (a) >= 60% of the units S1 admits have >= 1 unique kill and (b) >= 60% of the units with
>= 1 unique kill are ones S1 admits.

    python3 -m c280.probe UNITS.json UNIT_TREE KEPT_TREE OUT.json [--workers N]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .mutants import Mutant, apply, sample, sites

SEED = 280
TIMEOUT_S = 120
COVERAGE = "/opt/codewatch-a1/bin/coverage"
THRESHOLD = 0.6
Run = Callable[[list[str], str | None], bool]
"""Runs pytest targets against an entry source (None: unmodified); True means a test failed."""


@dataclass
class Context:
    source: str
    unit_run: Run
    kept_run: Run
    full_run: Run
    reach: Callable[[str], set[int]]
    covering: Callable[[int], list[str]]
    seed: int = SEED
    full_cache: dict[str, bool] = field(default_factory=dict)

    def full_killed(self, mutant: Mutant, source: str) -> bool:
        if mutant.key not in self.full_cache:
            self.full_cache[mutant.key] = self.full_run(["tests"], source)
        return self.full_cache[mutant.key]


def probe_unit(unit: str, ctx: Context, candidates: Iterable[Mutant] | None = None) -> dict:
    """`mutants`, `kills`, `unique_kills` and the possibly-equivalent mutants of one unit."""
    pool = sites(ctx.source) if candidates is None else candidates
    drawn = sample(pool, ctx.reach(unit), f"{ctx.seed}:{unit}")
    kills, unique, equivalent = 0, [], []
    for mutant in drawn:
        source = apply(ctx.source, mutant)
        if ctx.unit_run([unit], source):
            kills += 1
            covering = ctx.covering(mutant.line)
            if not (covering and ctx.kept_run(covering, source)):
                unique.append(mutant.key)
        elif not ctx.full_killed(mutant, source):
            equivalent.append(mutant.key)
    return {"unit": unit, "mutants": len(drawn), "kills": kills, "unique_kills": len(unique),
            "unique_keys": unique, "possibly_equivalent": equivalent}


def rule_verdict(rows: list[dict]) -> dict:
    """The §1.4 rule over rows carrying `unique_kills` and `admitted` (the frozen S1 verdict)."""
    admitted = [r for r in rows if r.get("admitted")]
    killers = [r for r in rows if r["unique_kills"] > 0]
    a = sum(1 for r in admitted if r["unique_kills"] > 0) / len(admitted) if admitted else 0.0
    b = sum(1 for r in killers if r.get("admitted")) / len(killers) if killers else 0.0
    return {"a": round(a, 3), "b": round(b, 3), "passes": a >= THRESHOLD and b >= THRESHOLD}


class TreeRunner:
    """Runs pytest in a private copy of a tree, swapping the entry module in place."""

    def __init__(self, tree: Path, entry: str, python: str, env: dict[str, str],
                 command: Callable[[list[str]], list[str]] | None = None):
        self.tree, self.entry, self.env = tree, tree / entry, env
        self.command = command or (lambda targets: [python, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", *targets])
        self.original = self.entry.read_text()

    def __call__(self, targets: list[str], source: str | None) -> bool:
        self.entry.write_text(self.original if source is None else source)
        try:
            done = subprocess.run(self.command(targets),
                                  cwd=self.tree, env=self.env, capture_output=True, timeout=TIMEOUT_S, check=False)
        except subprocess.TimeoutExpired:
            return True
        finally:
            self.entry.write_text(self.original)
        if done.returncode == 5:
            raise RuntimeError(f"no tests collected for {targets} in {self.tree}")
        return done.returncode != 0


def shebang_python(coverage: str) -> str:
    return Path(coverage).read_text().splitlines()[0].removeprefix("#!").strip()


def coverage_json(tree: Path, scratch: Path, python: str, env: dict[str, str], targets: list[str],
                  contexts: bool) -> dict:
    scratch.mkdir(parents=True, exist_ok=True)
    rc = scratch / "coveragerc"
    rc.write_text(f"[run]\nbranch = true\n{'dynamic_context = test_function' if contexts else ''}\n"
                  f"data_file = {scratch / '.coverage'}\n")
    run = [COVERAGE, "run", f"--rcfile={rc}", "-m", "pytest", "-q", "-p", "no:cacheprovider", *targets]
    subprocess.run(run, cwd=tree, env=env, capture_output=True, check=False)
    out = scratch / "coverage.json"
    show = ["--show-contexts"] if contexts else []
    subprocess.run([COVERAGE, "json", f"--rcfile={rc}", *show, "-o", str(out)], cwd=tree, env=env,
                   capture_output=True, check=True)
    return json.loads(out.read_text())


def reached_lines(report: dict, entry: str) -> set[int]:
    return set(report["files"].get(entry, {}).get("executed_lines", []))


def context_targets(tree: Path, report: dict, entry: str) -> dict[int, list[str]]:
    """Per entry line, the pytest targets (`file::func`) of the kept tests whose contexts cover it."""
    files = {p.stem: p.relative_to(tree).as_posix() for p in sorted((tree / "tests").rglob("*.py"))}
    covering: dict[int, set[str]] = {}
    for line, names in report["files"].get(entry, {}).get("contexts", {}).items():
        for name in filter(None, names):
            module, _, qualname = name.partition(".")
            if module in files:
                covering.setdefault(int(line), set()).add(f"{files[module]}::{qualname.replace('.', '::')}")
    return {line: sorted(found) for line, found in covering.items()}


_STATE: dict[str, Context] = {}


def build_context(bench: str, cache: Path, covering: dict[int, list[str]]) -> Context:
    """A worker's context: private copies of both trees, so mutants never race."""
    from findings.diff_uncovered import agent_test_env

    entry, python = f"{bench}.py", shebang_python(COVERAGE)
    work = cache / "c280" / "work" / f"{bench}-{os.getpid()}"
    runners = {}
    for role, arm in {"unit": "R-none", "kept": "R-test+helpers+per-case"}.items():
        copy = work / role
        if not copy.exists():
            shutil.copytree(cache / "ctx" / arm / bench / "tree", copy, symlinks=True)
        runners[role] = TreeRunner(copy, entry, python, agent_test_env(copy, work / f"{role}-scratch"))
    unit = runners["unit"]

    def reach(node: str) -> set[int]:
        return reached_lines(coverage_json(unit.tree, work / "reach", python, unit.env, [node], False), entry)

    return Context(unit.original, unit, runners["kept"], unit, reach, lambda line: covering.get(line, []))


def work_one(task: tuple[str, str, str, dict[int, list[str]]]) -> dict:
    bench, unit, cache, covering = task
    if bench not in _STATE:
        _STATE[bench] = build_context(bench, Path(cache), covering)
    ctx = _STATE[bench]
    started = time.monotonic()
    if ctx.unit_run([unit], None):
        return {"unit": unit, "bench": bench, "baseline_failed": True, "mutants": 0, "kills": 0,
                "unique_kills": 0, "unique_keys": [], "possibly_equivalent": []}
    return {**probe_unit(unit, ctx), "bench": bench, "seconds": round(time.monotonic() - started, 1)}


def load_units(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    return data["units"] if isinstance(data, dict) else data


def kept_covering(cache: Path, bench: str) -> dict[int, list[str]]:
    from findings.diff_uncovered import agent_test_env

    tree = cache / "ctx" / "R-test+helpers+per-case" / bench / "tree"
    scratch = cache / "c280" / "kept-contexts" / bench
    env = agent_test_env(tree, scratch)
    report = coverage_json(tree, scratch, shebang_python(COVERAGE), env, ["tests"], True)
    return context_targets(tree, report, f"{bench}.py")


def summarize(rows: list[dict], wall: float) -> dict:
    equivalent = [{"unit": r["unit"], "bench": r["bench"], "mutant": key}
                  for r in rows for key in r["possibly_equivalent"]]
    return {"wall_seconds": round(wall, 1), "seed": SEED, "possibly_equivalent_count": len(equivalent),
            "possibly_equivalent": equivalent, "units": rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("units", type=Path)
    parser.add_argument("cache", type=Path, help="the c264 cache root, holding ctx/<arm>/<bench>/tree")
    parser.add_argument("out", type=Path)
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args(argv)
    started = time.monotonic()
    units = load_units(args.units)
    covering = {bench: kept_covering(args.cache, bench) for bench in sorted({u["bench"] for u in units})}
    tasks = [(u["bench"], u["id"], str(args.cache), covering[u["bench"]]) for u in units]
    with ProcessPoolExecutor(args.workers) as pool:
        rows = list(pool.map(work_one, tasks))
    for unit, row in zip(units, rows, strict=True):
        row.update({k: v for k, v in unit.items() if k not in row})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summarize(rows, time.monotonic() - started), indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
