"""`slop-code` with `claude_code_cw` registered: `python -m agent run ...`.

The setup sits at module level so that spawned problem workers, which re-import
this module, register the agent, load the catalogs and keep tokens off argv too.
"""

from slop_code.entrypoints.cli import app

from agent import claude_code_cw  # noqa: F401
from agent import runner_configs, secret_env

runner_configs.preload()
secret_env.install()

if __name__ == "__main__":
    app()
