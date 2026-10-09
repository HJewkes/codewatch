"""The A1 spec-aware commit review (design unit U17).

`python -m review --spec <file> <sha>` asks one no-tools model call whether a commit
changes behaviour the checkpoint spec defines, and prints
`{"verdict": "ok"|"conflict", "spec_line", "reason", ...}` as its last stdout line.
The spec is read from a file outside the workspace and never written anywhere.
"""
