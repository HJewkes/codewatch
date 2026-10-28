"""Record each arm's prompt template and its sha256 under `prompts` in the run manifest.

Run before a pilot run: `python3 bench/scbench/prompts/record_manifest.py`. The manifest
path defaults match `bench/scbench/image/build.sh`; other keys in the manifest are kept.
A1's entry also pins its agent config, `agent/claude_code_cw.a1.yaml`, by sha256.
build.sh runs `record_manifest.py --codewatch <entry.json>`, which records the image's
`codewatch` entry (source sha, `dirty: false` and the deploy artifact's sha256; see
`image/artifact.py`) and recomputes `caps` from it, so caps never describe an earlier build.
It also records, under `runnerConfigs`, which configs the launcher loads its model and
provider catalogs from, with the sha256 of each vendored config file. Under `caps` it records
the caps the A1 container applies: `budget_usd` (the triage stage's `--budget-usd`, else the
default of the CLI the image pins, else null for no cap) beside `triage_cli_version` and
`triage_cli_source_sha`, read from the manifest's `codewatch` entry,
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
BENCH_DIR = PROMPTS_DIR.parent
# The A1 arm's agent config, every stage on. A0 and A1a run the runner's stock claude_code.yaml.
AGENT_CONFIG = BENCH_DIR / "agent" / "claude_code_cw.a1.yaml"
ARM_CONFIGS = {"A1": AGENT_CONFIG}
# `codewatch triage` through 0.7.0 defaults --budget-usd to 5; later releases have no default.
# A source build keeps the last release's version string, so its sha decides instead: build.sh's
# smoke test fails an image whose triage still has a budget default.
CLI_DEFAULT_BUDGET_USD = 5.0
LAST_CLI_WITH_BUDGET_DEFAULT = (0, 7, 0)
ARM_TEMPLATES = {"A0": STOCK_TEMPLATE, "A1a": A1A_TEMPLATE, "A1": A1A_TEMPLATE}


def template_sha256(name: str, prompts_dir: Path = PROMPTS_DIR) -> str:
    return hashlib.sha256((prompts_dir / name).read_bytes()).hexdigest()


def prompts_entry(prompts_dir: Path = PROMPTS_DIR) -> dict:
    return {
        "runnerCommit": RUNNER_COMMIT,
        "arms": {
            arm: {"template": f"bench/scbench/prompts/{name}", "sha256": template_sha256(name, prompts_dir),
                  **_config_pin(ARM_CONFIGS.get(arm))}
            for arm, name in ARM_TEMPLATES.items()
        },
    }


def _config_pin(config: Path | None) -> dict:
    if config is None:
        return {}
    return {"agentConfig": f"bench/scbench/{config.relative_to(BENCH_DIR).as_posix()}",
            "agentConfigSha256": hashlib.sha256(config.read_bytes()).hexdigest()}


def _triage_command(config_text: str) -> list[str]:
    """The triage stage's command words; a folded or literal block is joined into one line."""
    block = re.search(r"^ {2}triage:\n((?: {3,}.*\n|\n)*)", config_text, re.MULTILINE)
    command = re.search(r"^ +command:[ \t]*(?:[>|][-+]?)?[ \t]*(.*(?:\n {5,}.*)*)", block.group(1), re.MULTILINE) if block else None
    return shlex.split(" ".join(command.group(1).split())) if command else []


def _flag_value(words: list[str], flag: str) -> float | None:
    return float(words[words.index(flag) + 1]) if flag in words else None


def _triage_budget(config_text: str, cli: dict) -> float | None:
    """The budget the pinned CLI applies: the flag, else the CLI's own default, else no cap."""
    flag = _flag_value(_triage_command(config_text), "--budget-usd")
    if flag is not None:
        return flag
    released_with_default = not cli.get("source_sha") and _version_at_most(cli.get("version"), LAST_CLI_WITH_BUDGET_DEFAULT)
    return CLI_DEFAULT_BUDGET_USD if released_with_default else None


