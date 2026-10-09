import type { ControlDefinition } from "../types.js";

export const pyWeakOracle: ControlDefinition = {
  id: "py-weak-oracle",
  kind: "weak-oracle",
  label: "slop",
  rationale: "The test names the manual average but asserts only that a result exists and has three items, so a wrong mean still passes.",
  path: "tests/test_rolling.py",
  findings: [
    {
      lineStart: 8,
      lineEnd: 12,
      symbol: "test_rolling_mean_matches_manual_average",
      signal: "symbol_weak_oracle_only",
      tool: "tier-t",
      anchor: "def test_rolling_mean_matches_manual_average(",
      evidence: "assertions check only presence and length",
    },
  ],
  text: `"""Tests for the rolling window statistics."""

import numpy as np

from tskit.rolling import rolling_max, rolling_mean


def test_rolling_mean_matches_manual_average():
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    result = rolling_mean(values, window=3)
    assert result is not None
    assert len(result) == 3


def test_rolling_max_tracks_window_peak():
    values = np.array([3.0, 1.0, 4.0, 1.0, 5.0])
    np.testing.assert_array_equal(rolling_max(values, window=2), [3.0, 4.0, 4.0, 5.0])
`,
};
