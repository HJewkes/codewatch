"""Runs only under the pinned scb-check environment; never executes graded code."""

import importlib.metadata
import json
import sys
from pathlib import Path

from scb_check.analysis.loc import sloc_line_numbers
from scb_check.analysis.parse import ParseError, parse_file
from scb_check.analysis.symbols import extract_functions
from scb_check.config import load_config
from scb_check.walker import walk_python_files


def totals(root):
    if importlib.metadata.version("scb-check") != "0.1.3":
        raise ValueError("unexpected scorer version")
    cc, lines = 0, 0
    for file in sorted(walk_python_files(root, load_config(None, Path.cwd()))):
        try:
            source, tree = parse_file(file)
        except ParseError:
            continue
        sloc = sloc_line_numbers(source, tree)
        lines += len(sloc)
        cc += sum(f.cyc_complexity for f in extract_functions(file, tree, sloc))
    return {"cc_total": cc, "source_lines": lines}


if __name__ == "__main__":
    try:
        print(json.dumps(totals(Path(sys.argv[1]))))
    except Exception:
        raise SystemExit("complexity extraction failed; details withheld") from None
