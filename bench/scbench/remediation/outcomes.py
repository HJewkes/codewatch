"""C-280 S1: the outcome key of a test's direct calls into the entry module, measure only.

A pytest plugin (`-p remediation.outcomes`) wraps each module-level function and each method
of each module-level class of the entry module. The wrapper records an event only when its
caller's file is under the tests directory: a direct call from a test or a test helper. Calls
made inside the module are not recorded. Events are written per pytest node id to a jsonl file
at `pytest_runtest_logfinish`. Environment: `SCB_OUTCOMES_OUT` (the jsonl path),
`SCB_OUTCOMES_ENTRY` (the entry file; default: the one top-level non-test `.py` of the
rootdir), `SCB_OUTCOMES_TESTS` (the tests directory, default `tests`).

Key = `callee|outcome|boundary`, no raw value in it.

- `callee`: the qualified name, e.g. `parse_rule` or `Lexer.next`.
- `outcome` is exactly one of:
  - `raise:<type qualname>:<message class>`. The message class:
    1. lowercase the message;
    2. replace each `0x[0-9a-f]+` with `@`;
    3. replace each digit run with `#`;
    4. keep a quoted fragment `'x'`/`"x"` only if `x` appears as a string constant in the entry
       module's AST (a schema or field name such as `'fix'`); replace any other quoted
       fragment with `Q`;
    5. collapse whitespace and keep the first 8 tokens.
    So `"'fix' must be an object"` and `"'rule' must be an object"` stay distinct, while
    `"unknown op 'zz'"` and `"unknown op 'qq'"` collapse.
  - `bool:true` / `bool:false`;
  - `none`;
  - `return:<shape>:<alias>`. Shape:
    - `int`/`float` -> `neg|zero|pos|nan|inf`;
    - `str` -> `empty|ascii|nonascii|multiline`;
    - `list|tuple|dict|set` -> type + `0|1|n` + the shape of the first element (one level
      deep); tuples of length <= 4 instead carry the shape of each position, so `(3, None)`
      differs from `(3, 4)`;
    - any other object -> its class name.
    Alias: `same` if the result `is` an argument, `equal` if `==` to an argument, `new`
    otherwise.
- `boundary`: for the first two positional arguments that are scalars of the same type (int,
  float, str or bool), `lt|eq|gt`; otherwise `-`.

Two readings the spec leaves open: in step 4 the module's string constants are lowercased and
digit-masked like the message before the comparison; and for an immutable scalar result
(None, bool, int, float, str, bytes) the alias ignores `is`, which only reflects interning.
A skipped wrap (a dunder other than `__init__`, a coroutine, a property) is listed in
`<out>.skipped`. Out of scope: subprocess tests (no keys), nested or closure functions, yielded values.
"""

from __future__ import annotations

import ast
import functools
import importlib
import importlib.machinery
import inspect
import json
import math
import os
import re
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

SCALARS = (bool, int, float, str)
IMMUTABLE = (type(None), bool, int, float, str, bytes)
MESSAGE_TOKENS = 8
HEX = re.compile(r"0x[0-9a-f]+")
DIGITS = re.compile(r"\d+")
QUOTED = re.compile(r"'([^']*)'|\"([^\"]*)\"")


def _mask(text: str) -> str:
    return DIGITS.sub("#", HEX.sub("@", text.lower()))


def message_class(message: str, literals: Iterable[str]) -> str:
    known = {_mask(x) for x in literals}

    def quoted(match: re.Match[str]) -> str:
        inner = match.group(1) if match.group(1) is not None else match.group(2)
        return f"'{inner}'" if inner in known else "Q"

    return " ".join(QUOTED.sub(quoted, _mask(message)).split()[:MESSAGE_TOKENS])


def _number(value: float) -> str:
    if math.isnan(value):
        return "nan"
    if math.isinf(value):
        return "inf"
    return "neg" if value < 0 else "zero" if value == 0 else "pos"


def _text(value: str) -> str:
    if not value:
        return "empty"
    if "\n" in value:
        return "multiline"
    return "ascii" if value.isascii() else "nonascii"


def _leaf(value: object) -> str:
    if value is None:
        return "none"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int | float):
        return _number(value)
    if isinstance(value, str):
        return _text(value)
    return type(value).__name__


