"""The A1 spec-aware commit review (design unit U17).

`python -m review --spec <file> <sha>` asks one no-tools model call whether a commit
changes behaviour the checkpoint spec defines, and prints
`{"verdict": "ok"|"conflict", "spec_line", "reason", ...}` as its last stdout line.
The spec is read from a file outside the workspace and never written anywhere.
"""

# The image's command line. Hooks split it with shlex and run it with no shell, so the
# environment is set through `env`, not a shell-style `PYTHONPATH=...` prefix.
IMAGE_COMMAND = "env PYTHONPATH=/opt/codewatch-a1 /opt/codewatch-a1/py/bin/python -P -m review"
