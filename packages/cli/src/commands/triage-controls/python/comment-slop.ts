import type { ControlDefinition } from "../types.js";

export const pyCommentSlop: ControlDefinition = {
  id: "py-comment-slop",
  kind: "comment",
  label: "slop",
  rationale:
    "Every comment restates the statement below it in words; deleting all seven loses no information.",
  path: "econkit/panel/within.py",
  findings: [
    { lineStart: 8, lineEnd: 26, symbol: "within_transform", signal: "symbol-narrating-comments", tool: "code-graph", anchor: "def within_transform(" },
  ],
  text: `"""Entity-demeaned (within) transformation for balanced and unbalanced panels."""

from __future__ import annotations

import numpy as np


def within_transform(values: np.ndarray, entity_ids: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    """Subtract the (weighted) entity mean from every column of \`\`values\`\`."""
    # Get the unique entities and the index of each row
    entities, codes = np.unique(entity_ids, return_inverse=True)
    # If weights is None, set weights to ones
    if weights is None:
        weights = np.ones(values.shape[0])
    # Create an array of zeros for the entity sums
    sums = np.zeros((entities.shape[0], values.shape[1]))
    # Create an array of zeros for the weight totals
    totals = np.zeros(entities.shape[0])
    # Loop over each row and add the weighted values to the sums
    for row in range(values.shape[0]):
        sums[codes[row]] += weights[row] * values[row]
        totals[codes[row]] += weights[row]
    # Divide the sums by the totals to get the means
    means = sums / totals[:, None]
    # Subtract the means from the values and return the result
    return values - means[codes]
`,
};
