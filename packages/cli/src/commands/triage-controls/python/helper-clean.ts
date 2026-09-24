import type { ControlDefinition } from "../types.js";

export const pyHelperClean: ControlDefinition = {
  id: "py-helper-clean",
  kind: "single-caller-helper",
  label: "clean",
  rationale:
    "The helper names a self-contained numerical step (three kernel formulas with their citations) and keeps the estimator's loop readable; inlining it would bury the formulas in hac_covariance.",
  path: "econkit/covariance/kernel.py",
  findings: [
    { lineStart: 8, lineEnd: 25, symbol: "_kernel_weights", signal: "symbol-single-caller-helper", tool: "code-graph", anchor: "def _kernel_weights(" },
  ],
  text: `"""Heteroskedasticity and autocorrelation consistent covariance estimators."""

from __future__ import annotations

import numpy as np


def _kernel_weights(kernel: str, bandwidth: float) -> np.ndarray:
    """Lag weights w_0, ..., w_L for the named kernel.

    Bartlett follows Newey and West (1987); Parzen and quadratic spectral
    follow Andrews (1991), eq. 2.7. \`\`w_0\`\` is always 1.
    """
    lags = np.arange(int(np.floor(bandwidth)) + 1, dtype=float)
    z = lags / (bandwidth + 1.0)
    if kernel == "bartlett":
        return 1.0 - z
    if kernel == "parzen":
        return np.where(z <= 0.5, 1.0 - 6.0 * z**2 + 6.0 * z**3, 2.0 * (1.0 - z) ** 3)
    if kernel == "qs":
        x = 6.0 * np.pi * np.maximum(z, 1e-12) / 5.0
        w = 3.0 / x**2 * (np.sin(x) / x - np.cos(x))
        w[0] = 1.0
        return w
    raise ValueError(f"unknown kernel: {kernel}")


def hac_covariance(moments: np.ndarray, kernel: str = "bartlett", bandwidth: float | None = None) -> np.ndarray:
    """Long-run covariance of the rows of \`\`moments\`\` (nobs by k).

    When \`\`bandwidth\`\` is omitted it defaults to the Newey-West plug-in
    rule, floor(4 * (nobs / 100) ** (2 / 9)).
    """
    nobs = moments.shape[0]
    if bandwidth is None:
        bandwidth = float(np.floor(4.0 * (nobs / 100.0) ** (2.0 / 9.0)))
    weights = _kernel_weights(kernel, bandwidth)
    demeaned = moments - moments.mean(axis=0)
    cov = demeaned.T @ demeaned
    for lag in range(1, weights.shape[0]):
        gamma = demeaned[lag:].T @ demeaned[:-lag]
        cov += weights[lag] * (gamma + gamma.T)
    return cov / nobs
`,
};
