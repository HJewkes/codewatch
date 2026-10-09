"""`slop-code` with `claude_code_cw` registered: `python -m agent run ...`.

The import sits at module level so that spawned problem workers, which re-import
this module, register the agent too.
"""

from slop_code.entrypoints.cli import app

from agent import claude_code_cw  # noqa: F401

if __name__ == "__main__":
    app()
