"""The behaviour-differential verdict: does the changed program behave as the base does? (C-242)

A case differs when its exit code, stdout, stderr or written files differ between base and head after
normalisation. Normalisation is limited to these documented rules, nothing else:
  N1 paths    the scratch dir and program root are already placeholders ({CASE}, {ROOT}); see replay.
  N2 traceback a stderr holding a Python traceback compares as its final line (exception type and
              message): frame lines and line numbers move under any refactor and are not behaviour.
  N3 flaky    a case whose two base runs differ from each other is nondeterministic. It is excluded
              and counted, never compared; timestamps, ordering and the like are not rewritten.
  N4 timing   a float value of a timing field (a key naming duration, elapsed, latency, runtime or
              a _s/_ms/_seconds unit, as `"key": 1.5` or `key=1.5`) reads as <t>, in stdout, stderr
              and written text files. Integers and every other field compare as they are; a
              timing float that happens to match across the two base runs is still noise.
Two modes keep the hidden tests out of the loop (the A1 rule: hidden tests and reference solutions
never reach a stage):
  inloop  cases come only from the workspace's own tests/ and generated variants of them; no hidden
          test, hidden result or .evaluation_tests file is read. A hidden case or a regrade is refused.
  eval    (scoring after the fact) may add cases recorded from the hidden tests, and their results.
A difference is spec-required, and does not fail the gate, when
  S2 a waiver names the case (or one of its node ids) and quotes a line that appears verbatim in
     that checkpoint's specification (both modes), or
  S1 eval mode only: the case came from a hidden test that failed at base and passes at head.
Every other difference fails the gate, in any tier: the workspace tests' calls, the hidden tests'
calls (eval), or the generated variants (mutate.py). C-241 cs cp2 r2 reworded only messages that no
workspace test reaches; the generated tier catches it.
"""

from __future__ import annotations

import re
from pathlib import Path

TRACEBACK = "Traceback (most recent call last):"
TIMING = re.compile(r"""(?P<key>["']?\w*(?:duration|elapsed|latency|runtime|_s|_ms|_secs?|_seconds)["']?\s*[:=]\s*)"""
                    r"-?\d+\.\d*(?:[eE][-+]?\d+)?", re.IGNORECASE)
FIELDS = ("rc", "stdout", "stderr", "files")
MODES = ("inloop", "eval")


class LeakageError(ValueError):
    pass


def mask_timing(text: str) -> str:
    return TIMING.sub(r"\g<key><t>", text)


def normalise(outcome: dict) -> dict:
    stderr = outcome["stderr"]
    if TRACEBACK in stderr:
        lines = [line for line in stderr.splitlines() if line.strip()]
        stderr = "<traceback> " + (lines[-1] if lines else "")
    return {**outcome, "stdout": mask_timing(outcome["stdout"]), "stderr": mask_timing(stderr)}


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


def _origin(case: dict) -> str:
    return case.get("parent_source", "tests") if case.get("source") == "generated" else case.get("source", "tests")


def _tier(case: dict) -> str:
    return case["source"] if case.get("source") in ("generated", "hidden") else "tests"


def _check_inloop(cases: dict[str, dict], regrade: dict | None) -> None:
    hidden = sum(1 for c in cases.values() if _origin(c) == "hidden")
    if hidden or regrade:
        raise LeakageError(f"inloop mode got {hidden} hidden-derived case(s)"
                           f"{' and hidden-test results' if regrade else ''}; use eval mode to score with them")


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
            waivers: list[dict] | None = None, spec_dir: Path | None = None, mode: str = "inloop") -> dict:
    """`runs` maps base, base_again and head to {case name: outcome}."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if mode == "inloop":
        _check_inloop(cases, regrade)
    fixed, ok_waivers = fixed_tests(regrade), valid_waivers(waivers or [], spec_dir)
    tiers = {t: {"cases": 0, "same": 0, "excused": 0, "nondeterministic": 0, "differs": 0}
             for t in ("tests", "hidden", "generated")}
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
    return {"mode": mode, "pass": not any(t["differs"] for t in tiers.values()),
            "pass_tests_tier": tiers["tests"]["differs"] == 0,
            "tiers": tiers, "waivers": {"given": len(waivers or []), "valid": len(ok_waivers)}, "differences": found}
