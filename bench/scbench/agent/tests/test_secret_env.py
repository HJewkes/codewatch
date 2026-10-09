import unittest
from pathlib import Path
from unittest import mock

try:
    import slop_code  # noqa: F401
except ModuleNotFoundError:
    raise unittest.SkipTest("slop-code-bench is not installed; run pnpm test:bench:agent")

from slop_code.entrypoints.config.loader import resolve_environment
from slop_code.execution import DockerConfig, DockerEnvironmentSpec
from slop_code.execution.docker_runtime.streaming import DockerStreamingRuntime

from agent import secret_env

PILOT_ENV = Path(__file__).parents[2] / "configs" / "environments" / "docker-python3.12-uv-rootless.yaml"
FAKE_TOKEN = "fake-oauth-value-not-a-real-token"
FAKE_KEY = "fake-api-key-value"
ENV = {"CLAUDE_CODE_OAUTH_TOKEN": FAKE_TOKEN, "ANTHROPIC_API_KEY": FAKE_KEY, "DISABLE_AUTOUPDATER": "1"}
STOCK_START = DockerStreamingRuntime._start_exec_process


def _runtime(spec=None):
    spec = spec or DockerEnvironmentSpec(name="env", docker=DockerConfig(image="python:3.12"))
    with mock.patch("docker.from_env"):
        runtime = DockerStreamingRuntime(spec, Path("/workspace"), {}, is_evaluation=False, ports={},
                                         mounts={}, env_vars={}, setup_command=None, user="0:0",
                                         disable_setup=True)
    runtime._ensure_container_running = mock.Mock(return_value=mock.Mock(id="cid"))
    return runtime


def _launch(runtime, start):
    popen = mock.Mock()
    with mock.patch("subprocess.Popen", popen), \
            mock.patch.object(DockerStreamingRuntime, "_start_exec_process", start), \
            unittest.TestCase().assertLogs("slop_code", level="DEBUG") as logs:
        runtime._start_exec_process("claude -p task", dict(ENV))
    (argv,), kwargs = popen.call_args
    return argv, kwargs.get("env"), "\n".join(logs.output)


class TokenByNameTest(unittest.TestCase):
    def test_stock_runner_puts_the_token_value_on_the_docker_exec_argv(self):
        argv, _, _ = _launch(_runtime(), STOCK_START)

        self.assertIn(f"CLAUDE_CODE_OAUTH_TOKEN={FAKE_TOKEN}", argv)

    def test_credentials_go_by_name_and_their_values_only_reach_popens_env(self):
        argv, env, log = _launch(_runtime(), secret_env._start_exec_process)

        self.assertFalse(any(FAKE_TOKEN in a or FAKE_KEY in a for a in argv))
        self.assertNotIn(FAKE_TOKEN, log)
        self.assertNotIn(FAKE_KEY, log)
        self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], FAKE_TOKEN)
        self.assertEqual(env["ANTHROPIC_API_KEY"], FAKE_KEY)
        self.assertIn("Built docker exec command", log)

    def test_argv_equals_stock_except_that_credential_values_are_dropped(self):
        stock_argv, _, _ = _launch(_runtime(), STOCK_START)
        argv, _, _ = _launch(_runtime(), secret_env._start_exec_process)

        expected = [a.partition("=")[0] if secret_env.is_credential(a.partition("=")[0]) else a
                    for a in stock_argv]
        self.assertEqual(argv, expected)
        self.assertEqual(argv[argv.index("CLAUDE_CODE_OAUTH_TOKEN") - 1], "--env")
        self.assertIn("DISABLE_AUTOUPDATER=1", argv)

    def test_the_pilot_env_sends_is_sandbox_to_docker_exec_and_leaves_the_command_alone(self):
        argv, _, _ = _launch(_runtime(resolve_environment(PILOT_ENV)), secret_env._start_exec_process)
        stock_argv, _, _ = _launch(_runtime(), secret_env._start_exec_process)

        self.assertEqual(argv[argv.index("IS_SANDBOX=1") - 1], "--env")
        self.assertEqual(argv[-3:], stock_argv[-3:])
        self.assertEqual(argv[-1], "claude -p task")

    def test_install_replaces_the_runner_exec_launcher(self):
        with mock.patch.object(DockerStreamingRuntime, "_start_exec_process", STOCK_START):
            secret_env.install()

            self.assertIs(DockerStreamingRuntime._start_exec_process, secret_env._start_exec_process)

    def test_keys_matching_the_runners_own_mask_markers_are_hidden(self):
        hidden = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
                  "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID", "GH_TOKENS", "DB_PASSWORD_FILE",
                  "client_secret", "GOOGLE_APPLICATION_CREDENTIALS", "HTTP_AUTHORIZATION"]
        shown = ["MAX_THINKING_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_EFFORT_LEVEL", "HOME",
                 "IS_SANDBOX", "DISABLE_AUTOUPDATER"]

        self.assertEqual([k for k in hidden if not secret_env.is_credential(k)], [])
        self.assertEqual([k for k in shown if secret_env.is_credential(k)], [])

    def test_install_aborts_when_the_runner_lacks_the_exec_launcher_it_replaces(self):
        class ChangedRuntime(DockerStreamingRuntime):
            _start_exec_process = None

        with self.assertRaises(secret_env.RunnerMismatch) as caught:
            secret_env.install(ChangedRuntime)

        self.assertIn("_start_exec_process", str(caught.exception))
        self.assertIsNone(ChangedRuntime._start_exec_process)


if __name__ == "__main__":
    unittest.main()
