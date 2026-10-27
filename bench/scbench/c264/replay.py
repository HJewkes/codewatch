"""C-264 S2: replay A1's kept fix items under the admission gate, in three arms.

Each arm keeps one hidden repository per problem. Its tree is always A1's tree at the same
point with the arm's dropped units cut out (`strip.py`), so A1's diffs never have to apply
to a tree they were not written for. Checkpoint N starts from S1's pre-fix tree, which
carries every earlier test forward, and the cut removes the earlier rejects again.

- R-none keeps everything and reproduces A1.
- R-commit is the gate with a failed retry: a rejected test or a coverage error drops the
  commit, and every def and class it added is cut from then on.
- R-test is the gate with a retry that removes exactly the rejected tests.
- R-test+helpers is R-test whose retry also removes the helpers, fixtures and imports the
  item added that nothing left uses. It can replay R-test's recorded verdicts (`--verdicts`),
  since cutting code no test runs changes no test's reach.

`Admission` and `Coverage` come from `remediation.admission` unchanged. Run it inside the A1
image, as root, with this directory, S1's output and the output directory mounted:

    python3 -m c264.replay --rebuild REBUILD --out OUT --arm R-test code_search [--cps 1]
    python3 -m c264.replay --rebuild REBUILD --out OUT --arm R-test+helpers \
        --verdicts OUT/R-test/code_search/replay.json code_search
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from remediation.admission import Admission, Coverage, Verdict, test_names
from remediation.git import Git
from remediation.session import run_process

from .rebuild import TEST_GAP, TESTS_DIR, git_apply
from .strip import added_units, import_statements, is_test_unit, strip, units

ARMS = ("R-none", "R-commit", "R-test", "R-test+helpers")
COVERAGE = "/opt/codewatch-a1/bin/coverage"
KEEP = {".codewatch", ".venv"}
TIMEOUT = 1800.0
Gate = Callable[[str, float | None], Verdict]
GateFactory = Callable[[str, Git], Gate | None]


@dataclass
class Arm:
    name: str
    git: Git
    gate: Gate | None
    prepare: Callable[[Path, Path], None] | None = None
    cut: dict[str, dict[str, str]] = field(default_factory=dict)
    whole: dict[str, str] = field(default_factory=dict)
    imports: dict[str, set[str]] = field(default_factory=dict)
    edited: set[str] = field(default_factory=set)
    log: list[dict] = field(default_factory=list)

    @property
    def workspace(self) -> Path:
        return self.git.workspace


def open_repo(workspace: Path) -> Git:
    git = Git(workspace, workspace / ".codewatch" / "repo.git")
    git.git_dir.mkdir(parents=True, exist_ok=True)
    if not git.exists():
        git.run("init", "-q", "-b", "main")
        git.ignore_tool_output()
    return git


def sync(a1: Path, workspace: Path) -> None:
    for path in workspace.iterdir():
        if path.name not in KEEP:
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    shutil.copytree(a1, workspace, dirs_exist_ok=True)


def elsewhere(workspace: Path, path: str) -> str:
    """The other Python files under tests/, which may name a helper or import a module."""
    files = sorted((workspace / TESTS_DIR).rglob("*.py"))
    return "\n".join(f.read_text(encoding="utf-8", errors="replace") for f in files if f != workspace / path)


def cut_file(arm: Arm, path: str) -> None:
    file = arm.workspace / path
    if not file.is_file():
        return
    text, others = file.read_text(encoding="utf-8"), elsewhere(arm.workspace, path)
    if arm.whole.get(path) == text and file.name.startswith("test") and not re.search(rf"\b{file.stem}\b", others):
        file.unlink()
        return
    outcome = strip(text, arm.cut.get(path, {}), others, frozenset(arm.imports.get(path, ())))
    arm.edited |= {f"{path}::{tail}" for tail in outcome.edited}
    if outcome.removed and not test_names(outcome.text) and file.name.startswith("test"):
        file.unlink()
    elif outcome.text != text:
        file.write_text(outcome.text, encoding="utf-8")


def materialize(arm: Arm, a1: Path) -> None:
    sync(a1, arm.workspace)
    for path in sorted(set(arm.cut) | set(arm.whole) | set(arm.imports)):
        cut_file(arm, path)


def changed(git: Git) -> bool:
    git.run("add", "-A", "--", ".", ":(exclude).codewatch")
    return bool(git.run("status", "--porcelain", "--", ".", ":(exclude).codewatch"))


def commit(git: Git, message: str) -> str | None:
    if not changed(git):
        return None
    git.run("commit", "-q", "--no-verify", "-m", message)
    return git.head()


def parent_text(git: Git, sha: str, path: str) -> str | None:
    try:
        return git.run("show", f"{sha}^:{path}") + "\n"
    except RuntimeError:
        return None


def drop_commit(arm: Arm, sha: str) -> None:
    """Cut every def and class `sha` added under tests/, and the files it created, then reset."""
    for path in sorted(arm.git.files_in(sha)):
        file = arm.workspace / path
        if not (path.startswith(f"{TESTS_DIR}/") and file.is_file()):
            continue
        before, after = parent_text(arm.git, sha, path), file.read_text(encoding="utf-8")
        if before is None:
            arm.whole[path] = after
        arm.cut.setdefault(path, {}).update(units(after, added_units(before, after)))
    arm.git.run("reset", "-q", "--hard", "HEAD~1")


def record_helpers(arm: Arm, sha: str) -> list[str]:
    """Record the top-level helpers, fixtures and imports `sha` added under tests/."""
    paths = [p for p in sorted(arm.git.files_in(sha)) if p.startswith(f"{TESTS_DIR}/") and (arm.workspace / p).is_file()]
    for path in paths:
        before, after = parent_text(arm.git, sha, path), (arm.workspace / path).read_text(encoding="utf-8")
        helpers = [t for t in added_units(before, after) if "::" not in t and not is_test_unit(t)]
        arm.cut.setdefault(path, {}).update(units(after, helpers))
        arm.imports.setdefault(path, set()).update(set(import_statements(after)) - set(import_statements(before or "")))
    return paths


def drop_tests(arm: Arm, rejected: tuple[str, ...]) -> str:
    """Cut the rejected tests (and for R-test+helpers what only they used) and amend; a commit
    left empty goes."""
    helper_paths = record_helpers(arm, arm.git.head()) if arm.name == "R-test+helpers" else []
    for node in rejected:
        path, tail = node.split("::", 1)
        text = (arm.workspace / path).read_text(encoding="utf-8")
        arm.cut.setdefault(path, {}).update(units(text, [tail]))
        cut_file(arm, path)
    for path in helper_paths:
        cut_file(arm, path)
    arm.git.run("add", "-A", "--", ".", ":(exclude).codewatch")
    if not arm.git.run("diff", "--cached", "--name-only", "HEAD~1"):
        arm.git.run("reset", "-q", "--hard", "HEAD~1")
        return "emptied"
    arm.git.run("commit", "-q", "--no-verify", "--amend", "--no-edit")
    return "trimmed"


def judge_item(arm: Arm, sha: str) -> dict:
    started = time.monotonic()
    verdict = arm.gate(sha, TIMEOUT)
    record = {"admitted": list(verdict.admitted), "rejected": list(verdict.rejected), "error": verdict.error,
              "gate_seconds": round(time.monotonic() - started, 1)}
    if not (verdict.rejected or verdict.error):
        return {**record, "status": "kept"}
    if arm.name == "R-commit" or verdict.error:
        drop_commit(arm, sha)
        return {**record, "status": "reverted"}
    return {**record, "status": drop_tests(arm, verdict.rejected)}


def replay_item(arm: Arm, a1: Path, rebuild: Path, row: dict) -> None:
    git_apply(a1, (rebuild / row["diff"]).read_text(encoding="utf-8"), reverse=False)
    materialize(arm, a1)
    entry = {k: row[k] for k in ("problem", "cp", "order", "kind", "signal", "symbol")}
    sha = commit(arm.git, f"{row['kind']} cp{row['cp']} {row['order']:02d} {row['signal']}")
    if sha is None:
        arm.log.append({**entry, "status": "empty"})
        return
    gated = row["kind"] == TEST_GAP and arm.gate is not None
    arm.log.append({**entry, **(judge_item(arm, sha) if gated else {"status": "kept"})})


def build_venv(workspace: Path) -> None:
    """The agent's `.venv`: the task's requirements and any bundled wheel, for `agent_test_env`."""
    venv = workspace / ".venv"
    shutil.rmtree(venv, ignore_errors=True)
    wheels = [str(w) for w in sorted(workspace.glob("*.whl"))]
    subprocess.run(["uv", "venv", "-q", "--python", sys.executable, str(venv)], check=True)
    subprocess.run(["uv", "pip", "install", "-q", "--python", str(venv / "bin" / "python"),
                    "-r", str(workspace / "requirements.txt"), *wheels], check=True)


def ensure_venv(workspace: Path, key_file: Path) -> None:
    """Rebuild the venv only when the requirements or the bundled wheels changed."""
    key = (workspace / "requirements.txt").read_text() + "".join(p.name for p in sorted(workspace.glob("*.whl")))
    if key_file.is_file() and key_file.read_text() == key:
        return
    build_venv(workspace)
    key_file.write_text(key)


def replay_checkpoint(arm: Arm, base: Path, rebuild: Path, out: Path, rows: list[dict]) -> None:
    cp = int(base.name.removeprefix("cp"))
    a1 = out / "a1"
    shutil.rmtree(a1, ignore_errors=True)
    shutil.copytree(base, a1)
    materialize(arm, a1)
    commit(arm.git, f"solve cp{cp}")
    if arm.prepare is not None:
        arm.prepare(arm.workspace, out / "venv.key")
    for row in rows:
        replay_item(arm, a1, rebuild, row)
    arm.git.run("tag", "-f", f"cp{cp}")
    export(arm.git, f"cp{cp}", out / "trees" / f"cp{cp}")


def export(git: Git, ref: str, target: Path) -> None:
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    archive = subprocess.run(["git", "archive", ref], env=git.env(), cwd=git.workspace, capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", str(target)], input=archive.stdout, check=True)


def admission_gates(coverage: str) -> GateFactory:
    """The live gate's `Admission` over the pinned coverage.py; R-none runs no gate."""
    def make(name: str, git: Git) -> Gate | None:
        if name == "R-none":
            return None
        scratch = git.workspace.parent / "scratch"
        return Admission(git, Coverage(coverage, git.workspace, scratch, TESTS_DIR, run_process))
    return make


