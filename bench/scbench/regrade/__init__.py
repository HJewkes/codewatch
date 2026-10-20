"""Regrade a modified tree against its base checkpoint with the bench's own graders (C-240).

Hidden tests run through the calibrated C-239 harness (`c239/harness/eval.sh`). Erosion and
verbosity come from the same pinned `scb-check` the runner uses (`analysis.inputs`), once on
the whole graded snapshot and once without the tests directory.
"""
