import type { ControlDefinition } from "../types.js";

export const pyHelperSlop: ControlDefinition = {
  id: "py-helper-slop",
  kind: "single-caller-helper",
  label: "slop",
  rationale:
    "The helper wraps one subtraction behind a name and docstring that say no more than `nobs - nparams` does at its only call site.",
  path: "econkit/results/summary.py",
  findings: [
    { lineStart: 9, lineEnd: 12, symbol: "_degrees_of_freedom", signal: "symbol-single-caller-helper", tool: "code-graph", anchor: "def _degrees_of_freedom(" },
  ],
  text: `"""Plain-text coefficient tables for fitted linear models."""

from __future__ import annotations

import numpy as np
from scipy import stats


def _degrees_of_freedom(nobs: int, nparams: int) -> int:
    """Return the residual degrees of freedom."""
    df = nobs - nparams
    return df


def coefficient_table(
    names: list[str], params: np.ndarray, std_errors: np.ndarray, nobs: int, debiased: bool = False
) -> str:
    """Render estimates, standard errors, t-statistics and p-values as aligned text.

    With \`\`debiased\`\` the p-values use Student's t with nobs - k degrees of
    freedom; otherwise they use the standard normal.
    """
    tstats = params / std_errors
    if debiased:
        df_resid = _degrees_of_freedom(nobs, params.shape[0])
        pvalues = 2.0 * stats.t.sf(np.abs(tstats), df_resid)
    else:
        pvalues = 2.0 * stats.norm.sf(np.abs(tstats))
    width = max(len(name) for name in names)
    header = f"{'':<{width}}  {'coef':>10}  {'std err':>10}  {'t':>8}  {'P>|t|':>8}"
    rows = [header, "-" * len(header)]
    for name, b, se, t, p in zip(names, params, std_errors, tstats, pvalues):
        rows.append(f"{name:<{width}}  {b:>10.4f}  {se:>10.4f}  {t:>8.3f}  {p:>8.4f}")
    return "\\n".join(rows)
`,
};