def _first(value: object) -> object:
    if isinstance(value, dict):
        return next(iter(value.values()))
    if isinstance(value, set | frozenset):
        return min(value, key=lambda x: (type(x).__name__, repr(x)))
    return next(iter(value))  # type: ignore[call-overload]


def shape(value: object) -> str:
    if not isinstance(value, list | tuple | dict | set | frozenset):
        return _leaf(value)
    name = type(value).__name__
    size = len(value)
    if isinstance(value, tuple) and size <= 4:
        return f"{name}({','.join(_leaf(x) for x in value)})"
    return f"{name}:{'01n'[min(size, 2)]}" + (f":{_leaf(_first(value))}" if size else "")


def _same_value(result: object, arg: object) -> bool:
    try:
        return type(result) is type(arg) and bool(result == arg)
    except Exception:  # noqa: BLE001 - a test object's __eq__ may raise anything
        return False


def alias(result: object, args: Iterable[object]) -> str:
    args = list(args)
    if not isinstance(result, IMMUTABLE) and any(result is a for a in args):
        return "same"
    return "equal" if any(_same_value(result, a) for a in args) else "new"


def boundary(args: tuple[object, ...]) -> str:
    if len(args) < 2 or type(args[0]) is not type(args[1]) or not isinstance(args[0], SCALARS):
        return "-"
    left, right = args[0], args[1]
    if left == right:
        return "eq"
    return "lt" if left < right else "gt" if left > right else "-"  # type: ignore[operator]


def outcome(result: object, args: tuple[object, ...], kwargs: dict[str, object]) -> str:
    if result is None:
        return "none"
    if isinstance(result, bool):
        return f"bool:{str(result).lower()}"
    return f"return:{shape(result)}:{alias(result, [*args, *kwargs.values()])}"


def raised(error: BaseException, literals: Iterable[str]) -> str:
    return f"raise:{type(error).__qualname__}:{message_class(str(error), literals)}"


def outcome_key(callee: str, result: str, args: tuple[object, ...]) -> str:
    return f"{callee}|{result}|{boundary(args)}"


def read_keys(path: Path) -> dict[str, frozenset[str]]:
    """The outcome keys per pytest node id from a plugin jsonl; a node id repeated across
    lines (a rerun) is merged."""
    keys: dict[str, set[str]] = {}
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return {}
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        keys.setdefault(row["node"], set()).update(row["keys"])
    return {node: frozenset(found) for node, found in keys.items()}


