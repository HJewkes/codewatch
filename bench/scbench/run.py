"""Isolated checkout launcher: python3 -I bench/scbench/run.py <module> [args]."""

import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if len(sys.argv) < 2:
        raise SystemExit("usage: run.py <module> [args]")
    module = sys.argv.pop(1)
    sys.argv[0] = module
    runpy.run_module(module, run_name="__main__")
