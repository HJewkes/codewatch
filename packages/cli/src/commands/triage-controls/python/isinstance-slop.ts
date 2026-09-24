import type { ControlDefinition } from "../types.js";

export const pyIsinstanceSlop: ControlDefinition = {
  id: "py-isinstance-slop",
  kind: "unnecessary-isinstance",
  label: "slop",
  rationale:
    "The list is built two lines earlier from string literals and f-strings, so the else branch is unreachable and the loop is a copy.",
  path: "econkit/results/names.py",
  findings: [
    { lineStart: 22, lineEnd: 22, signal: "pyright/reportUnnecessaryIsInstance", tool: "pyright", anchor: "isinstance(name, str)" },
  ],
  text: `"""Default parameter labels for estimators fitted on unlabeled arrays."""

from __future__ import annotations


def exog_names(nvar: int, has_constant: bool, prefix: str = "x") -> list[str]:
    """Labels for the columns of an unlabeled regressor matrix.

    The constant, when present, is assumed to be the first column and is
    labeled \`\`const\`\`; the remaining columns are numbered from 1.
    """
    if nvar < 0:
        raise ValueError("nvar must be non-negative")
    start = 0
    names: list[str] = []
    if has_constant and nvar > 0:
        names.append("const")
        start = 1
    names.extend(f"{prefix}{i}" for i in range(start, nvar))
    labels = []
    for name in names:
        if isinstance(name, str):
            labels.append(name)
        else:
            labels.append(str(name))
    return labels
`,
};
