import concurrent.futures
import os
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
    }


class SpawnedWorkerTest(unittest.TestCase):
    def test_a_worker_spawned_like_the_runners_problem_pool_gets_the_launcher_setup(self):
        stock_init = concurrent.futures.ProcessPoolExecutor.__init__
        with mock.patch.dict(os.environ, {RUNNER_CONFIGS_ENV: str(FIXTURE_RUNNER)}), \
                mock.patch.object(concurrent.futures.ProcessPoolExecutor, "__init__", stock_init):
            bootstrap.wrap_process_pools()
            with concurrent.futures.ProcessPoolExecutor(max_workers=1, max_tasks_per_child=1) as pool:
                state = pool.submit(worker_state).result(timeout=120)

        self.assertEqual(state, {"exec_launcher": "agent.secret_env", "sonnet": "claude-sonnet-5-5",
                                 "cw_agent": "ClaudeCodeCwAgent"})

    def test_a_pool_given_its_own_initializer_keeps_it(self):
        stock_init = concurrent.futures.ProcessPoolExecutor.__init__
        with mock.patch.object(concurrent.futures.ProcessPoolExecutor, "__init__", stock_init):
            bootstrap.wrap_process_pools()
            pool = concurrent.futures.ProcessPoolExecutor(max_workers=1, initializer=print)
            pool.shutdown()

        self.assertIs(pool._initializer, print)


if __name__ == "__main__":
    unittest.main()
