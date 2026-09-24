import type { ControlDefinition } from "../types.js";

export const pyPassThroughSlop: ControlDefinition = {
  id: "py-pass-through-slop",
  kind: "pass-through",
  label: "slop",
  rationale:
    "The public wrapper forwards the same three arguments to within_transform under a second name, and its docstring restates the parameter names.",
  path: "econkit/panel/estimate.py",
  findings: [
    { lineStart: 10, lineEnd: 27, symbol: "demean_by_entity", signal: "symbol-pass-through", tool: "code-graph", anchor: "def demean_by_entity(" },
  ],
  text: `"""Convenience entry points for the panel estimators."""

from __future__ import annotations

import numpy as np

from econkit.panel.within import within_transform


def demean_by_entity(values: np.ndarray, entity_ids: np.ndarray, weights: np.ndarray | None) -> np.ndarray:
    """Demean \`\`values\`\` by entity.

    Parameters
    ----------
    values : np.ndarray
        The values to demean.
    entity_ids : np.ndarray
        The entity identifiers.
    weights : np.ndarray or None
        The weights.

    Returns
    -------
    np.ndarray
        The demeaned values.
    """
    return within_transform(values, entity_ids, weights)


def pooled_ols(y: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Pooled least squares coefficients, ignoring the panel structure."""
    return np.linalg.lstsq(x, y, rcond=None)[0]


def fixed_effects(y: np.ndarray, x: np.ndarray, entity_ids: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    """One-way entity fixed-effects coefficients via the within transformation."""
    y_dm = demean_by_entity(y[:, None], entity_ids, weights)[:, 0]
    x_dm = demean_by_entity(x, entity_ids, weights)
    return np.linalg.lstsq(x_dm, y_dm, rcond=None)[0]
`,
};
