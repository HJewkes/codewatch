"""The checkpoint spec file that `triage --spec` and the review command read.

The runtime has no file API and no stdin, so the spec reaches the container as shell
commands: base64 chunks appended to a mode-600 file outside the workspace. Standard
library only, like `stages.py`.
"""

from __future__ import annotations

import base64
import posixpath
import shlex

SPEC_DIR = "/tmp/cw-spec"
# Base64 characters per command: a multiple of 4, so each chunk decodes on its own, and
# well under the kernel's 128 KiB limit on one argument (`sh -c <command>`).
CHUNK_CHARS = 64_000


def spec_path(spec_dir: str, checkpoint: int) -> str:
    return posixpath.join(spec_dir, f"cp-{checkpoint}.md")


def write_commands(path: str, text: str) -> list[str]:
    encoded = base64.b64encode(text.encode()).decode()
    chunks = [encoded[i:i + CHUNK_CHARS] for i in range(0, len(encoded), CHUNK_CHARS)]
    file, folder = shlex.quote(path), shlex.quote(posixpath.dirname(path))
    # rm first: truncating a leftover file would keep its old mode.
    create = f"umask 077 && mkdir -p {folder} && rm -f {file} && : > {file} && chmod 600 {file}"
    return [create, *(f"printf %s {chunk} | base64 -d >> {file}" for chunk in chunks)]


def delete_command(path: str) -> str:
    return f"rm -f {shlex.quote(path)}"
