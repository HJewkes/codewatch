"""Interface-coupling detectors over one module's functions (C-248 B7.1), Python AST, module-scoped.

  control      a parameter branched on in flag form (`p`, `not p`, `p ==/!=/in/is <literal>`), stored to a
               `self` attribute the class branches on that way, or forwarded to a control parameter; it
               also needs evidence: a bool default, or a literal argument at some call site. Control and
               evidence are a fixpoint over forwarding links; evidence flows down them.
  origin       a control parameter with its own evidence (not only evidence forwarded from a caller)
  stamp        a parameter used only through one attribute or one constant key (`p.x`, `p["k"]`, `p.get("k")`)
  pass-through a body that is one call forwarding every parameter, in order, bare (code-graph TP-322)
  unused       trailing parameters never read (exempt: functions a dispatch table names, stub bodies), and
               locals bound and never read (names starting with `_` are exempt)
  common       a `global` store, an in-place write to a module-level mutable, a write to a temporary field
               (a `self` attribute not set in `__init__`, `__post_init__` or the class body), or a local the
               function hands to a helper that mutates it and also passes to another call (parameter bag)
Calls resolve inside the module only: a bare name to a module-level def (a class to its __init__), and
`self.m` to the caller's class. `self` and `cls` are receivers, never parameters.
"""

from __future__ import annotations

import ast
from collections import defaultdict
from dataclasses import dataclass, field

from planner.cutwidth import MUTATORS
from planner.units import Unit, own_nodes

RECEIVERS = ("self", "cls")
FLAG_OPS = (ast.Eq, ast.NotEq, ast.In, ast.NotIn)


def params(fn: ast.AST) -> list[str]:
    a = fn.args
    names = [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs]
    return [n for n in names if n not in RECEIVERS]


def _literal(node: ast.AST) -> bool:
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return all(_literal(e) for e in node.elts)
    return isinstance(node, ast.Constant)


def _subject(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self":
        return f"self.{node.attr}"
    return None


def flag_names(test: ast.AST) -> set[str]:
    """Names and `self.x` attributes a test reads in flag form."""
    if isinstance(test, ast.BoolOp):
        return set().union(*(flag_names(v) for v in test.values))
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        return flag_names(test.operand)
    if isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], FLAG_OPS):
        left, right = test.left, test.comparators[0]
        side = left if _literal(right) else right if _literal(left) else None
        return {s for s in [_subject(side)] if s} if side is not None else set()
    return {s for s in [_subject(test)] if s}


def tested(fn: ast.AST) -> set[str]:
    out: set[str] = set()
    for node in own_nodes(fn):
        if isinstance(node, (ast.If, ast.While, ast.IfExp, ast.Assert)):
            out |= flag_names(node.test)
        elif isinstance(node, ast.comprehension):
            for cond in node.ifs:
                out |= flag_names(cond)
    return out


@dataclass
class Facts:
    unit: Unit
    params: list[str]
    tested: set[str]
    loads: dict[str, list[ast.Name]] = field(default_factory=lambda: defaultdict(list))
    stores: set[str] = field(default_factory=set)
    calls: list[tuple[ast.Call, str | None]] = field(default_factory=list)


def _target(node: ast.Call, u: Unit, by_qual: dict[str, Unit]) -> str | None:
    f = node.func
    if isinstance(f, ast.Name):
        hit = by_qual.get(f.id) or by_qual.get(f"{f.id}.__init__")
        return hit.key if hit else None
    if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id in RECEIVERS and u.cls:
        hit = by_qual.get(f"{u.cls}.{f.attr}")
        return hit.key if hit else None
    return None


def facts(units: list[Unit]) -> dict[str, Facts]:
    by_qual = {u.qual: u for u in units}
    out = {}
    for u in units:
        fx = Facts(u, params(u.node), tested(u.node))
        for node in own_nodes(u.node):
            if isinstance(node, ast.Name):
                (fx.loads[node.id].append(node) if isinstance(node.ctx, ast.Load) else fx.stores.add(node.id))
            elif isinstance(node, ast.Call):
                fx.calls.append((node, _target(node, u, by_qual)))
        out[u.key] = fx
    return out


def _bound_args(call: ast.Call, callee: Facts):
    """(callee param, argument node) pairs for positional and keyword arguments."""
    for name, arg in zip(callee.params, call.args):
        if isinstance(arg, ast.Starred):
            return
        yield name, arg
    for kw in call.keywords:
        if kw.arg in callee.params:
            yield kw.arg, kw.value


def _access(name: ast.Name, parents: dict) -> str | None:
    """The one attribute or constant key a use of a name goes through, or None for a bare use."""
    up = parents.get(name)
    if isinstance(up, ast.Attribute) and up.value is name:
        call = parents.get(up)
        if up.attr == "get" and isinstance(call, ast.Call) and call.func is up and call.args \
                and isinstance(call.args[0], ast.Constant):
            return f"[{call.args[0].value!r}]"
        return f".{up.attr}"
    if isinstance(up, ast.Subscript) and up.value is name and isinstance(up.slice, ast.Constant):
        return f"[{up.slice.value!r}]"
    return None


