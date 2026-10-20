"""The behaviour-differential verdict: does the changed program behave as the base does? (C-242)

A case differs when its exit code, stdout, stderr or written files differ between base and head after
normalisation. Normalisation is limited to these documented rules, nothing else:
  N1 paths    the scratch dir and program root are already placeholders ({CASE}, {ROOT}); see replay.
  N2 traceback a stderr holding a Python traceback compares as its final line (exception type and
              message): frame lines and line numbers move under any refactor and are not behaviour.
  N3 flaky    a case whose two base runs differ from each other is nondeterministic. It is excluded
              and counted, never compared; timestamps, ordering and the like are not rewritten.
A difference is spec-required, and does not fail the gate, when either
  S1 the case came from a hidden test that failed at base and passes at head (the hidden tests
     encode the specification), or
  S2 a waiver names the case (or one of its node ids) and quotes a line that appears verbatim in
     that checkpoint's specification.
Every other difference fails the gate, in either tier: the tests' own calls, or the generated variants
(mutate.py). The tiers are counted apart; C-241 cs cp2 r2 reworded only messages no test reaches.
"""

from __future__ import annotations

from pathlib import Path

TRACEBACK = "Traceback (most recent call last):"
FIELDS = ("rc", "stdout", "stderr", "files")


def normalise(outcome: dict) -> dict:
    stderr = outcome["stderr"]
    if TRACEBACK in stderr:
        lines = [line for line in stderr.splitlines() if line.strip()]
        stderr = "<traceback> " + (lines[-1] if lines else "")
    return {**outcome, "stderr": stderr}


def differences(a: dict, b: dict) -> list[str]:
    a, b = normalise(a), normalise(b)
    return [field for field in FIELDS if a[field] != b[field]]


def fixed_tests(regrade: dict | None) -> set[str]:
    if not regrade:
        return set()
    before, after = set(regrade["before"]["hidden"]["failed"]), set(regrade["after"]["hidden"]["failed"])
    return before - after


def valid_waivers(waivers: list[dict], spec_dir: Path | None) -> list[dict]:
    valid = []
    for waiver in waivers:
        spec = spec_dir / f"checkpoint_{waiver.get('spec_checkpoint')}.md" if spec_dir else None
        quote = (waiver.get("quote") or "").strip()
        if quote and spec and spec.is_file() and quote in spec.read_text():
            valid.append(waiver)
    return valid


def _excuse(name: str, case: dict, fixed: set[str], waivers: list[dict]) -> str | None:
    if fixed.intersection(case.get("nodeids", [])):
        return "S1 hidden test fixed"
    for waiver in waivers:
        if waiver.get("case") == name or waiver.get("nodeid") in case.get("nodeids", []):
            return f"S2 spec checkpoint {waiver['spec_checkpoint']}"
    return None


def _tier(case: dict) -> str:
    return "generated" if case.get("source") == "generated" else "tests"


def _classify(name: str, case: dict, runs: dict, fixed: set[str], waivers: list[dict]) -> tuple[str, dict]:
    base, again, head = (runs[side][name] for side in ("base", "base_again", "head"))
    if differences(base, again):
        return "nondeterministic", {}
    fields = differences(base, head)
    if not fields:
        return "same", {}
    excuse = _excuse(name, case, fixed, waivers)
    return ("excused" if excuse else "differs"), {"fields": fields, "excuse": excuse}


def verdict(cases: dict[str, dict], runs: dict[str, dict], regrade: dict | None = None,
            waivers: list[dict] | None = None, spec_dir: Path | None = None) -> dict:
    """`runs` maps base, base_again and head to {case name: outcome}."""
    fixed, ok_waivers = fixed_tests(regrade), valid_waivers(waivers or [], spec_dir)
    tiers = {t: {"cases": 0, "same": 0, "excused": 0, "nondeterministic": 0, "differs": 0} for t in ("tests", "generated")}
    found = []
    for name in sorted(cases):
        tier = _tier(cases[name])
        status, detail = _classify(name, cases[name], runs, fixed, ok_waivers)
        tiers[tier]["cases"] += 1
        tiers[tier][status] += 1
        if detail:
            found.append({"case": name, "tier": tier, "status": status, **detail,
                          "nodeids": cases[name].get("nodeids", []), "parent": cases[name].get("parent"),
                          "edit": cases[name].get("edit_label")})
    return {"pass": not any(t["differs"] for t in tiers.values()), "pass_tests_tier": tiers["tests"]["differs"] == 0,
            "tiers": tiers, "waivers": {"given": len(waivers or []), "valid": len(ok_waivers)}, "differences": found}
