"""python -m solvenext run|parity: the C-250 (plan doc "C-249" E2) frozen-tree solve-next harness.

`run` solves cp N+1 from a copy of a frozen tree, evaluates it, and writes run.json. `--dry-run`
prints the command plan and output paths and writes nothing. `parity` reads every run.json under
a dir and writes parity.json and parity.md. Both refuse holdout problems (C-243) first.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from regrade import holdout

from solvenext import parity, plan, record

SHARE = Path.home() / ".local" / "share" / "codewatch-scbench"
EXPERIMENTS = SHARE / "experiments"


def _env_path(name: str, default: Path) -> Path:
    return Path(os.environ[name]) if os.environ.get(name) else default


def seeds_root() -> Path:
    return _env_path("SCBENCH_SEEDS", SHARE / "seeds")


def problems_root() -> Path:
    return _env_path("SCBENCH_PROBLEMS", Path.home() / ".cache" / "scbench" / "problems")


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="solvenext")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="solve cp N+1 from a frozen tree, then evaluate it")
    run.add_argument("problem")
    run.add_argument("n", type=int)
    run.add_argument("tree", type=Path, help="a seed checkpoint_N dir (uses its snapshot/) or a tree")
    run.add_argument("--seed-set", required=True, help="the seed set the tree comes from, e.g. c209-a1a")
    run.add_argument("--seed-cp", type=Path, help="the seed checkpoint_N dir with the recorded rates "
                     "(default: the tree, when it is a seed checkpoint dir)")
    run.add_argument("--arm", default=parity.PARITY_ARM)
    run.add_argument("--replicate", type=int, default=1)
    run.add_argument("--out", type=Path)
    run.add_argument("--image", default=plan.DEFAULT_IMAGE)
    run.add_argument("--task", default="C-250")
    run.add_argument("--dry-run", action="store_true")
    par = sub.add_parser("parity", help="write the parity table for the runs under a dir")
    par.add_argument("runs", type=Path)
    par.add_argument("--out", type=Path)
    return parser.parse_args(argv)


def default_out(args: argparse.Namespace, today: str) -> Path:
    name = f"{args.problem}-cp{args.n + 1}-r{args.replicate}"
    return EXPERIMENTS / f"c250-solvenext-{today}" / args.arm / name


def harness_pins() -> dict:
    def git(*argv: str) -> str:
        return subprocess.run(["git", "-C", str(plan.BENCH), *argv], capture_output=True, text=True,
                              check=False).stdout.strip()

    return {"harness_commit": git("rev-parse", "HEAD") or "unknown", "harness_dirty": bool(git("status", "--porcelain"))}


def run_pins(p: plan.Plan, seed_set: str) -> dict:
    return {**harness_pins(), "scb_check_version": record.SCB_CHECK_VERSION, "slop_code_commit": record.SLOP_CODE_COMMIT,
            "model_id": p.model, "image": p.image, "prompt_template": plan.PROMPT_TEMPLATE.name,
            "prompt_sha256": plan.template_sha256(), "step_limit": p.step_limit, "seed_set": seed_set}


def prepare(p: plan.Plan, problem_dir: Path) -> None:
    """Copy the tree (never solve in place: seeds are read-only) and write the prompt and plan."""
    p.out.mkdir(parents=True, exist_ok=True)
    shutil.copytree(plan.solve_source(p.tree), p.workspace, symlinks=True)
    spec = (problem_dir / f"checkpoint_{p.next_cp}.md").read_text()
    (p.out / "prompt.md").write_text(plan.render_prompt(spec, p.entry_file))
    (p.out / "plan.txt").write_text(plan.describe(p) + "\n")
    # Rootless Docker maps the container's root to a subuid, as in new_arm.sh.
    subprocess.run(["chmod", "-R", "a+rwX", str(p.out)], check=True)


def solve_and_eval(p: plan.Plan, runner=subprocess.run) -> dict:
    token = Path(os.path.expandvars(plan.TOKEN_FILE)).read_text().strip()
    env = {**os.environ, "DOCKER_HOST": plan.DOCKER_HOST, "CLAUDE_CODE_OAUTH_TOKEN": token}
    start = time.time()
    with open(p.out / "stdout.jsonl", "w") as out, open(p.out / "stderr.log", "w") as err:
        code = runner(plan.solve_command(p), stdout=out, stderr=err, env=env).returncode
    cost = record.solve_cost(p.out / "stdout.jsonl", code, int(time.time() - start))
    runner(plan.eval_command(p), env={**os.environ, "DOCKER_HOST": plan.DOCKER_HOST})
    return cost


def rates(p: plan.Plan, seed_cp: Path | None) -> dict:
    before = record.recorded_rate(seed_cp / "evaluation.json") if seed_cp else None
    recorded_next = record.recorded_rate(seed_cp.parent / f"checkpoint_{p.next_cp}" / "evaluation.json") if seed_cp else None
    return {"before": before, "after": record.eval_rate(p.out / "eval" / "summary.json"), "recorded_next": recorded_next}


def resolve_seed_cp(args: argparse.Namespace) -> Path | None:
    if args.seed_cp:
        return args.seed_cp.resolve()
    return args.tree.resolve() if (args.tree / "evaluation.json").is_file() else None


def cmd_run(args: argparse.Namespace, runner=subprocess.run) -> int:
    stamp = datetime.datetime.now(datetime.UTC)
    out = args.out or default_out(args, stamp.date().isoformat())
    problem_dir = problems_root() / args.problem
    p = plan.build_plan(args.problem, args.n, args.tree, out, problem_dir, args.image)
    plan.check_paths(args.tree, out, seeds_root())
    print(plan.describe(p))
    print(f"# outputs: {p.out} (ws/, prompt.md, plan.txt, stdout.jsonl, stderr.log, eval/summary.json, run.json)")
    if args.dry_run:
        return 0
    prepare(p, problem_dir)
    cost = solve_and_eval(p, runner)
    run = record.build_run(task=args.task, arm=args.arm, replicate=args.replicate, problem=p.problem, n=p.n,
                           include_prior_tests=p.include_prior_tests, pins=run_pins(p, args.seed_set), cost=cost,
                           rates=rates(p, resolve_seed_cp(args)), created_at=stamp.isoformat(timespec="seconds"))
    (p.out / "run.json").write_text(json.dumps(run, indent=1) + "\n")
    print(json.dumps({"cost": run["cost"], "pass_rates": run["pass_rates"]}))
    return 0


def cmd_parity(args: argparse.Namespace, holdout_check) -> int:
    runs = parity.load_runs(args.runs)
    holdout_check(sorted({run["problem"] for run in runs}))
    rows, skipped = parity.parity_rows(runs)
    parity.write_parity(rows, skipped, args.out or args.runs)
    print(parity.table(rows, skipped), end="")
    return 0


def main(argv: list[str] | None = None, runner=subprocess.run, holdout_check=None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    check = holdout_check or (lambda problems: holdout.check(problems, os.environ.get(holdout.MILESTONE_ENV)))
    try:
        if args.command == "parity":
            return cmd_parity(args, check)
        check([args.problem])
        return cmd_run(args, runner)
    except holdout.HoldoutRefused as refusal:
        print(f"holdout guard: {refusal}", file=sys.stderr)
        return holdout.REFUSED_EXIT
    except plan.PlanError as error:
        print(f"solvenext: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
