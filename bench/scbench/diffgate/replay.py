"""Replay recorded cases against a program root and capture what each one observably does (C-242).

A run materialises the case's trees in a fresh scratch dir, substitutes the placeholders, and runs it
with the recorded stdin and env changes. The outcome is the exit code, stdout, stderr, and a digest of
every file left in the scratch dir (so a cleanup that changes what the program writes is seen too).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TIMEOUT_S = 10


def load_cases(cases_dir: Path) -> dict[str, dict]:
    cases = {}
    for meta in sorted(cases_dir.glob("*/case.json")):
        cases[meta.parent.name] = json.loads(meta.read_text())
    return cases


def _substitute(text: str, places: dict[str, str]) -> str:
    for placeholder, value in places.items():
        text = text.replace(placeholder, value)
    return text


def _env(case: dict, places: dict[str, str]) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in case["unset_env"] and not k.startswith("DIFFGATE_")}
    env.update({k: _substitute(v, places) for k, v in case["env"].items()})
    return env


def _tree(scratch: Path) -> dict[str, str]:
    return {p.relative_to(scratch).as_posix(): hashlib.sha1(p.read_bytes()).hexdigest()
            for p in sorted(scratch.rglob("*")) if p.is_file() and not p.is_symlink()}


def _decode(data: bytes, places: dict[str, str]) -> str:
    text = data.decode("utf-8", errors="replace")
    for placeholder, value in sorted(places.items(), key=lambda kv: -len(kv[1])):
        text = text.replace(value, placeholder)
    return text


def run_case(case_dir: Path, case: dict, root: Path, scratch: Path, python: str) -> dict:
    shutil.copytree(case_dir / "files", scratch, symlinks=True)
    places = {"{CASE}": str(scratch), "{ROOT}": str(root), "{PY}": python}
    stdin = base64.b64decode(case["stdin_b64"]) if case.get("stdin_b64") else None
    try:
        done = subprocess.run([_substitute(t, places) for t in case["argv"]], input=stdin,
                              cwd=_substitute(case["cwd"], places), env=_env(case, places),
                              capture_output=True, timeout=TIMEOUT_S)
        rc, out, err = done.returncode, done.stdout, done.stderr
    except subprocess.TimeoutExpired as timeout:
        rc, out, err = "timeout", timeout.stdout or b"", timeout.stderr or b""
    return {"rc": rc, "stdout": _decode(out, places), "stderr": _decode(err, places), "files": _tree(scratch)}


def replay(cases_dir: Path, root: Path, scratch: Path, python: str, workers: int = 8) -> dict[str, dict]:
    cases = load_cases(cases_dir)
    scratch.mkdir(parents=True, exist_ok=True)

    def one(name: str) -> tuple[str, dict]:
        return name, run_case(cases_dir / name, cases[name], root, scratch / name, python)

    with ThreadPoolExecutor(workers) as pool:
        return dict(pool.map(one, sorted(cases)))
