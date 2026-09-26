---
"@codewatch/cli": minor
---

`codewatch triage` now reads findings through the logged-in `claude` CLI by default (the claude-print harness from `@titan-design/agent` 0.4.0), so it needs no `CLAUDE_CODE_OAUTH_TOKEN`. Pass `--harness sdk` to use the Agent SDK path, which still requires the token. The pre-flight check fails in one line when the chosen harness cannot run, `triage.json` records the harness, the summary says "controls not run" when a fully carried rerun calls no model, and the `--dry-run` help notes that it still carries earlier verdicts forward into graph.db.

Fix: a triage verdict with two or more citations is no longer dropped as `path-not-allowed`; the verifier passed a one-shot iterator of allowed paths that the first citation used up.
