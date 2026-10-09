"""Point the runner's model and provider catalogs at explicit configs directories.

The runner looks for `configs/` beside its installed package, and its wheel ships none,
so under this launcher both catalogs would load empty. `preload()` fills them before any
command runs: models from the runner checkout's `configs/models`, then this harness's
vendored `bench/scbench/configs/models` on top (a vendored file wins on a name clash).
`providers.yaml` comes from the vendored dir when it has one, else from the checkout.

Resolution is standard library only, so `prompts/record_manifest.py` can record it.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

RUNNER_CONFIGS_ENV = "SCBENCH_RUNNER_CONFIGS"
DEFAULT_RUNNER_CONFIGS = Path("~/.cache/bs-30/slop-code-bench/configs")
VENDORED_CONFIGS = Path(__file__).resolve().parents[1] / "configs"
PROVIDERS_FILE = "providers.yaml"


class ConfigsNotFound(RuntimeError):
    pass


def runner_configs_dir() -> Path:
    return Path(os.environ.get(RUNNER_CONFIGS_ENV) or DEFAULT_RUNNER_CONFIGS).expanduser()


def providers_file(vendored: Path = VENDORED_CONFIGS, runner: Path | None = None) -> Path:
    for candidate in (vendored / PROVIDERS_FILE, (runner or runner_configs_dir()) / PROVIDERS_FILE):
        if candidate.is_file():
            return candidate
    raise ConfigsNotFound(f"no {PROVIDERS_FILE} in {vendored} or the runner configs; set {RUNNER_CONFIGS_ENV}")


def models_dirs(vendored: Path = VENDORED_CONFIGS, runner: Path | None = None) -> list[Path]:
    """Model directories in load order; later ones override earlier ones."""
    dirs = [d for d in ((runner or runner_configs_dir()) / "models", vendored / "models") if d.is_dir()]
    if not dirs:
        raise ConfigsNotFound(f"no models directory found; set {RUNNER_CONFIGS_ENV}")
    return dirs


def manifest_entry(vendored: Path = VENDORED_CONFIGS, runner: Path | None = None) -> dict:
    vendored_models = sorted((vendored / "models").glob("*.yaml"))
    return {
        "providersFile": str(providers_file(vendored, runner)),
        "modelsDirs": [str(d) for d in models_dirs(vendored, runner)],
        "vendoredModels": {
            f"bench/scbench/configs/models/{p.name}": hashlib.sha256(p.read_bytes()).hexdigest()
            for p in vendored_models
        },
    }


def preload(vendored: Path = VENDORED_CONFIGS, runner: Path | None = None) -> None:
    from slop_code.agent_runner.credentials import ProviderCatalog
    from slop_code.common.llms import ModelCatalog

    ProviderCatalog.clear()
    ProviderCatalog.load_from_file(providers_file(vendored, runner))
    ProviderCatalog._loaded = True
    ModelCatalog.clear()
    for directory in models_dirs(vendored, runner):
        ModelCatalog.load_from_directory(directory)
    ModelCatalog._loaded = True
