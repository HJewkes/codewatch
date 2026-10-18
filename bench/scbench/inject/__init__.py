"""The `inject` stage: turns on the codewatch plugin's SessionStart hook and MCP server for
the next solve session, in the A1 arm only.

The image carries the plugin at `/opt/codewatch-a1/plugin` and enables nothing. This stage
copies the plugin's own SessionStart entry (`hooks/hooks.json`) into the container's
`~/.claude/settings.json` and its MCP server (`.claude-plugin/plugin.json`) into the
user-scope `mcpServers` of `~/.claude.json`, with `${CLAUDE_PLUGIN_ROOT}` resolved. Both get
`GIT_DIR` pointing at the hidden repository (see `git_env`), so the hook and the server see the PR flow's
repo while the solve session itself still sees no git dir. The MCP server is named
`codewatch`, so its tools reach the transcript as `mcp__codewatch__*`.

Neither file is in the workspace, so nothing here is graded. A rerun replaces this stage's
own entries and keeps every other key.
"""

from __future__ import annotations

import json
import shlex
from pathlib import Path

SERVER_NAME = "codewatch"
HOOK_EVENT = "SessionStart"
PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"
HIDDEN_GIT_DIR = Path(".codewatch") / "repo.git"


class PluginError(Exception):
    """The plugin root lacks the hook or MCP entry this stage enables."""


def _read_json(path: Path) -> dict:
    try:
        parsed = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    if not isinstance(parsed, dict):
        raise PluginError(f"{path} does not hold a JSON object")
    return parsed


def _resolve(value: str, plugin_root: Path) -> str:
    return value.replace(PLUGIN_ROOT_VAR, str(plugin_root))


def git_env(git_dir: Path) -> dict[str, str]:
    """`GIT_DIR`, plus `safe.directory=*` as command-line config (as prflow passes `-c`): the
    workspace is a bind mount whose owner may differ from the container user."""
    return {"GIT_DIR": str(git_dir), "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "safe.directory", "GIT_CONFIG_VALUE_0": "*"}


def plugin_hook_entries(plugin_root: Path, git_dir: Path) -> list[dict]:
    """The plugin's SessionStart entries, each command prefixed with `git_env`."""
    entries = _read_json(plugin_root / "hooks" / "hooks.json").get("hooks", {}).get(HOOK_EVENT)
    if not entries:
        raise PluginError(f"{plugin_root} has no {HOOK_EVENT} hook")
    prefix = "".join(f"{key}={shlex.quote(value)} " for key, value in git_env(git_dir).items())
    return [
        {**entry, "hooks": [{**hook, "command": prefix + _resolve(hook["command"], plugin_root)}
                            for hook in entry["hooks"]]}
        for entry in entries
    ]


def plugin_mcp_server(plugin_root: Path, git_dir: Path) -> dict:
    server = _read_json(plugin_root / ".claude-plugin" / "plugin.json").get("mcpServers", {}).get(SERVER_NAME)
    if not server:
        raise PluginError(f"{plugin_root} has no {SERVER_NAME} MCP server")
    return {
        "type": "stdio",
        "command": _resolve(server["command"], plugin_root),
        "args": [_resolve(arg, plugin_root) for arg in server.get("args", [])],
        "env": {**server.get("env", {}), "CLAUDE_PLUGIN_ROOT": str(plugin_root), **git_env(git_dir)},
    }


def _is_ours(entry: dict, plugin_root: Path) -> bool:
    return any(str(plugin_root) in hook.get("command", "") for hook in entry.get("hooks", []))


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def enable(home: Path, workspace: Path, plugin_root: Path) -> dict:
    """Writes the hook and the MCP server into `home`'s Claude config; returns the report line."""
    git_dir = workspace / HIDDEN_GIT_DIR
    hook_entries = plugin_hook_entries(plugin_root, git_dir)
    server = plugin_mcp_server(plugin_root, git_dir)

    settings_path = home / ".claude" / "settings.json"
    settings = _read_json(settings_path)
    hooks = settings.setdefault("hooks", {})
    kept = [entry for entry in hooks.get(HOOK_EVENT, []) if not _is_ours(entry, plugin_root)]
    hooks[HOOK_EVENT] = kept + hook_entries
    _write_json(settings_path, settings)

    config_path = home / ".claude.json"
    config = _read_json(config_path)
    config.setdefault("mcpServers", {})[SERVER_NAME] = server
    _write_json(config_path, config)
    return {"outcome": "enabled", "items_out": len(hook_entries) + 1}
