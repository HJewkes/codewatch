"""C-239 prototype: a short, deterministic, change-anchored report for the implementer.

    python -I report.py <base dir> <head dir> [--findings F] [--base-db DB] [--head-db DB] [--json OUT]

Python only. Four sections, each a few lines at most:
  S1 contract   functions whose signature or error sites changed base -> head, with the
                callers and tests that do not mention the change.
  S2 input      per input reader, the optional keys the tests never feed as missing, null or
                empty; per error code, the modes (CLI flags) the tests assert it under.
  S3 attention  one line per complexity-flagged symbol the change touched, ranked by growth.
  S4 tests      test:source ratio, tests per public symbol, private-only and duplicate shares.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scan import Fn, TestFn, cli_flags, functions, tests

COMPLEXITY = {"symbol-cognitive", "symbol-cyclomatic", "symbol-nesting", "C901",
              "PLR0911", "PLR0912", "PLR0914", "PLR0915"}
RATIO_NORM = 1.0  # our repos measure 0.63-1.00 (signal audit 2026-10-20, section 5)
MAX_LINES = {"contract": 4, "input": 5, "attention": 3}


def short(name: str) -> str:
    return name.rsplit(".", 1)[-1]


def mentions(t: TestFn, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", t.text) is not None


def contract(base: dict[str, Fn], head: dict[str, Fn], ts: list[TestFn]) -> list[str]:
    lines = []
    for name in sorted(base.keys() & head.keys(), key=lambda n: head[n].line):
        b, h = base[name], head[name]
        gone = sorted(b.errors - h.errors)
        what = ([f"signature ({b.sig}) -> ({h.sig})"] if b.sig != h.sig else []) + \
               ([f"error sites gone: {', '.join(gone[:3])}"] if gone else [])
        if not what:
            continue
        callers = [g.name for g in head.values() if short(name) in g.calls and g.name != name
                   and g.name in base and base[g.name].source == g.source]
        stale = [f"{t.path}:{t.line}" for t in ts if any(e in t.text for e in gone)]
        lines.append(f"[contract] {name} (line {h.line}): {'; '.join(what)}. "
                     f"Unchanged callers: {', '.join(callers[:4]) or 'none'}. "
                     f"Tests still naming a gone site: {', '.join(stale[:3]) or 'none'}. "
                     f"Verify: decide from the spec whether each gone site must still fail; pin it at the CLI.")
    return lines[:MAX_LINES["contract"]]


def readers_gaps(head: dict[str, Fn], ts: list[TestFn]) -> list[tuple[int, str]]:
    feeds = [d for t in ts for d in t.dicts]
    out = []
    for fn in head.values():
        optional = [k for k, how in fn.keys.items() if how in ("default", "checked")]
        if not optional or len(fn.keys) < 2:
            continue
        fed = [d for d in feeds if len(fn.keys.keys() & d.keys()) >= 2]
        if not fed:
            continue
        gaps = []
        for k in optional:
            classes = {"missing": sum(k not in d for d in fed), "null": sum(d.get(k, 0) is None for d in fed),
                       "empty": sum(d.get(k) in ([], "", {}) for d in fed)}
            never = [c for c, n in classes.items() if n == 0]
            if never:
                gaps.append(f"{k}{' (has a default)' if fn.keys[k] == 'default' else ''}: never {'/'.join(never)}")
        if gaps:
            rank = sum("default" in g for g in gaps) * 10 + len(gaps) - fn.name.startswith("_") * 5
            out.append((rank, (f"[input] {fn.name} (line {fn.line}) reads {len(fn.keys)} keys; "
                              f"the {len(fed)} test inputs it gets: {'; '.join(gaps[:4])}. "
                              "Verify: feed each class through the CLI and pin the spec's answer.")))
    return out


def mode_of(t: TestFn, flag: str) -> bool | None:
    stem = flag.replace("-", "_")
    if stem in t.kwargs:
        return bool(t.kwargs[stem])
    return True if f"--{flag}" in t.text else None


def modes_gaps(head: dict[str, Fn], ts: list[TestFn], flags: set[str]) -> list[tuple[int, str]]:
    codes = sorted({e for fn in head.values() for e in fn.errors if re.fullmatch(r"[A-Z0-9_]+", e)})
    out = []
    for flag in sorted(flags):
        if not any(mode_of(t, flag) is not None for t in ts):
            continue
        for code in codes:
            on = sum(1 for t in ts if code in t.asserted and mode_of(t, flag))
            off = sum(1 for t in ts if code in t.asserted and mode_of(t, flag) is False)
            if on and not off:
                out.append((5, (f"[mode] {code} is asserted only with --{flag} ({on} tests), never without it. "
                               f"Verify: send an input that should give {code} without --{flag}; check the spec.")))
    never = [c for c in codes if not any(c in t.asserted for t in ts)]
    if never:
        out.append((4, f"[input] error codes the code can emit but no test asserts: {', '.join(never)}."))
    return out


def input_classes(head: dict[str, Fn], ts: list[TestFn], flags: set[str]) -> list[str]:
    ranked = sorted(readers_gaps(head, ts) + modes_gaps(head, ts, flags), key=lambda r: -r[0])
    return [line for _, line in ranked][:MAX_LINES["input"]]


def cognitive(db: str | None) -> dict[str, float]:
    if not db or not Path(db).is_file():
        return {}
    c = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    rows = c.execute("select node_id, value from metric where name = 'symbol_cognitive' and "
                     "snapshot_id = (select max(id) from snapshot)").fetchall()
    return {nid.split("#", 1)[1]: v for nid, v in rows if "#" in nid}


def flagged_symbols(findings: str | None) -> Counter:
    hits: Counter = Counter()
    for raw in Path(findings).read_text().splitlines() if findings else []:
        row = json.loads(raw)
        if row.get("signal") not in COMPLEXITY:
            continue
        name = row.get("symbol") or (re.findall(r"`([^`]+)`", row.get("evidence", "")) or [None])[0]
        if name:
            hits[name] += 1
    return hits


def attention(base: dict[str, Fn], head: dict[str, Fn], args) -> list[str]:
    hits, before, after = flagged_symbols(args.findings), cognitive(args.base_db), cognitive(args.head_db)
    rows = []
    for name, n in hits.items():
        full = name if name in head else next((q for q in head if short(q) == name), None)
        if not full or (full in base and base[full].source == head[full].source):
            continue
        b, a = before.get(full), after.get(full, 0)
        was = "new" if b is None else f"{b:g}"
        rows.append((a - (b or 0), (f"[attention] {full} cognitive {was} -> {a:g} this change ({n} rule hits folded). "
                            "Readability only; split only if a finding above needs it.")))
    return [line for _, line in sorted(rows, key=lambda r: -r[0])][:MAX_LINES["attention"]]


def body_shape(text: str) -> str:
    body = text.split("\n", 1)[-1]
    return re.sub(r"\"[^\"]*\"|'[^']*'|\b\d+\b", "L", re.sub(r"\s+", " ", body))


def test_bloat(head: dict[str, Fn], ts: list[TestFn], src_loc: int) -> str:
    test_loc = sum(t.text.count("\n") + 1 for t in ts)
    public = {short(n) for n in head if not any(p.startswith("_") for p in n.split("."))}
    private = {short(n) for n in head} - public
    private_only = sum(1 for t in ts if any(mentions(t, p) for p in private)
                       and not any(mentions(t, p) for p in public) and "main" not in t.text)
    shapes = Counter(body_shape(t.text) for t in ts)
    dup = sum(n - 1 for n in shapes.values() if n > 1)
    ratio, n = test_loc / max(src_loc, 1), max(len(ts), 1)
    flagged = ratio > 2 * RATIO_NORM or private_only / n > 0.3 or dup / n > 0.1
    return (f"[tests] {'BLOAT ' if flagged else ''}{len(ts)} tests, test:source {ratio:.2f} (norm <= {RATIO_NORM:g}), "
            f"{len(ts) / max(len(public), 1):.1f} per public symbol, private-only {private_only / n:.0%}, "
            f"near-duplicate {dup / n:.0%}. Report line, not a fix item.")


def src_lines(fns: dict[str, Fn]) -> int:
    top = [f for n, f in fns.items() if "." not in n]
    return sum(sum(1 for l in f.source.splitlines() if l.strip()) for f in top)


def build(args) -> dict:
    base_dir, head_dir = Path(args.base), Path(args.head)
    base, head, ts = functions(base_dir), functions(head_dir), tests(head_dir)
    sections = {"contract": contract(base, head, ts),
                "input": input_classes(head, ts, cli_flags(head_dir)),
                "attention": attention(base, head, args),
                "tests": [test_bloat(head, ts, src_lines(head))]}
    return {"sections": sections, "count": sum(len(v) for k, v in sections.items() if k != "tests")}


def render(report: dict) -> str:
    lines = [f"codewatch: {report['count']} findings on this change (base = previous checkpoint)"]
    for i, line in enumerate((x for k in ("contract", "input", "attention") for x in report["sections"][k]), 1):
        lines.append(f"{i}. {line}")
    lines += report["sections"]["tests"]
    lines.append("Not reported: single-caller helpers, LOC, lint style, per-helper test gaps.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="report.py")
    p.add_argument("base")
    p.add_argument("head")
    p.add_argument("--findings")
    p.add_argument("--base-db")
    p.add_argument("--head-db")
    p.add_argument("--json")
    args = p.parse_args(argv)
    report = build(args)
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    print(render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