def string_constants(source: str) -> set[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    return {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


class Recorder:
    """Wraps the entry module and collects the keys of the running test."""

    def __init__(self, entry: Path, tests_dir: Path, out: Path) -> None:
        self.entry = entry.resolve()
        self.tests = str(tests_dir.resolve()) + os.sep
        self.out = out
        self.literals = string_constants(entry.read_text(errors="replace"))
        self.current: set[str] | None = None
        self.busy = False
        self.skipped: list[str] = []
        self.wrapped: set[int] = set()

    def from_test(self, frame: object) -> bool:
        return self.current is not None and not self.busy and frame.f_code.co_filename.startswith(self.tests)  # type: ignore[attr-defined]

    def record(self, callee: str, args: tuple[object, ...], kwargs: dict[str, object], result: object = None,
               error: BaseException | None = None) -> None:
        self.busy = True
        try:
            what = raised(error, self.literals) if error is not None else outcome(result, args, kwargs)
            self.current.add(outcome_key(callee, what, args))  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001 - recording must never fail the test
            self.skipped.append(f"record:{callee}")
        finally:
            self.busy = False

    def wrap(self, fn: Callable[..., object], callee: str, drop_self: bool) -> Callable[..., object]:
        @functools.wraps(fn)
        def wrapper(*args: object, **kwargs: object) -> object:
            if not self.from_test(sys._getframe(1)):
                return fn(*args, **kwargs)
            shown = args[1:] if drop_self else args
            try:
                result = fn(*args, **kwargs)
            except Exception as error:
                self.record(callee, shown, kwargs, error=error)
                raise
            self.record(callee, shown, kwargs, result)
            return result

        return wrapper

    def wrap_module(self, module: object) -> None:
        if id(module) in self.wrapped:
            return
        self.wrapped.add(id(module))
        name = module.__name__  # type: ignore[attr-defined]
        for attr, value in list(vars(module).items()):
            if inspect.isfunction(value) and value.__module__ == name:
                self.swap(module, attr, value, attr, False)
            elif inspect.isclass(value) and value.__module__ == name:
                self.wrap_class(value)

    def swap(self, owner: object, attr: str, value: object, callee: str, drop_self: bool) -> None:
        if attr.startswith("__") and attr.endswith("__") and attr != "__init__":
            return self.skip(callee, "dunder")
        if inspect.iscoroutinefunction(value):
            return self.skip(callee, "coroutine")
        try:
            setattr(owner, attr, self.wrap(value, callee, drop_self))  # type: ignore[arg-type]
        except (AttributeError, TypeError) as error:
            self.skip(callee, f"setattr {type(error).__name__}")

    def swap_bound(self, cls: type, attr: str, value: staticmethod | classmethod, callee: str) -> None:  # type: ignore[type-arg]
        wrapped = self.wrap(value.__func__, callee, isinstance(value, classmethod))
        try:
            setattr(cls, attr, type(value)(wrapped))
        except (AttributeError, TypeError) as error:
            self.skip(callee, f"setattr {type(error).__name__}")

    def wrap_class(self, cls: type) -> None:
        for attr, value in list(vars(cls).items()):
            callee = f"{cls.__qualname__}.{attr}"
            if inspect.isfunction(value):
                self.swap(cls, attr, value, callee, True)
            elif isinstance(value, staticmethod | classmethod):
                self.swap_bound(cls, attr, value, callee)
            elif isinstance(value, property):
                self.skip(callee, "property")

    def skip(self, callee: str, why: str) -> None:
        self.skipped.append(f"{callee}: {why}")

    def begin(self) -> None:
        self.current = set()

    def end(self, node: str) -> None:
        keys, self.current = sorted(self.current or ()), None
        with self.out.open("a") as handle:
            handle.write(json.dumps({"node": node, "keys": keys}) + "\n")

    def write_skipped(self) -> None:
        self.out.with_name(self.out.name + ".skipped").write_text("\n".join(self.skipped) + "\n")


RECORDER: Recorder | None = None


def default_entry(root: Path) -> Path | None:
    found = [p for p in sorted(root.glob("*.py")) if p.name not in {"conftest.py", "setup.py"}
             and not p.name.startswith("test")]
    return found[0] if len(found) == 1 else None


def _install_exec_hook(recorder: Recorder) -> None:
    """Tests that load the entry file by path execute a fresh copy of it each time; wrap each."""
    original = importlib.machinery.SourceFileLoader.exec_module

    def exec_module(self: importlib.machinery.SourceFileLoader, module: object) -> None:
        original(self, module)  # type: ignore[arg-type]
        if Path(self.path).resolve() == recorder.entry:
            recorder.wrap_module(module)

    importlib.machinery.SourceFileLoader.exec_module = exec_module  # type: ignore[method-assign]


def pytest_configure(config: object) -> None:
    global RECORDER
    out = os.environ.get("SCB_OUTCOMES_OUT")
    root = Path(str(config.rootpath))  # type: ignore[attr-defined]
    entry = Path(os.environ["SCB_OUTCOMES_ENTRY"]) if os.environ.get("SCB_OUTCOMES_ENTRY") else default_entry(root)
    if not out or entry is None:
        return
    Path(out).unlink(missing_ok=True)
    RECORDER = Recorder(entry, root / os.environ.get("SCB_OUTCOMES_TESTS", "tests"), Path(out))
    _install_exec_hook(RECORDER)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        RECORDER.wrap_module(importlib.import_module(entry.stem))
    except Exception as error:  # noqa: BLE001 - the entry's import errors surface in its own tests
        RECORDER.skip(entry.stem, f"import {type(error).__name__}")


def pytest_runtest_logstart(nodeid: str, location: object) -> None:
    if RECORDER:
        RECORDER.begin()


def pytest_runtest_logfinish(nodeid: str, location: object) -> None:
    if RECORDER:
        RECORDER.end(nodeid)


def pytest_unconfigure(config: object) -> None:
    if RECORDER:
        RECORDER.write_skipped()