def _version_at_most(version: str | None, limit: tuple[int, ...]) -> bool:
    return version is not None and tuple(int(part) for part in version.split(".")) <= limit


def caps_entry(config: Path = AGENT_CONFIG, cli: dict | None = None) -> dict:
    """`cli` is the manifest's `codewatch` entry, which build.sh writes for the image."""
    from synthesis.inputs import MAX_OPEN_ITEMS

    cli = cli or {}
    text = config.read_text()
    step_limit = re.search(r"^ +step_limit: (\d+)$", text, re.MULTILINE)
    return {
        "budget_usd": _triage_budget(text, cli),
        "triage_cli_version": cli.get("version"),
        "triage_cli_source_sha": cli.get("source_sha"),
        "synthesis_open_items_cap": MAX_OPEN_ITEMS,
        "step_limit": int(step_limit.group(1)) if step_limit else None,
    }


def _read(manifest: Path) -> dict:
    return json.loads(manifest.read_text()) if manifest.is_file() else {}


def _write(manifest: Path, data: dict) -> None:
    manifest.parent.mkdir(parents=True, exist_ok=True)
    staging = manifest.with_suffix(".tmp")
    staging.write_text(json.dumps(data, indent=2) + "\n")
    staging.replace(manifest)


def record(
    manifest: Path, prompts_dir: Path = PROMPTS_DIR, runner_configs: dict | None = None, caps: dict | None = None
) -> dict:
    data = _read(manifest)
    data["prompts"] = prompts_entry(prompts_dir)
    if runner_configs is not None:
        data["runnerConfigs"] = runner_configs
    if caps is not None:
        data["caps"] = caps
    _write(manifest, data)
    return data["prompts"]


def record_codewatch(manifest: Path, entry: dict) -> None:
    """Records the image's CLI artifact; a dirty source never pins a build, so it is refused."""
    if entry.get("dirty") is not False or not entry.get("source_sha") or not entry.get("artifact_sha256"):
        raise ValueError(f"not a clean, hashed codewatch artifact: {entry}")
    data = _read(manifest)
    data["codewatch"] = entry
    _write(manifest, data)


def record_build(manifest: Path, entry: dict) -> None:
    """A new build changes the CLI the caps were read from, so they are recomputed with it."""
    record_codewatch(manifest, entry)
    data = _read(manifest)
    data["caps"] = caps_entry(cli=entry)
    _write(manifest, data)


def default_manifest() -> Path:
    if os.environ.get("MANIFEST"):
        return Path(os.environ["MANIFEST"])
    cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    run_dir = Path(os.environ.get("SCBENCH_RUN_DIR") or cache / "codewatch-scbench")
    return run_dir / "manifest.json"


if __name__ == "__main__":
    sys.path.insert(0, str(PROMPTS_DIR.parent))

if __name__ == "__main__" and sys.argv[1:2] == ["--codewatch"]:
    record_build(default_manifest(), json.loads(Path(sys.argv[2]).read_text()))
    print(f"record_manifest: codewatch artifact and caps recorded in {default_manifest()}")
elif __name__ == "__main__":
    from agent.runner_configs import manifest_entry

    manifest_path = default_manifest()
    configs = manifest_entry()
    caps = caps_entry(cli=_read(manifest_path).get("codewatch"))
    entry = record(manifest_path, runner_configs=configs, caps=caps)
    for arm, pin in entry["arms"].items():
        print(f"record_manifest: {arm} {pin['template']} {pin['sha256']}")
        if "agentConfig" in pin:
            print(f"record_manifest: {arm} {pin['agentConfig']} {pin['agentConfigSha256']}")
    print(f"record_manifest: catalogs from {configs['providersFile']} and {configs['modelsDirs']}")
    for path, sha in configs["vendoredConfigs"].items():
        print(f"record_manifest: {path} {sha}")
    print(f"record_manifest: caps {json.dumps(caps)}")
    print(f"record_manifest: recorded in {manifest_path}")
