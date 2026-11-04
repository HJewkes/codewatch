"""C-280 S4: the mutation probe. Measure only; it feeds nothing back to the agent.

For each audit unit (the R-none node ids of one test or one parametrized function) it
mutates the entry-module lines the unit reaches (`mutants.sample`), then:

1. runs the unit alone against the mutant: a failure is a kill;
2. only for a kill, runs the kept tests that reach that line: if they pass, the
   kill is unique (the unit caught what the kept suite misses);
3. for a mutant the unit does not kill, runs the full R-none suite: if that passes too, the
   mutant is listed as possibly equivalent.

Pre-registered rule (plan §1.4), computed in `rule_verdict` and never tuned here: S1 may gate
if (a) >= 60% of the units S1 admits have >= 1 unique kill and (b) >= 60% of the units with
>= 1 unique kill are ones S1 admits.

    python3 -m c280.probe UNITS.json CACHE OUT.json [--workers N]
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import resource
import shutil
import signal
import subprocess
import time
from collections.abc import Callable, Iterable
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from pathlib import Path

from .mutants import Mutant, apply, sample, sites
from .resume import RUN_SECONDS, finished, record, wait_for_load

SEED = 280
TIMEOUT_S = 120
MEMORY_CAP = 6 * 2**30
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
    reach: Callable[[list[str]], set[int]]
    covering: Callable[[int], list[str]]
    seed: int = SEED
    full_cache: dict[str, bool] = field(default_factory=dict)

    def full_killed(self, mutant: Mutant, source: str) -> bool:
        if mutant.key not in self.full_cache:
            self.full_cache[mutant.key] = self.full_run(["tests"], source)
        return self.full_cache[mutant.key]


def probe_unit(unit: str, targets: list[str], ctx: Context, candidates: Iterable[Mutant] | None = None) -> dict:
    """`mutants`, `kills`, `unique_kills` and the possibly-equivalent mutants of one unit.

    A unit is one test or a function's parametrized cases: `targets` are its pytest node ids.
    """
    pool = sites(ctx.source) if candidates is None else candidates
    drawn = sample(pool, ctx.reach(targets), f"{ctx.seed}:{unit}")
    kills, unique, equivalent = 0, [], []
    for mutant in drawn:
        source = apply(ctx.source, mutant)
        if ctx.unit_run(targets, source):
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
            code = run_group(self.command(targets), self.tree, self.env)
        finally:
            self.entry.write_text(self.original)
        if code == 5:
            raise RuntimeError(f"no tests collected for {targets} in {self.tree}")
        return code != 0


def cap_memory() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_CAP, MEMORY_CAP))


def run_group(command: list[str], cwd: Path, env: dict[str, str]) -> int:
    """The exit code; a timeout (or memory blow-up) is a failure, and the whole process group dies."""
    with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          start_new_session=True, preexec_fn=cap_memory) as proc:
        try:
            return proc.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            return 1
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


def shebang_python(coverage: str) -> str:
    return Path(coverage).read_text().splitlines()[0].removeprefix("#!").strip()


def coverage_report(tree: Path, scratch: Path, env: dict[str, str], targets: list[str]) -> dict:
    """Line coverage of one pytest run; subprocess-driven tests count (`patch = subprocess`)."""
    shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    rc = scratch / "coveragerc"
    rc.write_text(f"[run]\nbranch = true\ndata_file = {scratch / '.coverage'}\nparallel = true\npatch = subprocess\n")
    run = [COVERAGE, "run", f"--rcfile={rc}", "-m", "pytest", "-q", "-p", "no:cacheprovider", *targets]
    subprocess.run(run, cwd=tree, env=env, capture_output=True, check=False)
    subprocess.run([COVERAGE, "combine", f"--rcfile={rc}", "-q"], cwd=tree, env=env, capture_output=True, check=False)
    out = scratch / "coverage.json"
    subprocess.run([COVERAGE, "json", f"--rcfile={rc}", "-o", str(out)], cwd=tree, env=env,
                   capture_output=True, check=True)
    return json.loads(out.read_text())


def reached_lines(report: dict, entry: str) -> set[int]:
    return set(report["files"].get(entry, {}).get("executed_lines", []))


def collect_nodes(tree: Path, python: str, env: dict[str, str]) -> list[str]:
    done = subprocess.run([python, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", "tests"],
                          cwd=tree, env=env, capture_output=True, text=True, check=True)
    return [line for line in done.stdout.splitlines() if "::" in line]


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

    def reach(nodes: list[str]) -> set[int]:
        return reached_lines(coverage_report(unit.tree, work / "reach", unit.env, nodes), entry)

    return Context(unit.original, unit, runners["kept"], unit, reach, lambda line: covering.get(line, []))


def work_one(task: tuple[str, str, list[str], str, dict[int, list[str]]]) -> dict:
    bench, unit, targets, cache, covering = task
    if bench not in _STATE:
        _STATE[bench] = build_context(bench, Path(cache), covering)
    ctx = _STATE[bench]
    started = time.monotonic()
    if ctx.unit_run(targets, None):
        return {"unit": unit, "bench": bench, "baseline_failed": True, "mutants": 0, "kills": 0,
                "unique_kills": 0, "unique_keys": [], "possibly_equivalent": []}
    return {**probe_unit(unit, targets, ctx), "bench": bench, "seconds": round(time.monotonic() - started, 1)}


def load_units(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    return data["units"] if isinstance(data, dict) else data


def node_reach(args: tuple[Path, Path, dict[str, str], str, str]) -> tuple[str, set[int]]:
    tree, scratch, env, entry, node = args
    return node, reached_lines(coverage_report(tree, scratch, env, [node]), entry)


def kept_covering(cache: Path, bench: str, workers: int) -> dict[int, list[str]]:
    """Per entry line, the kept tests (one coverage run each) that reach it."""
    from findings.diff_uncovered import agent_test_env

    tree = cache / "ctx" / "R-test+helpers+per-case" / bench / "tree"
    scratch = cache / "c280" / "kept-reach" / bench
    env = agent_test_env(tree, scratch / "hook")
    nodes = collect_nodes(tree, shebang_python(COVERAGE), env)
    jobs = [(tree, scratch / f"n{i}", env, f"{bench}.py", node) for i, node in enumerate(nodes)]
    covering: dict[int, list[str]] = {}
    with ThreadPoolExecutor(workers) as pool:
        for node, lines in pool.map(node_reach, jobs):
            for line in lines:
                covering.setdefault(line, []).append(node)
    return covering


def summarize(rows: list[dict], wall: float) -> dict:
    equivalent = [{"unit": r["unit"], "bench": r["bench"], "mutant": key}
                  for r in rows for key in r["possibly_equivalent"]]
    return {"wall_seconds": round(wall, 1), "seed": SEED, "possibly_equivalent_count": len(equivalent),
            "possibly_equivalent": equivalent, "units": rows}


def pending(units: list[dict], partial: Path) -> tuple[list[dict], float]:
    done, spent = finished(partial)
    return [u for u in units if u["id"] not in done], spent


def run_pending(todo: list[dict], cache: Path, covering: dict, workers: int, partial: Path) -> None:
    """Submits one unit at a time per worker, waiting out machine load before each, and records as units finish."""
    queue = iter(todo)
    with ProcessPoolExecutor(workers) as pool:
        running = {}

        def submit() -> None:
            unit = next(queue, None)
            if unit is not None:
                wait_for_load()
                task = (unit["bench"], unit["id"], unit["nodeids"], str(cache), covering[unit["bench"]])
                running[pool.submit(work_one, task)] = unit

        for _ in range(workers):
            submit()
        while running:
            for future in wait(running, return_when=FIRST_COMPLETED).done:
                unit = running.pop(future)
                row = future.result()
                row.update({k: v for k, v in unit.items() if k not in row and k != "nodeids"})
                record(partial, row)
                submit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("units", type=Path)
    parser.add_argument("cache", type=Path, help="the c264 cache root, holding ctx/<arm>/<bench>/tree")
    parser.add_argument("out", type=Path)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args(argv)
    partial = args.out.with_suffix(".partial.jsonl")
    started = time.monotonic()
    units = load_units(args.units)
    todo, _ = pending(units, partial)
    wait_for_load()
    covering = {bench: kept_covering(args.cache, bench, args.workers) for bench in sorted({u["bench"] for u in todo})}
    run_pending(todo, args.cache, covering, args.workers, partial)
    record(partial, {RUN_SECONDS: round(time.monotonic() - started, 1)})
    done, spent = finished(partial)
    rows = [done[u["id"]] for u in units]
    args.out.write_text(json.dumps(summarize(rows, spent), indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
