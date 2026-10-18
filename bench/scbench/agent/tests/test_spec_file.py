import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from agent.spec_file import delete_command, spec_path, write_commands

ARG_MAX_ONE = 128 * 1024


def run_sh(command):
    subprocess.run(["/bin/sh", "-c", command], check=True, capture_output=True)


class SpecFileCommandsTest(unittest.TestCase):
    def test_a_spec_longer_than_one_argument_arrives_whole_as_a_private_file(self):
        text = "Checkpoint 3: the total line uses two decimals — 'é' $HOME `x`\n" * 4000
        with tempfile.TemporaryDirectory() as tmp:
            path = spec_path(f"{tmp}/cw-spec", 3)
            commands = write_commands(path, text)

            for command in commands:
                run_sh(command)

            self.assertEqual(Path(path).read_text(encoding="utf-8"), text)
            self.assertEqual(stat.S_IMODE(Path(path).stat().st_mode), 0o600)
            self.assertGreater(len(commands), 3)
            self.assertTrue(all(len(c.encode()) < ARG_MAX_ONE for c in commands))

    def test_a_leftover_file_is_replaced_with_mode_600_and_then_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(spec_path(tmp, 1))
            path.write_text("stale and much longer than the new spec\n")
            path.chmod(0o644)

            for command in write_commands(str(path), "new\n"):
                run_sh(command)
            mode = stat.S_IMODE(path.stat().st_mode)
            text = path.read_text()
            run_sh(delete_command(str(path)))

            self.assertEqual((text, mode), ("new\n", 0o600))
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
