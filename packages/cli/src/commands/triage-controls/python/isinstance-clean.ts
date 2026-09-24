import type { ControlDefinition } from "../types.js";

export const pyIsinstanceClean: ControlDefinition = {
  id: "py-isinstance-clean",
  kind: "unnecessary-isinstance",
  label: "clean",
  rationale:
    "The check guards a public entry point whose argument comes from user configuration, and the docstring says why; pyright is right about the annotation but the annotation is not enforced at runtime.",
  path: "econkit/covariance/bandwidth.py",
  findings: [
    { lineStart: 19, lineEnd: 19, signal: "pyright/reportUnnecessaryIsInstance", tool: "pyright", anchor: "isinstance(kernel, str)" },
  ],
  text: `"""Automatic bandwidth selection for kernel covariance estimators."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

_KERNEL_CONSTANTS = {"bartlett": (1.1447, 1.0 / 3.0), "parzen": (2.6614, 1.0 / 5.0), "qs": (1.3221, 1.0 / 5.0)}


def andrews_bandwidth(residuals: Sequence[float] | np.ndarray, kernel: str = "bartlett") -> float:
    """Andrews (1991) AR(1) plug-in bandwidth for a single residual series.

    \`\`kernel\`\` is case-insensitive. Kernel names usually arrive from user
    configuration, where a missing entry is None rather than a string, so a
    non-string raises TypeError instead of failing inside \`\`str.lower\`\`.
    """
    if not isinstance(kernel, str):
        raise TypeError(f"kernel must be a string, got {type(kernel).__name__}")
    kernel = kernel.lower()
    if kernel not in _KERNEL_CONSTANTS:
        raise ValueError(f"kernel must be one of {sorted(_KERNEL_CONSTANTS)}, got {kernel!r}")
    e = np.asarray(residuals, dtype=float)
    rho = float(e[1:] @ e[:-1] / (e[:-1] @ e[:-1]))
    if kernel == "bartlett":
        alpha = 4.0 * rho**2 / ((1.0 - rho) ** 2 * (1.0 + rho) ** 2)
    else:
        alpha = 4.0 * rho**2 / (1.0 - rho) ** 4
    constant, exponent = _KERNEL_CONSTANTS[kernel]
    return constant * (alpha * e.shape[0]) ** exponent
`,
};
