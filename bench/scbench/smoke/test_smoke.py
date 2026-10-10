import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent.output_guard import RunDirInRepo
from smoke import credential_smoke as smoke

FAKE_TOKEN = "fake-smoke-token-not-real-0123456789"
OUTSIDE = Path("/nonexistent-u10-smoke/run")


class DockerArgvTest(unittest.TestCase):
    def setUp(self):
        self.argv = smoke.docker_argv(OUTSIDE, "img:tag", "scbench-u10-smoke-x")

    def test_the_token_goes_to_docker_by_name_only(self):
        with mock.patch.dict(os.environ, {smoke.TOKEN_ENV: FAKE_TOKEN}):
            argv = smoke.docker_argv(OUTSIDE, "img:tag", "scbench-u10-smoke-x")

        self.assertFalse(any(FAKE_TOKEN in a for a in argv))
        self.assertEqual(argv[argv.index(smoke.TOKEN_ENV) - 1], "-e")

    def test_the_container_runs_like_the_pilot_env_and_never_with_host_network_or_privileges(self):
        self.assertEqual(self.argv[self.argv.index("--user") + 1], "0:0")
        self.assertIn("IS_SANDBOX=1", self.argv)
        self.assertNotIn("--privileged", self.argv)
        self.assertFalse(any(a.startswith("--network") or a == "--net=host" for a in self.argv))

    def test_the_spec_is_mounted_read_only_outside_the_workspace(self):
        mounts = [self.argv[i + 1] for i, a in enumerate(self.argv) if a == "-v"]

        self.assertIn(f"{OUTSIDE / 'spec'}:/spec:ro", mounts)
        self.assertIn(f"{OUTSIDE / 'workspace'}:/workspace", mounts)


class RunGuardTest(unittest.TestCase):
    def test_a_missing_token_stops_before_anything_is_created(self):
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit):
            smoke.run(OUTSIDE, "img:tag")

    def test_a_run_dir_inside_a_checkout_is_refused(self):
        inside = Path(__file__).resolve().parent / "run"
        with mock.patch.dict(os.environ, {smoke.TOKEN_ENV: FAKE_TOKEN}), self.assertRaises(RunDirInRepo):
            smoke.run(inside, "img:tag")


@unittest.skipUnless(shutil.which("git"), "git is not installed")
class PrepareTest(unittest.TestCase):
    def test_the_workspace_is_the_three_file_fixture_committed_with_the_spec_kept_outside(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "run"
            smoke.prepare(out)
            files = sorted(p.relative_to(out / "workspace").as_posix()
                           for p in (out / "workspace").rglob("*") if p.is_file() and ".git" not in p.parts)
            spec_present = (out / "spec" / "spec.md").is_file()

        self.assertEqual(files, ["NOTES.md", "inventory.py", "tests/test_inventory.py"])
        self.assertTrue(spec_present)


class StagesJsonTest(unittest.TestCase):
    def test_report_lines_become_stage_records_and_other_output_is_ignored(self):
        stdout = "\n".join([
            "codewatch: noise",
            json.dumps({"stage": "triage", "status": "ok", "start": 1.0, "end": 2.0, "exit": 0,
                        "tokens": 12, "usd": 0.05, "calls_succeeded": 2}),
            "{not json",
        ])

        rows = smoke.report_lines(stdout)
        record = smoke.stage_record(rows[0]).to_json()

        self.assertEqual(len(rows), 1)
        self.assertEqual(record["stage"], "smoke-triage")
        self.assertEqual((record["tokens"], record["usd"], record["calls_succeeded"]), (12, 0.05, 2))


if __name__ == "__main__":
    unittest.main()
