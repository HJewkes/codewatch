"""The A1 `synthesis` stage (design unit U9).

It reads the triage verdicts and the snapshot deltas, asks one Sonnet 5.5 call for a
review rubric of at most 300 words, and writes the two files the codewatch plugin's
SessionStart hook injects at the next checkpoint:

- `.codewatch/rubric.md`: the rubric.
- `.codewatch/session-brief.json`: at most 3 open items (regressions, then ratchet, then
  quality) and the changed symbols whose files have the most importers.

Standard library only: it runs in the A1 image with `codewatch` and `claude` on PATH.
"""
