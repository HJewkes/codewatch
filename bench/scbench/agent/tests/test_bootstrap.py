import concurrent.futures
import os
from concurrent.futures.process import BrokenProcessPool
import unittest
from pathlib import Path
from unittest import mock

try:
    import slop_code  # noqa: F401
except ModuleNotFoundError:
    raise unittest.SkipTest("slop-code-bench is not installed; run pnpm test:bench:agent")

from agent import bootstrap
from agent.runner_configs import RUNNER_CONFIGS_ENV

FIXTURE_RUNNER = Path(__file__).parent / "fixtures" / "runner-configs"


def worker_state():
    from slop_code.agent_runner.registry import get_agent_cls
    from slop_code.common.llms import ModelCatalog
    from slop_code.execution.docker_runtime.streaming import DockerStreamingRuntime

    return {
        "exec_launcher": DockerStreamingRuntime._start_exec_process.__module__,
        "sonnet": ModelCatalog.get("sonnet-5.5").internal_name,
        "cw_agent": get_agent_cls("claude_code_cw").__name__,
        "mark": os.environ.get("SCBENCH_TEST_MARK"),
        "mark_saw_setup": os.environ.get("SCBENCH_TEST_MARK_SAW"),
    }


def mark_worker(value):
    from slop_code.execution.docker_runtime.streaming import DockerStreamingRuntime

    os.environ["SCBENCH_TEST_MARK"] = value
    os.environ["SCBENCH_TEST_MARK_SAW"] = DockerStreamingRuntime._start_exec_process.__module__


def _run_in_worker(env, **pool_kwargs):
    stock_init = concurrent.futures.ProcessPoolExecutor.__init__
    with mock.patch.dict(os.environ, env), \
            mock.patch.object(concurrent.futures.ProcessPoolExecutor, "__init__", stock_init):
        bootstrap.wrap_process_pools()
        with concurrent.futures.ProcessPoolExecutor(max_workers=1, max_tasks_per_child=1, **pool_kwargs) as pool:
            return pool.submit(worker_state).result(timeout=120)


class SpawnedWorkerTest(unittest.TestCase):
    def test_a_worker_spawned_like_the_runners_problem_pool_gets_the_launcher_setup(self):
        state = _run_in_worker({RUNNER_CONFIGS_ENV: str(FIXTURE_RUNNER)})

        self.assertEqual(state, {"exec_launcher": "agent.secret_env", "sonnet": "claude-sonnet-5-5",
                                 "cw_agent": "ClaudeCodeCwAgent", "mark": None, "mark_saw_setup": None})

    def test_a_pools_own_initializer_runs_after_the_setup_not_instead_of_it(self):
        state = _run_in_worker({RUNNER_CONFIGS_ENV: str(FIXTURE_RUNNER)},
                               initializer=mark_worker, initargs=("caller-ran",))

        self.assertEqual(state["exec_launcher"], "agent.secret_env")
        self.assertEqual(state["mark"], "caller-ran")
        self.assertEqual(state["mark_saw_setup"], "agent.secret_env")

    def test_a_worker_whose_setup_fails_runs_no_task(self):
        with self.assertRaises(BrokenProcessPool):
            _run_in_worker({RUNNER_CONFIGS_ENV: str(FIXTURE_RUNNER / "missing")}, initializer=mark_worker,
                           initargs=("caller-ran",))

    def test_a_non_callable_initializer_is_refused_up_front(self):
        stock_init = concurrent.futures.ProcessPoolExecutor.__init__
        with mock.patch.object(concurrent.futures.ProcessPoolExecutor, "__init__", stock_init):
            bootstrap.wrap_process_pools()
            with self.assertRaises(TypeError):
                concurrent.futures.ProcessPoolExecutor(max_workers=1, initializer="setup")


if __name__ == "__main__":
    unittest.main()
