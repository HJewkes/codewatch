"""`slop-code` with `claude_code_cw` registered: `python -m agent run ...`.

Spawned workers do not re-run this module; `bootstrap.setup()` reaches them through
the process pools' initializer instead.
"""

from slop_code.entrypoints.cli import app

from agent import bootstrap

bootstrap.setup()

if __name__ == "__main__":
    app()
