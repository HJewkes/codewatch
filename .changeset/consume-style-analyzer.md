---
"@codewatch/cli": patch
---

Depend on `@titan-design/style-analyzer@^0.1.0` instead of `@codewatch/analyzer`, which is
no longer built from this repo. Files are still parsed by `@codewatch/core`, so the same
files produce the same observation counts. The package carries three fixes that change what
`codewatch analyze`, `init` and `update` report:

- Stability ratings now match the observation types the extractors emit. Fourteen types
  that silently fell back to `medium` are rated `high` as intended: `naming.variable`,
  `.function`, `.type`, `.constant`, `.enum` and `.private-member`;
  `control-flow.guard-clause`, `.array-method` and `.async-await`;
  `documentation.jsdoc-presence`; and `error-handling.try-catch`, `.result-type`,
  `.exhaustive-switch` and `.assert-never`. Their confidence rises from
  `consistency * 0.85` to `consistency`, and some move from `warn` to `error`.
- Python capitals assignments at module scope, including inside a module-level `if`,
  `try`, `except` or `with` block, are reported as `naming.constant` instead of
  `naming.variable`.
- A single capitalised word of two or more characters (`const DAY = 86400`,
  `VERSION = "1.0.0"`) counts as a constant name in TypeScript and Python. A single letter
  such as `T = TypeVar("T")` stays a variable.

A profile generated from the same code therefore carries higher confidences and a
`naming.constant` rule for Python. `codewatch diff` against such a profile no longer
reports these constants as variable-naming deviations, and it grades naming deviations as
errors when the profile rule's confidence is now 0.85 or more.
