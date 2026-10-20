"""Synthetic trees for the gate tests: one hot function and four ways to change it."""

from __future__ import annotations

from pathlib import Path


def _arm(kind: str, first: bool) -> str:
    return (f"        {'if' if first else 'elif'} item.kind == \"{kind}\":\n"
            f"            if item.size > 10:\n                out.append(\"big {kind}\")\n"
            f"            elif item.size > 5:\n                out.append(\"mid {kind}\")\n"
            f"            else:\n                out.append(\"small {kind}\")\n")


BASE = ("def handle(items):\n    out = []\n    for item in items:\n"
        + _arm("a", True) + _arm("b", False) + _arm("c", False) + "    return out\n")

# One stage that returns the label: CC 11 -> 5 + 3, one new function, data-coupled.
NARROW = '''\
def handle(items):
    out = []
    for item in items:
        if item.kind == "a":
            out.append(_size_label(item.size, "a"))
        elif item.kind == "b":
            out.append(_size_label(item.size, "b"))
        elif item.kind == "c":
            out.append(_size_label(item.size, "c"))
    return out


def _size_label(size, name):
    if size > 10:
        return "big " + name
    if size > 5:
        return "mid " + name
    return "small " + name
'''

# The same stage writing into the caller's list, which the caller also hands to another call: a bag.
BAG = '''\
def handle(items):
    out = []
    for item in items:
        if item.kind == "a":
            _emit(out, item.size, "a")
        elif item.kind == "b":
            _emit(out, item.size, "b")
        elif item.kind == "c":
            _emit(out, item.size, "c")
    return out


def _emit(out, size, name):
    if size > 10:
        out.append("big " + name)
    elif size > 5:
        out.append("mid " + name)
    else:
        out.append("small " + name)
'''

# A stage whose dispatch re-tests every guard: own-body CC rises by more than the one new function.
RETESTS = NARROW.replace('''    return "small " + name
''', '''    if size <= 5 and size > -1 and size != -2 and size != -3 and size != -4 and size != -5:
        return "small " + name
    return "small " + name
''')

# A cosmetic edit: touched, but no family improves.
COSMETIC = BASE.replace('"big a"', '"large a"')


def write_tree(root: Path, source: str, tests: str = "") -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "app.py").write_text(source)
    if tests:
        (root / "tests").mkdir(exist_ok=True)
        (root / "tests" / "test_app.py").write_text(tests)
    return root
