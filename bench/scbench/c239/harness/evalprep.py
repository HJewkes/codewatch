"""evalprep.py <problem dir> <N> <workspace>: lay out the hidden tests as the pinned runner (31ceea3) does.

Mirrors evaluation/pytest_runner.py: tests for checkpoints 1..N (only N when the checkpoint sets
include_prior_tests: false) plus every non-test file and directory under tests/, static assets
copied to .evaluation_tests/assets/<name>, and a pytest.ini registering the markers. Prints the
run settings as shell assignments: ENV (KEY=VALUE pairs) and WITH (uvx --with flags).
"""

import shlex
import shutil
import sys
from pathlib import Path

import yaml

TEST_DIR = ".evaluation_tests"
BASE_DEPS = ["pytest", "pytest-json-ctrf", "pytest-json-report", "pytest-timeout", "jsonschema", "deepdiff"]
BUILTIN_MARKERS = {"error": "error-handling / edge-case tests", "functionality": "non-core / nice-to-have tests",
                   "regression": "regression tests from prior checkpoints"}


def checkpoint_files(config: dict, n: int) -> set[str]:
    items = sorted((config.get("checkpoints") or {}).items(), key=lambda kv: (kv[1] or {}).get("order", 0))
    name = f"checkpoint_{n}"
    if (dict(items).get(name) or {}).get("include_prior_tests", True) is False:
        return {f"test_{name}.py"}
    names = [k for k, _ in items]
    return {f"test_{k}.py" for k in names[: names.index(name) + 1]}


def copy_tests(problem: Path, dest: Path, wanted: set[str]) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for item in (problem / "tests").iterdir():
        is_cp_test = item.is_file() and item.name.startswith("test_") and item.suffix == ".py"
        if item.is_dir() and item.name != "__pycache__":
            shutil.copytree(item, dest / item.name)
        elif item.is_file() and (not is_cp_test or item.name in wanted):
            shutil.copy2(item, dest / item.name)


def copy_assets(problem: Path, dest: Path, assets: dict) -> dict[str, str]:
    env = {}
    for name, asset in (assets or {}).items():
        src, target = problem / asset["path"], dest / "assets" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, target) if src.is_dir() else shutil.copy2(src, target)
        env["SCBENCH_ASSETS_DIR"] = f"{TEST_DIR}/assets"
        env[f"SCBENCH_ASSET_{name.upper()}"] = f"{TEST_DIR}/assets/{name}"
    return env


def write_ini(ws: Path, markers: dict) -> None:
    lines = [f"    {k}: {v}" for k, v in BUILTIN_MARKERS.items()]
    lines += [f"    {k}: {(v or {}).get('description', k)}" for k, v in (markers or {}).items() if k not in BUILTIN_MARKERS]
    (ws / "pytest.ini").write_text("[pytest]\ntestpaths = tests\nmarkers =\n" + "\n".join(lines) + "\n")


def main(problem_dir: str, n: str, workspace: str) -> int:
    problem, ws = Path(problem_dir), Path(workspace)
    config = yaml.safe_load((problem / "config.yaml").read_text())
    copy_tests(problem, ws / TEST_DIR, checkpoint_files(config, int(n)))
    env = copy_assets(problem, ws / TEST_DIR, config.get("static_assets"))
    env.update({k: str(v) for k, v in ((config.get("checkpoints") or {}).get(f"checkpoint_{n}") or {}).get("env", {}).items()})
    write_ini(ws, config.get("markers"))
    deps = BASE_DEPS + list(config.get("test_dependencies") or [])
    print("ENV=" + shlex.quote(" ".join(f"-e {shlex.quote(f'{k}={v}')}" for k, v in env.items())))
    print("WITH=" + shlex.quote(" ".join(f"--with={shlex.quote(d)}" for d in deps)))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
