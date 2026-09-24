---
"@codewatch/cli": minor
---

`codewatch audit` now stores its findings in graph.db against the snapshot, each keyed and with its excerpt hash. `codewatch triage` carries verdicts forward from the latest earlier judged snapshot, skips questions whose finding already has a verdict, saves its verified verdicts to graph.db, and reports carried, fresh, and skipped-by-verdict counts in triage.json. A rerun on an unchanged tree makes no model calls.
