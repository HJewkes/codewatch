"""Corpus selection with Vavrová & Zaytsev 2017's filters, over PyPI projects in download-rank order.

A candidate is kept when it:
  - links a GitHub repository from its PyPI metadata, and that repository is not a fork or archived;
  - is mostly Python: .py is at least MIN_PYTHON_SHARE of the code bytes at the pinned commit;
  - is not under-developed: at least MIN_COMMITS commits and MIN_AUTHORS distinct author emails up to
    the pin, a commit on the default branch within ACTIVE_DAYS of the cut-off date, and production
    SLOC within SLOC_RANGE;
  - pins: its latest PyPI release has a matching git tag (the pin is that tag's commit);
  - is not excluded: sqlglot, duckdb, stub packages, the upstream projects SCBench references
    import, and a repository already in the corpus.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MIN_PYTHON_SHARE = 0.75
MIN_COMMITS = 300
MIN_AUTHORS = 10
ACTIVE_DAYS = 365
SLOC_RANGE = (2_000, 300_000)
ALWAYS_EXCLUDED = frozenset({"sqlglot", "duckdb"})
CODE_EXTENSIONS = (".py", ".pyx", ".pxd", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".rs", ".go", ".js",
                   ".ts", ".java", ".f", ".f90", ".m", ".swift", ".zig")
GITHUB = re.compile(r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)", re.I)
URL_KEYS = ("source", "source code", "repository", "code", "github", "homepage", "home")
IMPORT_TO_PYPI = {"yaml": "pyyaml", "bs4": "beautifulsoup4", "pil": "pillow", "dateutil": "python-dateutil",
                  "sklearn": "scikit-learn", "jose": "python-jose", "dotenv": "python-dotenv", "attr": "attrs",
                  "magic": "python-magic", "multipart": "python-multipart", "google": "protobuf", "ruamel": "ruamel-yaml"}


def normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass(frozen=True)
class Stats:
    fork: bool
    archived: bool
    python_share: float
    commits: int
    authors: int
    days_since_commit: int
    sloc: int


def rejection(stats: Stats) -> str | None:
    """Why a pinned candidate fails the filters, or None when it passes."""
    checks = (
        (stats.fork, "fork"),
        (stats.archived, "archived"),
        (stats.python_share < MIN_PYTHON_SHARE, f"python share {stats.python_share:.2f}"),
        (stats.commits < MIN_COMMITS, f"{stats.commits} commits"),
        (stats.authors < MIN_AUTHORS, f"{stats.authors} authors"),
        (stats.days_since_commit > ACTIVE_DAYS, f"inactive {stats.days_since_commit} days"),
        (not SLOC_RANGE[0] <= stats.sloc <= SLOC_RANGE[1], f"production SLOC {stats.sloc}"),
    )
    return next((reason for failed, reason in checks if failed), None)


def excluded_name(name: str, upstream: frozenset[str]) -> bool:
    n = normalise(name)
    return n in ALWAYS_EXCLUDED or n in upstream or n.startswith("types-") or n.endswith("-stubs")


def github_repo(info: dict) -> str | None:
    """owner/repo of the GitHub repository a PyPI project's metadata links, preferring source links."""
    urls = {k.lower(): v for k, v in (info.get("project_urls") or {}).items() if v}
    if info.get("home_page"):
        urls.setdefault("home", info["home_page"])
    ordered = [urls[k] for k in URL_KEYS if k in urls] + list(urls.values())
    for url in ordered:
        match = GITHUB.match(url)
        if match:
            return f"{match.group(1)}/{match.group(2).removesuffix('.git')}".lower()
    return None


def tag_candidates(name: str, version: str) -> list[str]:
    names = {name, normalise(name), normalise(name).replace("-", "_")}
    plain = [version, f"v{version}", f"release-{version}", f"version-{version}", f"release/{version}"]
    return plain + [f"{n}{sep}{v}" for n in sorted(names) for sep in ("-", "_", "/", "@", "==")
                    for v in (version, f"v{version}")]


def match_tag(tags: list[str], name: str, version: str) -> str | None:
    lower = {t.lower(): t for t in tags}
    for candidate in tag_candidates(name, version):
        if candidate.lower() in lower:
            return lower[candidate.lower()]
    return None


def python_share(sizes: dict[str, int]) -> float:
    """Share of .py bytes among code-file bytes, from a path -> blob size map."""
    code = {p: s for p, s in sizes.items() if p.lower().endswith(CODE_EXTENSIONS)}
    total = sum(code.values())
    return sum(s for p, s in code.items() if p.endswith(".py")) / total if total else 0.0


def upstream_names(import_names: set[str], local: set[str], stdlib: frozenset[str]) -> frozenset[str]:
    """PyPI names for the third-party top-level imports of a set of reference solutions."""
    third = {n for n in import_names if n not in stdlib and n not in local and not n.startswith("_")}
    return frozenset(normalise(IMPORT_TO_PYPI.get(n.lower(), n)) for n in third)
