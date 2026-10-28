---
"@codewatch/cli": minor
---

audit: entry-input-class signal and input-classes.json; missing-test-kind fires on entry points only. For each Python entry point (console script, `__main__` guard or module, HTTP handler method, or, in a repo with none, a public function its tests call directly), the audit lists which input classes its tests feed: empty input, present, null, missing or empty for each optional key its readers read, each CLI flag on and off, and error codes asserted under only one flag setting or not at all. Every class no test feeds is one `entry-input-class` finding, at most five per entry, ranked.
