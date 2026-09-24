# Triage controls

Planted file bundles with known answers. `codewatch triage` sends some of them alongside the real
bundles in every run, and the run's control accuracy decides whether its verdicts are trusted or
marked `provisional`.

## How a control is judged

Each control is one realistic source file plus the finding rows a real `codewatch audit` produces
for it. The reader sees a control exactly as it sees a real bundle, so the path, the code, and the
comments never mention controls or labels (a test enforces this).

- A `slop` control contains code that should change. The correct verdict on every one of its
  findings is `confirmed`.
- A `clean` control contains code that looks flaggable to a hasty reader but is right as written.
  The correct verdict on every one of its findings is `justified`.

`loadControls()` in `controls.ts` derives the expected verdict from the label, so a control cannot
disagree with itself. A slop control answered `justified`, or a clean control answered `confirmed`,
counts as a miss and marks the run provisional. The triage run, not this corpus, decides how `unclear`
counts. The `rationale` field records why the label is right. It is for the person reviewing a
disagreement and is never sent to the reader.

The corpus has one clean and one slop control per question kind: single-caller helper, comment
(narrating or bloated), unnecessary isinstance, and pass-through wrapper. Python only for now.

## Adding a control

1. Write the file as a competent maintainer of that kind of codebase would. Clean controls should
   tempt a wrong `confirmed`; slop controls should look plausible, not like toy examples.
2. Run `codewatch audit` on a scratch repo containing the file and copy the finding rows for signals
   that have a triage question. Leave out mechanical findings (pydoclint, ruff FBT, file size);
   they get no question.
3. Add a module under the language directory (for example `python/`) that exports a
   `ControlDefinition`. Paste the file into `text` as a template literal, escaping backslashes,
   backticks, and `${`. Give each finding an `anchor`: text that appears on its `lineStart` line.
4. Register it in `CONTROL_DEFINITIONS` and keep one clean and one slop control per kind.
5. Run `pnpm test`. The corpus test checks that every cited range lies inside the file, that each
   `lineStart` line contains its anchor, and that a symbol finding spans the whole symbol.
