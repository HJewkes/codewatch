import type { ControlDefinition } from "../types.js";

export const pyCommentClean: ControlDefinition = {
  id: "py-comment-clean",
  kind: "comment",
  label: "clean",
  rationale:
    "Each comment shares identifiers with the next statement but carries what the code cannot: the equation reference, why eigh beats eigvals on weak instruments, and what the Fuller alpha values mean.",
  path: "econkit/iv/liml.py",
  findings: [
    { lineStart: 9, lineEnd: 26, symbol: "liml_kappa", signal: "symbol-narrating-comments", tool: "code-graph", anchor: "def liml_kappa(" },
    { lineStart: 29, lineEnd: 33, symbol: "fuller_kappa", signal: "symbol-narrating-comments", tool: "code-graph", anchor: "def fuller_kappa(" },
  ],
  text: `"""Limited information maximum likelihood (LIML) and Fuller estimators."""

from __future__ import annotations

import numpy as np
from scipy import linalg


def liml_kappa(y: np.ndarray, endog: np.ndarray, exog: np.ndarray, instruments: np.ndarray) -> float:
    """Smallest eigenvalue that defines the LIML k-class estimator.

    \`\`y\`\` and \`\`endog\`\` are the dependent and endogenous regressors, \`\`exog\`\`
    the included exogenous regressors, \`\`instruments\`\` the excluded ones.
    """
    z = np.column_stack([exog, instruments])
    ye = np.column_stack([y, endog])
    # Residualize on exog alone and on the full instrument set; kappa is the
    # smallest root of det(W1 - kappa * W) = 0 (Davidson and MacKinnon, 8.87).
    resid_exog = ye - exog @ np.linalg.lstsq(exog, ye, rcond=None)[0]
    resid_full = ye - z @ np.linalg.lstsq(z, ye, rcond=None)[0]
    w1 = resid_exog.T @ resid_exog
    w = resid_full.T @ resid_full
    # eigh on the symmetric pencil, not eigvals on inv(w) @ w1: the product
    # loses symmetry and returns tiny complex parts when instruments are weak.
    eigenvalues = linalg.eigh(w1, w, eigvals_only=True)
    return float(eigenvalues.min())


def fuller_kappa(kappa: float, nobs: int, ninstr: int, alpha: float = 1.0) -> float:
    """Fuller (1977) modification of the LIML kappa."""
    # Subtracting alpha / (nobs - ninstr) is what gives Fuller finite moments;
    # alpha = 1 is approximately median unbiased, alpha = 4 minimizes MSE.
    return kappa - alpha / (nobs - ninstr)
`,
};
