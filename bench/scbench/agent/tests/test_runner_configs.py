import hashlib
import importlib.util
import unittest
from pathlib import Path

from agent import runner_configs
from agent.runner_configs import VENDORED_CONFIGS, ConfigsNotFound, manifest_entry, models_dirs, providers_file

FIXTURE_RUNNER = Path(__file__).parent / "fixtures" / "runner-configs"
EMPTY = Path(__file__).parent / "fixtures" / "no-such-configs"
VENDORED_SONNET = VENDORED_CONFIGS / "models" / "sonnet-5.5.yaml"
VENDORED_ENV = VENDORED_CONFIGS / "environments" / "docker-python3.12-uv-rootless.yaml"
HAS_RUNNER = importlib.util.find_spec("slop_code") is not None


class ResolutionTest(unittest.TestCase):
    def test_providers_fall_back_to_the_runner_checkout_when_the_vendored_dir_has_none(self):
        self.assertEqual(providers_file(VENDORED_CONFIGS, FIXTURE_RUNNER), FIXTURE_RUNNER / "providers.yaml")

    def test_vendored_models_load_after_the_runner_models_so_they_win(self):
        dirs = models_dirs(VENDORED_CONFIGS, FIXTURE_RUNNER)

        self.assertEqual(dirs, [FIXTURE_RUNNER / "models", VENDORED_CONFIGS / "models"])

    def test_a_missing_runner_checkout_is_an_error_not_an_empty_catalog(self):
        with self.assertRaises(ConfigsNotFound):
            providers_file(VENDORED_CONFIGS, EMPTY)

    def test_the_manifest_entry_pins_every_vendored_config_by_sha(self):
        entry = manifest_entry(VENDORED_CONFIGS, FIXTURE_RUNNER)

        pins = entry["vendoredConfigs"]
        self.assertEqual(pins["bench/scbench/configs/models/sonnet-5.5.yaml"],
                         hashlib.sha256(VENDORED_SONNET.read_bytes()).hexdigest())
        self.assertEqual(pins[f"bench/scbench/configs/environments/{VENDORED_ENV.name}"],
                         hashlib.sha256(VENDORED_ENV.read_bytes()).hexdigest())
        self.assertEqual(entry["providersFile"], str(FIXTURE_RUNNER / "providers.yaml"))


@unittest.skipUnless(HAS_RUNNER, "slop-code-bench is not installed; run pnpm test:bench:agent")
class PreloadTest(unittest.TestCase):
    def tearDown(self):
        from slop_code.agent_runner.credentials import ProviderCatalog
        from slop_code.common.llms import ModelCatalog

        ProviderCatalog.clear()
        ModelCatalog.clear()

    def test_the_run_model_argument_resolves_to_sonnet_5_5_with_effort_thinking(self):
        from slop_code.entrypoints.utils import parse_model_override

        runner_configs.preload(VENDORED_CONFIGS, FIXTURE_RUNNER)
        override = parse_model_override("claude_code_oauth/sonnet-5.5")

        self.assertEqual(override.provider, "claude_code_oauth")
        self.assertEqual(override.model_def.internal_name, "claude-sonnet-5-5")
        self.assertEqual(override.model_def.thinking_style, "effort")
        self.assertEqual(override.model_def.get_model_slug("claude_code_oauth"), "claude-sonnet-5-5")
        self.assertEqual(override.model_def.get_agent_settings("claude_code"), {"endpoint": "anthropic"})

    def test_runner_models_stay_available_beside_the_vendored_ones(self):
        from slop_code.common.llms import ModelCatalog

        runner_configs.preload(VENDORED_CONFIGS, FIXTURE_RUNNER)

        self.assertEqual(ModelCatalog.get("runner-only").internal_name, "runner-only-model")


if __name__ == "__main__":
    unittest.main()
