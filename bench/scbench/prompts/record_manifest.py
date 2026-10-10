"""Record each arm's prompt template and its sha256 under `prompts` in the run manifest.

Run before a pilot run: `python3 bench/scbench/prompts/record_manifest.py`. The manifest
path defaults match `bench/scbench/image/build.sh`; other keys in the manifest are kept.
It also records, under `runnerConfigs`, which configs the launcher loads its model and
provider catalogs from, with the sha256 of each vendored config file. Under `caps` it records
the caps the A1 container applies: `budget_usd` (the triage stage's `--budget-usd`, else the
default of the CLI the image pins, else null for no cap) beside `triage_cli_version`,
`synthesis_open_items_cap` (null unless synthesis sets a limit) and the runner's `step_limit`. The carry hook's env caps are not recorded: nothing
passes them into the container.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import sys
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
RUNNER_COMMIT = "31ceea3"
STOCK_TEMPLATE = "just-solve.jinja"
A1A_TEMPLATE = "a1a.jinja"
AGENT_CONFIG = PROMPTS_DIR.parent / "agent" / "claude_code_cw.yaml"
# `codewatch triage` through 0.7.0 defaults --budget-usd to 5; later releases have no default.
CLI_DEFAULT_BUDGET_USD = 5.0
LAST_CLI_WITH_BUDGET_DEFAULT = (0, 7, 0)
DOCKERFILE = PROMPTS_DIR.parent / "image" / "Dockerfile"
ARM_TEMPLATES = {"A0": STOCK_TEMPLATE, "A1a": A1A_TEMPLATE, "A1": A1A_TEMPLATE}


def template_sha256(name: str, prompts_dir: Path = PROMPTS_DIR) -> str:
    return hashlib.sha256((prompts_dir / name).read_bytes()).hexdigest()


def prompts_entry(prompts_dir: Path = PROMPTS_DIR) -> dict:
    return {
        "runnerCommit": RUNNER_COMMIT,
        "arms": {
            arm: {"template": f"bench/scbench/prompts/{name}", "sha256": template_sha256(name, prompts_dir)}
            for arm, name in ARM_TEMPLATES.items()
        },
    }


def _triage_command(config_text: str) -> list[str]:
    """The triage stage's command words; a folded or literal block is joined into one line."""
    block = re.search(r"^ {2}triage:\n((?: {3,}.*\n|\n)*)", config_text, re.MULTILINE)
    command = re.search(r"^ +command:[ \t]*(?:[>|][-+]?)?[ \t]*(.*(?:\n {5,}.*)*)", block.group(1), re.MULTILINE) if block else None
    return shlex.split(" ".join(command.group(1).split())) if command else []


def _flag_value(words: list[str], flag: str) -> float | None:
    return float(words[words.index(flag) + 1]) if flag in words else None


def _triage_budget(config_text: str, cli_version: str | None) -> float | None:
    """The budget the pinned CLI applies: the flag, else the CLI's own default, else no cap."""
    flag = _flag_value(_triage_command(config_text), "--budget-usd")
    if flag is not None:
        return flag
    return CLI_DEFAULT_BUDGET_USD if _version_at_most(cli_version, LAST_CLI_WITH_BUDGET_DEFAULT) else None


def _version_at_most(version: str | None, limit: tuple[int, ...]) -> bool:
    return version is not None and tuple(int(part) for part in version.split(".")) <= limit


def _pinned_cli_version(dockerfile: Path) -> str | None:
    match = re.search(r"^ARG CODEWATCH_VERSION=(\S+)$", dockerfile.read_text(), re.MULTILINE)
    return match.group(1) if match else None


def caps_entry(config: Path = AGENT_CONFIG, dockerfile: Path = DOCKERFILE) -> dict:
    from synthesis.inputs import MAX_OPEN_ITEMS

    text = config.read_text()
    cli_version = _pinned_cli_version(dockerfile)
    step_limit = re.search(r"^ +step_limit: (\d+)$", text, re.MULTILINE)
    return {
        "budget_usd": _triage_budget(text, cli_version),
        "triage_cli_version": cli_version,
        "synthesis_open_items_cap": MAX_OPEN_ITEMS,
        "step_limit": int(step_limit.group(1)) if step_limit else None,
    }


def record(
    manifest: Path, prompts_dir: Path = PROMPTS_DIR, runner_configs: dict | None = None, caps: dict | None = None
) -> dict:
    data = json.loads(manifest.read_text()) if manifest.is_file() else {}
    data["prompts"] = prompts_entry(prompts_dir)
    if runner_configs is not None:
        data["runnerConfigs"] = runner_configs
    if caps is not None:
        data["caps"] = caps
    manifest.parent.mkdir(parents=True, exist_ok=True)
    staging = manifest.with_suffix(".tmp")
    staging.write_text(json.dumps(data, indent=2) + "\n")
    staging.replace(manifest)
    return data["prompts"]


def default_manifest() -> Path:
    if os.environ.get("MANIFEST"):
        return Path(os.environ["MANIFEST"])
    cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    run_dir = Path(os.environ.get("SCBENCH_RUN_DIR") or cache / "codewatch-scbench")
    return run_dir / "manifest.json"


if __name__ == "__main__":
    sys.path.insert(0, str(PROMPTS_DIR.parent))
    from agent.runner_configs import manifest_entry

    manifest_path = default_manifest()
    configs = manifest_entry()
    caps = caps_entry()
    entry = record(manifest_path, runner_configs=configs, caps=caps)
    for arm, pin in entry["arms"].items():
        print(f"record_manifest: {arm} {pin['template']} {pin['sha256']}")
    print(f"record_manifest: catalogs from {configs['providersFile']} and {configs['modelsDirs']}")
    for path, sha in configs["vendoredConfigs"].items():
        print(f"record_manifest: {path} {sha}")
    print(f"record_manifest: caps {json.dumps(caps)}")
    print(f"record_manifest: recorded in {manifest_path}")
