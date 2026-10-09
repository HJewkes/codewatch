"""Refuse a run directory inside a repo checkout.

Run outputs hold problem text, hidden-test results and agent code, which must never
land in a repo. The runner's default `save_dir` is `outputs` under the working
directory, which for this launcher is a codewatch checkout. `install()` wraps the
runner's output-directory resolver so a run stops before it creates anything there.
Set `save_dir=<dir outside any checkout>` and `save_template=<name>` instead; the
runner ignores `output_path=`.
"""

from __future__ import annotations

from pathlib import Path


class RunDirInRepo(SystemExit):
    pass


def enclosing_checkout(path: Path) -> Path | None:
    resolved = path.expanduser().resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def refuse_repo_run_dir(output_path: str) -> None:
    checkout = enclosing_checkout(Path(output_path))
    if checkout is not None:
        raise RunDirInRepo(
            f"refusing run dir {output_path}: it is inside the checkout {checkout}. "
            "Pass save_dir=<dir outside any checkout> save_template=<name>."
        )


def install() -> None:
    from slop_code.entrypoints.commands import run_agent

    stock = run_agent._resolve_output_directory
    if getattr(stock, "guarded", False) is True:
        return

    def resolve(config_output_path: str, *, debug: bool):
        refuse_repo_run_dir(config_output_path)
        return stock(config_output_path, debug=debug)

    resolve.guarded = True
    run_agent._resolve_output_directory = resolve