def recorded_gates(verdicts: Path) -> GateFactory:
    """Replay another arm's logged verdicts, found by the item's checkpoint and order."""
    logged = {(i["cp"], i["order"]): Verdict(tuple(i["admitted"]), tuple(i["rejected"]), i["error"])
              for i in json.loads(verdicts.read_text())["items"] if "admitted" in i}

    def make(name: str, git: Git) -> Gate | None:
        def gate(sha: str, timeout: float | None) -> Verdict:
            _, cp, order, _ = git.run("log", "-1", "--format=%s", sha).split(" ", 3)
            return logged[(int(cp.removeprefix("cp")), int(order))]
        return None if name == "R-none" else gate
    return make


def replay(arm_name: str, problem: str, rebuild: Path, out: Path, cps: set[int] | None,
           gates: GateFactory, prepare: Callable[[Path, Path], None] | None = ensure_venv) -> Arm:
    rows = [r for r in json.loads((rebuild / "items.json").read_text()) if r["problem"] == problem]
    run_dir = out / arm_name / problem
    shutil.rmtree(run_dir, ignore_errors=True)
    git = open_repo(run_dir / "ws")
    gate = gates(arm_name, git)
    arm = Arm(arm_name, git, gate, prepare if gate is not None else None)
    for base in sorted((rebuild / "base" / problem).iterdir(), key=lambda p: int(p.name.removeprefix("cp"))):
        cp = int(base.name.removeprefix("cp"))
        if cps is None or cp in cps:
            replay_checkpoint(arm, base, rebuild, run_dir, [r for r in rows if r["cp"] == cp])
    record = {"arm": arm_name, "problem": problem, "items": arm.log, "edited_kept": sorted(arm.edited)}
    (run_dir / "replay.json").write_text(json.dumps(record, indent=1) + "\n")
    return arm


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rebuild", type=Path, required=True, help="S1's output directory")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--cps", type=int, nargs="*", help="only these checkpoints (the timing probe)")
    parser.add_argument("--coverage", default=COVERAGE)
    parser.add_argument("--verdicts", type=Path, help="replay this arm's replay.json verdicts, without coverage")
    parser.add_argument("problem")
    args = parser.parse_args(argv)
    started = time.monotonic()
    cps = set(args.cps) if args.cps else None
    gates = recorded_gates(args.verdicts) if args.verdicts else admission_gates(args.coverage)
    prepare = None if args.verdicts else ensure_venv
    arm = replay(args.arm, args.problem, args.rebuild, args.out, cps, gates, prepare)
    statuses = [i["status"] for i in arm.log]
    print(json.dumps({"arm": args.arm, "problem": args.problem, "seconds": round(time.monotonic() - started),
                      **{s: statuses.count(s) for s in sorted(set(statuses))}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
