import type { ControlDefinition } from "../types.js";

export const pyPassThroughClean: ControlDefinition = {
  id: "py-pass-through-clean",
  kind: "pass-through",
  label: "clean",
  rationale:
    "The methods implement Kernel's abstract interface, so long_run_covariance can dispatch on the kernel object, and the module-level weight functions stay usable without one.",
  path: "econkit/covariance/kernels.py",
  findings: [
    { lineStart: 44, lineEnd: 45, symbol: "Bartlett.weights", signal: "symbol-pass-through", tool: "code-graph", anchor: "def weights(" },
    { lineStart: 51, lineEnd: 52, symbol: "Parzen.weights", signal: "symbol-pass-through", tool: "code-graph", anchor: "def weights(" },
  ],
  text: `"""Kernel objects used by the HAC estimators to weight autocovariances."""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


def bartlett_weights(bandwidth: int) -> np.ndarray:
    """Bartlett weights 1 - j / (bandwidth + 1) for j = 0, ..., bandwidth."""
    return 1.0 - np.arange(bandwidth + 1) / (bandwidth + 1.0)


def parzen_weights(bandwidth: int) -> np.ndarray:
    """Parzen weights for j = 0, ..., bandwidth."""
    z = np.arange(bandwidth + 1) / (bandwidth + 1.0)
    return np.where(z <= 0.5, 1.0 - 6.0 * z**2 + 6.0 * z**3, 2.0 * (1.0 - z) ** 3)


class Kernel(ABC):
    """A lag-weighting scheme. Subclasses are registered by \`\`name\`\`."""

    name: str

    @abstractmethod
    def weights(self, bandwidth: int) -> np.ndarray:
        """Weights for lags 0 through \`\`bandwidth\`\`, with weight 1 at lag 0."""

    def long_run_covariance(self, moments: np.ndarray, bandwidth: int) -> np.ndarray:
        """Kernel-weighted sum of the autocovariances of \`\`moments\`\`."""
        w = self.weights(bandwidth)
        e = moments - moments.mean(axis=0)
        cov = e.T @ e
        for lag in range(1, min(w.shape[0], e.shape[0])):
            gamma = e[lag:].T @ e[:-lag]
            cov += w[lag] * (gamma + gamma.T)
        return cov / e.shape[0]


class Bartlett(Kernel):
    name = "bartlett"

    def weights(self, bandwidth: int) -> np.ndarray:
        return bartlett_weights(bandwidth)


class Parzen(Kernel):
    name = "parzen"

    def weights(self, bandwidth: int) -> np.ndarray:
        return parzen_weights(bandwidth)
`,
};
