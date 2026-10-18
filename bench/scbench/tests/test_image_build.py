import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from image import artifact
from image.artifact import DirtySource, artifact_sha256, codewatch_entry, image_tag
from prompts.record_manifest import record_codewatch

IMAGE_DIR = Path(artifact.__file__).resolve().parent
AGENT_CONFIG = IMAGE_DIR.parent / "agent" / "claude_code_cw.yaml"
PINNED_BIN = "/opt/codewatch-a1/bin"


def git(repo: Path, *args: str) -> str:
    identity = ["-c", "user.name=agent-x", "-c", "user.email=agent-x@example.invalid"]
    done = subprocess.run(["git", "-C", str(repo), *identity, *args], capture_output=True, text=True, check=True)
    return done.stdout.strip()


def make_source(root: Path) -> Path:
    source = root / "seat-a"
    source.mkdir()
    git(source, "init", "-q")
    (source / "README.md").write_text("synthetic source\n")
    git(source, "add", "-A")
    git(source, "commit", "-qm", "init")
    return source


def make_deploy(root: Path) -> Path:
    deploy = root / "deploy"
    (deploy / "dist").mkdir(parents=True)
    (deploy / "package.json").write_text('{"name": "@codewatch/cli", "version": "0.7.0"}\n')
    (deploy / "dist" / "index.js").write_text("#!/usr/bin/env node\n")
    (deploy / "dist" / "chunk.js").write_text("export {};\n")
    (deploy / "node_modules").mkdir()
    (deploy / "node_modules" / "dep").symlink_to("../dist")
    return deploy


class SourceStateTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.source = make_source(self.root)
        self.deploy = make_deploy(self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def test_a_source_with_an_edited_tracked_file_is_refused(self):
        (self.source / "README.md").write_text("edited\n")
        with self.assertRaises(DirtySource):
            codewatch_entry(self.source, self.deploy)

    def test_a_source_with_an_untracked_file_is_refused(self):
        (self.source / "stray.txt").write_text("x\n")
        with self.assertRaises(DirtySource):
            codewatch_entry(self.source, self.deploy)

    def test_the_check_clean_command_exits_1_on_a_dirty_source(self):
        (self.source / "README.md").write_text("edited\n")
        with mock.patch("sys.stderr"):
            self.assertEqual(artifact.main(["check-clean", str(self.source)]), 1)

    def test_the_manifest_records_the_source_sha_and_the_artifact_hash(self):
        manifest = self.root / "manifest.json"
        manifest.write_text('{"a1Image": {"digest": "sha256:x"}}')

        record_codewatch(manifest, codewatch_entry(self.source, self.deploy))

        data = json.loads(manifest.read_text())
        self.assertEqual(data["codewatch"]["source_sha"], git(self.source, "rev-parse", "HEAD"))
        self.assertIs(data["codewatch"]["dirty"], False)
        self.assertEqual(data["codewatch"]["artifact_sha256"], artifact_sha256(self.deploy))
        self.assertEqual(data["codewatch"]["version"], "0.7.0")
        self.assertEqual(data["a1Image"], {"digest": "sha256:x"})

    def test_the_manifest_refuses_an_entry_from_a_dirty_source(self):
        manifest = self.root / "manifest.json"
        entry = {"source_sha": "a" * 40, "dirty": True, "artifact_sha256": "b" * 64}
        with self.assertRaises(ValueError):
            record_codewatch(manifest, entry)
        self.assertFalse(manifest.exists())


class ArtifactHashTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.deploy = make_deploy(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_the_hash_does_not_depend_on_the_order_the_filesystem_lists_entries(self):
        listed_order = artifact_sha256(self.deploy)
        real_walk = os.walk

        def reversed_walk(top, *args, **kwargs):
            for directory, dirs, files in real_walk(top, *args, **kwargs):
                dirs.reverse()
                yield directory, dirs, list(reversed(files))

        with mock.patch.object(artifact.os, "walk", reversed_walk):
            self.assertEqual(artifact_sha256(self.deploy), listed_order)

    def test_the_hash_changes_with_a_file_byte(self):
        before = artifact_sha256(self.deploy)
        (self.deploy / "dist" / "chunk.js").write_text("export {}; \n")
        self.assertNotEqual(artifact_sha256(self.deploy), before)

    def test_the_hash_changes_with_a_symlink_target(self):
        before = artifact_sha256(self.deploy)
        (self.deploy / "node_modules" / "dep").unlink()
        (self.deploy / "node_modules" / "dep").symlink_to("../other")
        self.assertNotEqual(artifact_sha256(self.deploy), before)


class ImageTagTests(unittest.TestCase):
    def test_the_tag_carries_the_version_and_the_short_sha(self):
        sha = "0123456789abcdef0123456789abcdef01234567"
        self.assertEqual(image_tag("0.7.0", sha), "a1-cw0.7.0-0123456")


class SolvePathTests(unittest.TestCase):
    def test_only_the_codewatch_wrapper_puts_the_pinned_tools_on_path(self):
        dockerfile = (IMAGE_DIR / "Dockerfile").read_text()
        self.assertNotRegex(dockerfile, re.compile(rf"^\s*ENV\b.*PATH.*{re.escape(PINNED_BIN)}", re.MULTILINE))
        self.assertNotRegex(AGENT_CONFIG.read_text(), rf"PATH=[^\s]*{re.escape(PINNED_BIN)}")
        self.assertIn(f'PATH="{PINNED_BIN}:$PATH"', (IMAGE_DIR / "codewatch-wrapper.sh").read_text())

    def test_build_sh_fails_an_image_whose_solve_path_reaches_the_pinned_tools(self):
        build = (IMAGE_DIR / "build.sh").read_text()
        self.assertIn(f'*:{PINNED_BIN}:*) fail "the solve PATH includes {PINNED_BIN}"', build)


if __name__ == "__main__":
    unittest.main()
