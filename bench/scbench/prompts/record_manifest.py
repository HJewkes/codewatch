"""Record each arm's prompt template and its sha256 under `prompts` in the run manifest.

Run before a pilot run: `python3 bench/scbench/prompts/record_manifest.py`. The manifest
path defaults match `bench/scbench/image/build.sh`; other keys in the manifest are kept.
It also records, under `runnerConfigs`, which configs the launcher loads its model and
provider catalogs from, with the sha256 of each vendored config file.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
RUNNER_COMMIT = "31ceea3"
STOCK_TEMPLATE = "just-solve.jinja"
A1A_TEMPLATE = "a1a.jinja"
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


def record(manifest: Path, prompts_dir: Path = PROMPTS_DIR, runner_configs: dict | None = None) -> dict:
    data = json.loads(manifest.read_text()) if manifest.is_file() else {}
    data["prompts"] = prompts_entry(prompts_dir)
    if runner_configs is not None:
        data["runnerConfigs"] = runner_configs
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
    entry = record(manifest_path, runner_configs=configs)
    for arm, pin in entry["arms"].items():
        print(f"record_manifest: {arm} {pin['template']} {pin['sha256']}")
    print(f"record_manifest: catalogs from {configs['providersFile']} and {configs['modelsDirs']}")
    for path, sha in configs["vendoredConfigs"].items():
        print(f"record_manifest: {path} {sha}")
    print(f"record_manifest: recorded in {manifest_path}")
