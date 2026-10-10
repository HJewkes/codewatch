"""The A1 `synthesis` stage (design units U9 and U9b): the job that ends a checkpoint's PR.

It ratchets the PR head against its merge-base, asks one Sonnet 5.5 call for new taste
lines, and writes:

- `.codewatch/taste.d/cp-N.md`: at most 300 words of taste lines, each ending in a
  provenance tag `{inferred cpN fp:<finding key>}`. A PR never edits `taste.md`; the fold
  job merges fragments into it.
- `.codewatch/session-brief.json`: derived and never committed. New violations and the
  changed symbols whose files have the most importers.
- `.codewatch/audit/pr-report.json`: a `codewatch-pr-report@1`-shaped report, whose
  markdown form is the message of the merge of `cp-N` into `main`.

The codewatch plugin's SessionStart hook injects these at the next checkpoint. Standard
library only: it runs in the A1 image with `codewatch` and `claude` on PATH, and imports
`prflow` from beside it.
"""
