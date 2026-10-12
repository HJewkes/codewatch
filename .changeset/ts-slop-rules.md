---
"@codewatch/cli": minor
---

`audit` runs a first TypeScript slop rule pack: 36 ast-grep rules over SCBench's eight verbosity categories (boolean_and_comparison, conditionals, defensive, dict_patterns, loops_and_comprehensions, misc, type_annotations, type_conversions), each naming the scb-check rule it approximates. Findings land in `findings.jsonl` under tool `ast-grep` with signal `ts-slop/<rule>`, and the summary gains `tsVerbosity` (`verbosity_flagged_loc`, `total_loc`, `verbosity`) over `.ts`/`.tsx` files; clone lines still come from scb-check. The pack runs the `ast-grep` binary (never `sg`, which is shadow-utils on many Linux hosts); when it is missing `audit` warns and carries on. `--no-ts-slop` skips the pack.
