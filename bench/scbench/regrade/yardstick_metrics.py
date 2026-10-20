"""Pinned scorer boundary; only numeric summaries leave anonymous staged trees."""

import json
import math
import subprocess
import tempfile
from pathlib import Path

from analysis.inputs import SCB_CHECK_VERSION, run_scb_check
from regrade.grade import snapshot_root, stage

METRICS = ("erosion", "verbosity", "erosion_ex_tests", "verbosity_ex_tests",
           "cc_total", "source_lines", "cc_total_ex_tests", "source_lines_ex_tests")


class ScoreFailed(Exception):
    """A deliberately path-free failure at the external-tool boundary."""


def _number(report, key):
    value = report.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ScoreFailed("missing or nonfinite metric")
    return value


def complexity(tree):
    worker = Path(__file__).with_name("yardstick_cc.py")
    command = ["uvx", "--from", f"scb-check=={SCB_CHECK_VERSION}", "python", "-I",
               str(worker), str(tree)]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def score(tree, scratch, check=run_scb_check, cc=complexity):
    """Use exactly regrade's snapshot policy and default tests/ exclusion."""
    try:
        with tempfile.TemporaryDirectory(dir=scratch) as work:
            root = snapshot_root(tree)
            full = stage(root, Path(work) / "full" / "snapshot")
            ex = stage(root, Path(work) / "ex" / "snapshot", ("tests",))
            official, excluded, counts, ex_counts = check(full), check(ex), cc(full), cc(ex)
        result = {"erosion": _number(official, "erosion"),
                  "verbosity": _number(official, "verbosity"),
                  "erosion_ex_tests": _number(excluded, "erosion"),
                  "verbosity_ex_tests": _number(excluded, "verbosity"),
                  "cc_total": _number(counts, "cc_total"),
                  "source_lines": _number(official, "total_loc"),
                  "cc_total_ex_tests": _number(ex_counts, "cc_total"),
                  "source_lines_ex_tests": _number(excluded, "total_loc")}
        if result["source_lines"] != _number(counts, "source_lines"):
            raise ScoreFailed("scorer and complexity file populations differ")
        if result["source_lines_ex_tests"] != _number(ex_counts, "source_lines"):
            raise ScoreFailed("tests-excluded file populations differ")
        return result
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError):
        raise ScoreFailed("pinned scoring failed; external details withheld") from None
