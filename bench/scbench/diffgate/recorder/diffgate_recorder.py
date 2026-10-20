"""pytest plugin (-p diffgate_recorder): record every CLI call the tests make, as a replayable case (C-242).

Loaded into the test process only (PYTHONPATH=<this dir>), it wraps subprocess.run. A call whose argv
names the entry file (DIFFGATE_ENTRY) is recorded before it runs: argv, cwd, env changes, stdin, and a
copy of every file tree an absolute argv path points into. Paths are rewritten to placeholders so the
case replays against any program root:
  {PY}    the interpreter          {ROOT}  DIFFGATE_ROOT, the program under test
  {CASE}  the case's own copy of the trees it reads (one per pytest tmp dir or path)
Cases are deduplicated by content; each lists the pytest node ids that made it. Stdlib only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

_REAL_RUN = subprocess.run
_PYTEST_TMP = re.compile(r"pytest-\d+$")
_DROPPED_ENV = ("PYTEST_", "DIFFGATE_")
MAX_TREE_BYTES = 20_000_000


def _anchor(path: Path) -> Path | None:
    """The tree to copy for a path: its pytest tmp dir, else an existing path of bounded size."""
    for parent in path.parents:
        if parent.parent != parent and _PYTEST_TMP.search(parent.parent.name):
            return parent
    if path.is_file() or (path.is_dir() and _size(path) <= MAX_TREE_BYTES):
        return path
    return None


def _size(tree: Path) -> int:
    total = 0
    for item in tree.rglob("*"):
        total += item.stat().st_size if item.is_file() else 0
        if total > MAX_TREE_BYTES:
            break
    return total


class Snapshot:
    def __init__(self, root: Path, files: Path):
        self.root, self.files, self.anchors = root, files, {}

    def path(self, raw: str) -> str:
        path = Path(raw)
        if not path.is_absolute():
            return raw
        if os.path.realpath(raw) == os.path.realpath(sys.executable):
            return "{PY}"
        if path == self.root or self.root in path.parents:
            return "{ROOT}" + raw[len(str(self.root)):]
        anchor = _anchor(path)
        if anchor is None:
            return raw
        if anchor not in self.anchors:
            self.anchors[anchor] = f"p{len(self.anchors)}"
            _copy(anchor, self.files / self.anchors[anchor])
        return "{CASE}/" + self.anchors[anchor] + raw[len(str(anchor)):]

    def token(self, raw: str) -> str:
        if raw.startswith("-") and "=" in raw:
            flag, value = raw.split("=", 1)
            return f"{flag}={self.path(value)}"
        return self.path(raw)


def _copy(source: Path, destination: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    elif source.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    else:
        destination.mkdir(parents=True)


def _env_changes(env, snap: Snapshot) -> tuple[dict, list]:
    if env is None:
        return {}, []
    keep = [k for k in env if not k.startswith(_DROPPED_ENV)]
    changed = {k: snap.token(env[k]) for k in keep if os.environ.get(k) != env[k]}
    unset = sorted(k for k in os.environ if k not in env and not k.startswith(_DROPPED_ENV))
    return changed, unset


def _stdin(kwargs) -> str | None:
    data = kwargs.get("input")
    if data is None:
        return None
    return base64.b64encode(data.encode() if isinstance(data, str) else data).decode()


def _tree_digest(files: Path) -> str:
    digest = hashlib.sha1()
    for path in sorted(files.rglob("*")):
        digest.update(path.relative_to(files).as_posix().encode())
        if path.is_file() and not path.is_symlink():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def _store(staging: Path, case: dict, cases: Path) -> None:
    key = json.dumps(case, sort_keys=True) + _tree_digest(staging / "files")
    case_dir = cases / hashlib.sha1(key.encode()).hexdigest()[:16]
    node = os.environ.get("PYTEST_CURRENT_TEST", "").rsplit(" (", 1)[0]
    if case_dir.exists():
        shutil.rmtree(staging)
    else:
        staging.rename(case_dir)
    meta = case_dir / "case.json"
    stored = json.loads(meta.read_text()) if meta.exists() else {**case, "nodeids": []}
    if node and node not in stored["nodeids"]:
        stored["nodeids"].append(node)
    meta.write_text(json.dumps(stored, indent=1, sort_keys=True))


def record(argv: list[str], kwargs: dict) -> None:
    cases = Path(os.environ["DIFFGATE_CASES"])
    staging = cases / f".staging-{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    (staging / "files").mkdir(parents=True)
    snap = Snapshot(Path(os.environ["DIFFGATE_ROOT"]), staging / "files")
    cwd = snap.path(os.fspath(kwargs.get("cwd") or os.getcwd()))
    env, unset = _env_changes(kwargs.get("env"), snap)
    case = {"argv": [snap.token(t) for t in argv], "cwd": cwd, "env": env, "unset_env": unset,
            "stdin_b64": _stdin(kwargs), "source": os.environ.get("DIFFGATE_SOURCE", "tests")}
    _store(staging, case, cases)


def _recording_run(*args, **kwargs):
    command = args[0] if args else kwargs.get("args")
    entry = os.environ.get("DIFFGATE_ENTRY", "")
    if isinstance(command, (list, tuple)) and any(os.path.basename(os.fspath(t)) == entry for t in command):
        record([os.fspath(t) for t in command], kwargs)
    return _REAL_RUN(*args, **kwargs)


def pytest_configure(config):
    subprocess.run = _recording_run
