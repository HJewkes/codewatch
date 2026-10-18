"""`python -m inject --workspace /workspace --plugin-root /opt/codewatch-a1/plugin`.

Prints the stage's report line. Exits 1, with the reason on stderr, when the plugin root
lacks the hook or the MCP server.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import PluginError, enable


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="inject")
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--plugin-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = enable(Path.home(), args.workspace, args.plugin_root)
    except PluginError as error:
        print(f"inject: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
