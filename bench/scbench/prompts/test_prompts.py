import json
import tempfile
import unittest
from pathlib import Path

from prompts.record_manifest import A1A_TEMPLATE, AGENT_CONFIG, PROMPTS_DIR, STOCK_TEMPLATE, caps_entry, record, template_sha256

try:
    import jinja2
    import jinja2.meta
except ModuleNotFoundError:
    jinja2 = None

# sha256 of configs/prompts/just-solve.jinja at slop-code-bench commit 31ceea3.
STOCK_SHA256 = "663d8920c1f88f30f9fc51ff47328a083a61fd13e6db082a9707613a6aa725e3"
NOTES_BLOCK = (
    "Keep a `NOTES.md` file as a handoff for the next checkpoint: what you built, where it lives,"
    " and what is left. If it already exists, read it first and update it before you finish.\n"
)
TESTS_BLOCK = (
    "Write tests for the specification's examples in a `tests` subdirectory and run them before"
    " you finish. Keep the tests from earlier checkpoints and run them too.\n"
)
FIRST_LINE = "Implement a program that 100% solves the specification. That is all you need to do.\n"
SYNTHETIC_SPEC = """
# Word counter

Write `%%%ENTRYPOINT:entry_command%%% count FILE`, which prints the number of words in FILE.

Example: a file holding `one two  three` prints `3`.
"""


def _source(name):
    return (PROMPTS_DIR / name).read_text()


def _render(name, *, is_continuation, agent_type="claude_code"):
    """Render the way slop_code.agent_runner.runner.get_task_for_checkpoint does at 31ceea3."""
    context = {
        "is_continuation": is_continuation,
        "agent_type": agent_type,
        "agent_version": "2.0.51",
        "model_name": "sonnet-test",
    }
    return jinja2.Template(_source(name)).render(spec=SYNTHETIC_SPEC, **context)


def _with_blocks(a0_text):
    head, sep, tail = a0_text.partition(FIRST_LINE)
    assert sep, "the stock first line moved"
    return head + FIRST_LINE + NOTES_BLOCK + TESTS_BLOCK + tail


class TemplateSourceTest(unittest.TestCase):
    def test_vendored_stock_template_is_the_runner_copy_at_the_pinned_commit(self):
        self.assertEqual(template_sha256(STOCK_TEMPLATE), STOCK_SHA256)

    def test_a1a_source_is_the_stock_source_plus_the_two_blocks(self):
        self.assertEqual(_source(A1A_TEMPLATE), _with_blocks(_source(STOCK_TEMPLATE)))


@unittest.skipIf(jinja2 is None, "jinja2 is not installed")
class RenderedPromptTest(unittest.TestCase):
    def test_a1a_renders_as_a0_plus_the_two_blocks_on_the_first_checkpoint(self):
        a0 = _render(STOCK_TEMPLATE, is_continuation=False)
        a1a = _render(A1A_TEMPLATE, is_continuation=False)
        self.assertIn("Use a virtual environment", a0)
        self.assertEqual(a1a, _with_blocks(a0))

    def test_a1a_renders_as_a0_plus_the_two_blocks_on_a_continuation(self):
        a0 = _render(STOCK_TEMPLATE, is_continuation=True)
        a1a = _render(A1A_TEMPLATE, is_continuation=True)
        self.assertIn("Keep using the same virtual environment", a0)
        self.assertEqual(a1a, _with_blocks(a0))

    def test_a1a_prompt_bytes_do_not_depend_on_the_agent_type(self):
        stock_agent = _render(A1A_TEMPLATE, is_continuation=True, agent_type="claude_code")
        cw_agent = _render(A1A_TEMPLATE, is_continuation=True, agent_type="claude_code_cw")
        self.assertEqual(stock_agent, cw_agent)

    def test_templates_read_only_spec_and_is_continuation(self):
        env = jinja2.Environment()
        for name in (STOCK_TEMPLATE, A1A_TEMPLATE):
            variables = jinja2.meta.find_undeclared_variables(env.parse(_source(name)))
            self.assertEqual(variables, {"spec", "is_continuation"}, name)


class RunnerRenderTest(unittest.TestCase):
    def setUp(self):
        try:
            from slop_code.common import render_prompt
        except ModuleNotFoundError:
            self.skipTest("slop-code-bench is not installed")
        self.render_prompt = render_prompt

    def test_runner_render_gives_a0_plus_the_two_blocks(self):
        def render(name):
            context = {"is_continuation": True, "agent_type": "claude_code", "agent_version": "", "model_name": None}
            return self.render_prompt(SYNTHETIC_SPEC, context, _source(name), "main.py", "python main.py")

        a0 = render(STOCK_TEMPLATE)

        self.assertIn("python main.py count FILE", a0)
        self.assertEqual(render(A1A_TEMPLATE), _with_blocks(a0))


class RecordManifestTest(unittest.TestCase):
    def test_records_each_arm_template_and_sha256_and_keeps_other_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "run" / "manifest.json"
            manifest.parent.mkdir()
            manifest.write_text(json.dumps({"a1Image": {"digest": "sha256:abc"}}))

            record(manifest)

            data = json.loads(manifest.read_text())
        arms = data["prompts"]["arms"]
        self.assertEqual(data["a1Image"], {"digest": "sha256:abc"})
        self.assertEqual(data["prompts"]["runnerCommit"], "31ceea3")
        self.assertEqual(arms["A0"], {"template": "bench/scbench/prompts/just-solve.jinja", "sha256": STOCK_SHA256})
        self.assertEqual(arms["A1a"]["sha256"], template_sha256(A1A_TEMPLATE))
        self.assertEqual(arms["A1"], arms["A1a"])

    def test_creates_the_manifest_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "new" / "manifest.json"

            record(manifest)

            self.assertEqual(set(json.loads(manifest.read_text())), {"prompts"})


class CapsEntryTests(unittest.TestCase):
    def test_the_shipped_config_records_no_budget_flag_the_pinned_cli_and_the_synthesis_limit(self):
        entry = caps_entry()
        self.assertIsNone(entry["budget_usd"])
        self.assertRegex(entry["triage_cli_version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(entry["synthesis_open_items_cap"], 3)
        self.assertEqual(entry["step_limit"], 100)

    def test_an_explicit_budget_flag_is_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "cw.yaml"
            config.write_text(
                "cost_limits:\n  step_limit: 100\nstages:\n  triage:\n    enabled: true\n"
                "    command: codewatch triage /workspace --budget-usd 2.5\n"
            )
            self.assertEqual(caps_entry(config)["budget_usd"], 2.5)

    def test_record_writes_the_caps_beside_the_other_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text('{"a1Image": {"digest": "sha256:x"}}')
            record(manifest, caps={"budget_usd": None})
            data = json.loads(manifest.read_text())
        self.assertEqual(data["caps"], {"budget_usd": None})
        self.assertEqual(data["a1Image"], {"digest": "sha256:x"})


if __name__ == "__main__":
    unittest.main()
