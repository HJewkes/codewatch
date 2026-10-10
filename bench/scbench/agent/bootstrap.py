"""Launcher setup, applied in the main process and in every worker the runner spawns.

The runner runs each problem in `ProcessPoolExecutor(max_tasks_per_child=1)`, which
uses the spawn start method. Spawn never re-runs a `*.__main__` module, so setup done
only in `agent/__main__.py` is missing in the worker that runs the agent. `setup()`
therefore also makes itself the `initializer` of every process pool, and a spawned
worker imports this module by name and runs it before its first task. A pool's own
initializer runs after `setup()`. If `setup()` raises in a worker, the pool breaks and
no task runs there, so a worker never runs without the setup.
"""

from __future__ import annotations

import concurrent.futures

from agent import output_guard, runner_configs, secret_env

_STOCK_POOL_INIT = concurrent.futures.ProcessPoolExecutor.__init__


def setup() -> None:
    from agent import claude_code_cw  # noqa: F401 - registers the agent type

    runner_configs.preload()
    secret_env.install()
    output_guard.install()
    wrap_process_pools()


def setup_then(initializer=None, *initargs) -> None:
    setup()
    if initializer is not None:
        initializer(*initargs)


def _pool_init(self, max_workers=None, mp_context=None, initializer=None, initargs=(), **kwargs):
    if initializer is not None and not callable(initializer):
        raise TypeError("initializer must be callable")
    _STOCK_POOL_INIT(self, max_workers, mp_context, setup_then, (initializer, *initargs), **kwargs)


def wrap_process_pools() -> None:
    concurrent.futures.ProcessPoolExecutor.__init__ = _pool_init