def stamp(f: Facts, parents: dict) -> list[str]:
    out = []
    for p in f.params:
        ways = {_access(n, parents) for n in f.loads.get(p, [])}
        if len(ways) == 1 and None not in ways and p not in f.stores:
            out.append(p)
    return out


def pass_through(f: Facts) -> list[str]:
    """`function` when the body is one call forwarding every parameter, in order, bare (code-graph TP-322)."""
    body = [st for st in f.unit.node.body if not (isinstance(st, ast.Expr) and isinstance(st.value, ast.Constant))]
    call = body[0].value if len(body) == 1 and isinstance(body[0], (ast.Return, ast.Expr)) else None
    if not isinstance(call, ast.Call) or not f.params or call.keywords:
        return []
    args = [a.id if isinstance(a, ast.Name) else None for a in call.args]
    return ["function"] if args == f.params else []


def _stub(fn: ast.AST) -> bool:
    body = [s for s in fn.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
    return all(isinstance(s, (ast.Pass, ast.Raise)) or (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)
                                                         and s.value.value is Ellipsis) for s in body)


def unused(f: Facts, exempt: set[str]) -> list[str]:
    """`param:p` for trailing unused parameters, `local:x` for locals bound and never read. A read in a
    nested def or lambda counts: a closure uses the name."""
    out = []
    read = {n.id for n in ast.walk(f.unit.node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    if f.unit.key not in exempt and not _stub(f.unit.node):
        used = [p in read for p in f.params]
        last = max((i for i, u in enumerate(used) if u), default=-1)
        out += [f"param:{p}" for p in f.params[last + 1:] if not p.startswith("_")]
    declared = {n for x in own_nodes(f.unit.node) if isinstance(x, (ast.Global, ast.Nonlocal)) for n in x.names}
    locals_ = f.stores - set(f.params) - declared
    return out + [f"local:{n}" for n in sorted(locals_) if n not in read and not n.startswith("_")]


def _mutated(f: Facts, names, parents: dict) -> set[str]:
    """Those of `names` the function writes into in place (item or attribute stores, mutator calls)."""
    out = set()
    for p in names:
        for n in f.loads.get(p, []):
            up = parents.get(n)
            if isinstance(up, (ast.Subscript, ast.Attribute)) and up.value is n and isinstance(up.ctx, (ast.Store, ast.Del)):
                out.add(p)
            elif isinstance(up, ast.Attribute) and up.attr in MUTATORS and isinstance(parents.get(up), ast.Call):
                out.add(p)
    return out


def module_mutables(tree: ast.Module) -> set[str]:
    out = set()
    for stmt in tree.body:
        value = stmt.value if isinstance(stmt, (ast.Assign, ast.AnnAssign)) else None
        mutable = isinstance(value, (ast.List, ast.Dict, ast.Set)) or (
            isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
            and value.func.id in ("list", "dict", "set", "defaultdict", "OrderedDict", "Counter", "deque"))
        targets = stmt.targets if isinstance(stmt, ast.Assign) else [getattr(stmt, "target", None)]
        out |= {t.id for t in targets if mutable and isinstance(t, ast.Name)}
    return out


def _bag(f: Facts, fx: dict[str, Facts], mutates: dict[str, set[str]]) -> list[str]:
    """Locals handed to a helper that mutates them and also passed to another call."""
    passed: dict[str, set[int]] = defaultdict(set)
    handed = set()
    for i, (call, target) in enumerate(f.calls):
        args = list(_bound_args(call, fx[target])) if target in fx else [(None, a) for a in call.args]
        for name, arg in args:
            if isinstance(arg, ast.Name):
                passed[arg.id].add(i)
                if target in fx and name in mutates[target]:
                    handed.add(arg.id)
    return [f"bag:{v}" for v in sorted(handed) if len(passed[v]) >= 2]


def common(f: Facts, fx, mutates, parents: dict, mutables: set[str], fields: dict[str, set[str]]) -> list[str]:
    out = [f"global:{n}" for x in own_nodes(f.unit.node) if isinstance(x, ast.Global) for n in x.names
           if n in f.stores]
    out += [f"module:{n}" for n in sorted(_mutated(f, mutables - f.stores - set(f.params), parents))]
    if f.unit.cls and f.unit.node.name not in ("__init__", "__post_init__"):
        out += [f"temp:{a}" for a in sorted(self_stores(f.unit.node) - fields.get(f.unit.cls, set()))]
    return out + _bag(f, fx, mutates)


def self_stores(fn: ast.AST) -> set[str]:
    return {x.attr for x in own_nodes(fn) if isinstance(x, ast.Attribute) and isinstance(x.ctx, ast.Store)
            and isinstance(x.value, ast.Name) and x.value.id == "self"}
