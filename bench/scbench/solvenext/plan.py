"""The solve-next plan: which tree to copy, the prompt, and the solve and eval commands.

A solve of cp N+1 starts from a frozen tree, in the new_arm.sh shape: one headless `claude -p`
session in the A1 image with the A1a arm's prompt, model and step limit, on a copy of the tree.
The runner's own `--resume` is not used; it restores the workspace from its own snapshot.
"""

from __future__ import annotations

import hashlib
import re
import shlex
from dataclasses import dataclass
from pathlib import Path

import yaml

BENCH = Path(__file__).resolve().parent.parent
HARNESS = BENCH / "c239" / "harness"
PROMPT_TEMPLATE = BENCH / "prompts" / "a1a.jinja"
MODEL_CONFIG = BENCH / "configs" / "models" / "sonnet-5.5.yaml"
AGENT_CONFIG = BENCH / "agent" / "claude_code_cw.yaml"
DEFAULT_IMAGE = "codewatch-scbench:a1-cw0.7.0-eaf087f"
TOKEN_FILE = "$HOME/.config/scbench/claude-oauth-token-server"
DOCKER_HOST = "unix:///run/user/1000/docker.sock"
# The runner at 31ceea3 (common/render.py) strips one leading HTML comment, the catalog's canary.
CANARY = re.compile(r"^<!-- [\s\S]+ -->\n?")


class PlanError(Exception):
    pass


@dataclass(frozen=True)
class Plan:
    problem: str
    n: int
    tree: Path
    out: Path
    image: str
    model: str
    step_limit: int
    include_prior_tests: bool
    entry_file: str

    @property
    def next_cp(self) -> int:
        return self.n + 1

    @property
    def workspace(self) -> Path:
        return self.out / "ws"


def solve_source(tree: Path) -> Path:
    """A seed checkpoint dir holds its tree under snapshot/; any other path is the tree itself."""
    return tree / "snapshot" if (tree / "snapshot").is_dir() else tree


def check_paths(tree: Path, out: Path, seeds_root: Path) -> None:
    """The solve writes only into a fresh copy: never into the seeds, never over the source."""
    tree, out, seeds = tree.resolve(), out.resolve(), seeds_root.resolve()
    if not solve_source(tree).is_dir():
        raise PlanError(f"no tree at {tree}")
    if out == seeds or seeds in out.parents:
        raise PlanError("the output dir is inside the read-only seeds; pick a dir under experiments/")
    if out == tree or tree in out.parents or out in tree.parents:
        raise PlanError("the output dir overlaps the source tree")
    if out.exists() and any(out.iterdir()):
        raise PlanError(f"{out} already holds a run; pick a new run dir")


def problem_config(problem_dir: Path) -> dict:
    return yaml.safe_load((problem_dir / "config.yaml").read_text()) or {}


def include_prior_tests(config: dict, cp: int) -> bool:
    checkpoint = (config.get("checkpoints") or {}).get(f"checkpoint_{cp}") or {}
    return checkpoint.get("include_prior_tests", True) is not False


def bench_pins() -> tuple[str, int]:
    model = yaml.safe_load(MODEL_CONFIG.read_text())["internal_name"]
    step_limit = yaml.safe_load(AGENT_CONFIG.read_text())["cost_limits"]["step_limit"]
    return model, int(step_limit)


def build_plan(problem: str, n: int, tree: Path, out: Path, problem_dir: Path, image: str) -> Plan:
    if not (problem_dir / f"checkpoint_{n + 1}.md").is_file():
        raise PlanError(f"the problem has no checkpoint_{n + 1} spec")
    config = problem_config(problem_dir)
    model, step_limit = bench_pins()
    return Plan(problem=problem, n=n, tree=tree.resolve(), out=out.resolve(), image=image, model=model,
                step_limit=step_limit, include_prior_tests=include_prior_tests(config, n + 1),
                entry_file=str(config["entry_file"]))


def render_prompt(spec_text: str, entry_file: str) -> str:
    """The runner's render (31ceea3) for a continuation checkpoint, with the A1a template."""
    import jinja2

    spec = CANARY.sub("", spec_text)
    spec = spec.replace("%%%ENTRYPOINT:entry_file%%%", f"{entry_file}.py")
    spec = spec.replace("%%%ENTRYPOINT:entry_command%%%", f"python {entry_file}.py")
    context = {"is_continuation": True, "agent_type": "claude_code", "agent_version": "2.0.51", "model_name": None}
    return jinja2.Template(PROMPT_TEMPLATE.read_text()).render(spec=spec, **context)


def template_sha256() -> str:
    return hashlib.sha256(PROMPT_TEMPLATE.read_bytes()).hexdigest()


def solve_command(plan: Plan) -> list[str]:
    inner = (
        'git config --global --add safe.directory "*"\n'
        "python -m venv .venv >/dev/null && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1\n"
        f"claude --output-format stream-json --verbose --model {plan.model} --max-turns {plan.step_limit} "
        '--permission-mode bypassPermissions --print -- "$(cat /tmp/prompt.md)"; chmod -R a+rwX /workspace 2>/dev/null'
    )
    return ["docker", "run", "--rm", "--name", f"c250-{plan.out.parent.name}-{plan.out.name}",
            "-v", f"{plan.workspace}:/workspace", "-v", f"{plan.out / 'prompt.md'}:/tmp/prompt.md:ro",
            "-w", "/workspace", "-e", "CLAUDE_CODE_OAUTH_TOKEN", "-e", "DISABLE_NON_ESSENTIAL_MODEL_CALLS=1",
            "--entrypoint", "bash", plan.image, "-c", inner]


def eval_command(plan: Plan) -> list[str]:
    return ["bash", str(HARNESS / "eval.sh"), plan.problem, str(plan.next_cp), str(plan.workspace),
            str(plan.out / "eval")]


def describe(plan: Plan) -> str:
    """The full command plan, printed by --dry-run and saved beside a real run."""
    solve = " ".join(shlex.quote(part) for part in solve_command(plan))
    lines = [
        f"# solve-next: {plan.problem} cp{plan.n} -> cp{plan.next_cp}",
        f"# model {plan.model}, max turns {plan.step_limit}, image {plan.image}",
        f"# template {PROMPT_TEMPLATE.name} sha256 {template_sha256()}",
        f"# eval include_prior_tests: {str(plan.include_prior_tests).lower()}",
        f"cp -a {shlex.quote(str(solve_source(plan.tree)))} {shlex.quote(str(plan.workspace))}",
        f"render {PROMPT_TEMPLATE.name} for checkpoint_{plan.next_cp}.md -> {plan.out / 'prompt.md'}",
        (f"DOCKER_HOST={DOCKER_HOST} CLAUDE_CODE_OAUTH_TOKEN=\"$(cat {TOKEN_FILE})\" {solve} "
         f"> {plan.out / 'stdout.jsonl'} 2> {plan.out / 'stderr.log'}"),
        " ".join(shlex.quote(part) for part in eval_command(plan)),
        f"record -> {plan.out / 'run.json'}",
    ]
    return "\n".join(lines)
