---
"@codewatch/cli": patch
---

Reframe metric wording. `graph report`, `graph wiki` and the `scary-hotspots` comment that `graph init` writes now credit Adam Tornhill and CodeScene for churn × complexity hotspots, and call them an attention director rather than a risk signal. Report hotspot and unused-export tables gain a LOC column, `graph context` shows a symbol's LOC beside its complexity, and the "Untested risk" section is now "Untested hotspots". `audit` lists `file-lcom4` as a qualitative flag apart from scored findings and leaves it out of per-file finding totals.
