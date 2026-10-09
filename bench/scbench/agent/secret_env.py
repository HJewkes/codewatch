"""Keep credential values off the `docker exec` command line and out of the log.

The runner's `DockerStreamingRuntime` passes every env var as `--env KEY=VALUE` and
logs those args at VERBOSE, so a token would be readable in the host's process list
and could reach `log.log`. `install()` replaces its `_start_exec_process` with one that
builds the same argv except that credential-like keys go as `--env KEY` (name only).
Their values reach the docker client through Popen's env, which docker reads for a
name-only `--env`. The container sees the same variables, and the claude argv and
prompt are untouched. The runner itself is not edited.
"""

from __future__ import annotations

import os
import re
import subprocess

CREDENTIAL_KEYS = frozenset({
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
})
_CREDENTIAL_PATTERN = re.compile(r"(_TOKEN|_API_KEY|_SECRET|_PASSWORD)$")


def is_credential(key: str) -> bool:
    return key in CREDENTIAL_KEYS or bool(_CREDENTIAL_PATTERN.search(key))


def build_exec(runtime, command: str, env: dict[str, str]) -> tuple[list[str], dict[str, str]]:
    """The runner's `_build_exec_command` argv, with credentials by name; plus their values."""
    container = runtime._ensure_container_running()
    exec_env = runtime.spec.get_full_env(runtime._merge_env(env))
    secrets = {k: str(v) for k, v in exec_env.items() if is_credential(k)}
    args: list[str] = [runtime.spec.docker.binary, "exec", "--workdir", runtime._container_workdir()]
    if runtime.user:
        args.extend(["--user", runtime.user])
    for key, value in exec_env.items():
        args.extend(["--env", key if key in secrets else f"{key}={value}"])
    args.append(container.id)
    args.extend(["/bin/sh", "-c", command])
    return args, secrets


def _start_exec_process(self, command: str, env: dict[str, str]) -> subprocess.Popen[bytes]:
    from slop_code.execution.docker_runtime import streaming

    prepared_command = self._prepare_command(command)
    exec_args, secrets = build_exec(self, prepared_command, env)
    streaming.logger.debug("Built docker exec command", args=exec_args, verbose=True)
    try:
        proc = subprocess.Popen(  # noqa: S603 - argv built from the runner's docker spec.
            exec_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=None,
            env={**os.environ, **secrets},
        )
    except OSError as exc:
        raise streaming.SolutionRuntimeError("Failed to launch docker exec") from exc
    self._active_exec_process = proc
    self._exit_code = None
    return proc


def install() -> None:
    from slop_code.execution.docker_runtime.streaming import DockerStreamingRuntime

    DockerStreamingRuntime._start_exec_process = _start_exec_process
