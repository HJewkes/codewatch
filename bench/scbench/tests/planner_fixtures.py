"""Synthetic trees for the planner tests. `PARSER` is shaped like the plan's worked example (B8.2): a
`select_item` method of own-body CC 26, 55 SLOC and no parameters whose callees are all shared with
`atom`, so its task owns only itself and runs in the first of two waves."""

from __future__ import annotations


def ladder(name: str, arms: int, calls: tuple[str, ...] = (), indent: str = "", params: str = "x") -> str:
    """A function of own-body CC 1 + arms that calls each of `calls` once."""
    body = "".join(f"{indent}    if x == {i}:\n{indent}        return {i}\n" for i in range(arms))
    tail = "".join(f"{indent}    {c}(x)\n" for c in calls)
    return f"{indent}def {name}({params}):\n{body}{tail}{indent}    return x\n"


PARSER = '''\
AGGREGATES = {"SUM", "MIN", "MAX", "COUNT"}


class Parser:
    def __init__(self, text, toks):
        self.text, self.toks, self.i = text, toks, 0

    def peek(self):
        return self.toks[self.i]

    def next(self):
        self.i += 1
        return self.toks[self.i - 1]

    def err(self, msg):
        raise ValueError(msg)

    def is_word(self, w):
        return self.peek()[0] == "ident" and self.peek()[1].lower() == w

    def at_slot(self):
        return self.peek()[0] == "slot"

    def value_expr(self):
        return ("lit", self.next()[1], "")

    def field_ref(self):
        return [self.next()[1]]

    def atom(self):
        if self.at_slot() or self.is_word("not"):
            return self.value_expr()
        if self.peek()[0] == "ident":
            return self.field_ref()
        self.next()
        self.err("bad atom")

    def select_item(self):
        t = self.peek()
        nxt = self.toks[self.i + 1]
        if (t[0] == "ident" and nxt[0] == "punct" and nxt[1] == "."
                and self.toks[self.i + 2][0] == "punct" and self.toks[self.i + 2][1] == "*"):
            if t[1] == "ROOT":
                self.err("wildcard is not allowed on ROOT")
            if t[1].lower() == "parent":
                self.err("wildcard is not allowed on PARENT")
            self.i += 3
            item = {"agg": None, "path": None, "star": t[1], "key": t[1] + ".*"}
            if self.is_word("as"):
                self.err("AS is not allowed on a wildcard")
            return item
        if self.at_slot() or t[0] in ("number", "string") or (
                t[0] == "kw" and t[1] in ("true", "false", "null")):
            start = t[2]
            v = self.value_expr()
            key = self.text[start:self.peek()[2]].strip() if v[0] == "lit" else v[2]
            item = {"agg": None, "path": None, "expr": v, "key": key}
        elif t[0] == "ident" and nxt[0] == "punct" and nxt[1] == "(":
            func = t[1].upper()
            if func == "MEAN":
                func = "AVG"
            if func not in AGGREGATES:
                self.err("unknown function %s" % t[1])
            self.next()
            self.next()
            a = self.peek()
            if a[0] == "punct" and a[1] == "*":
                if func != "COUNT":
                    self.err("only COUNT takes *")
                self.next()
                path = None
                argtext = "*"
            else:
                path = self.field_ref()
                argtext = ".".join(path)
            c = self.peek()
            if not (c[0] == "punct" and c[1] == ")"):
                self.err("expected ')'")
            self.next()
            key = "%s(%s)" % (func, argtext)
            item = {"agg": func, "path": path, "key": key}
        else:
            path = self.field_ref()
            item = {"agg": None, "path": path, "key": ".".join(path)}
        if self.is_word("as"):
            self.next()
            a = self.peek()
            if a[0] != "ident":
                self.err("expected a name after AS")
            self.next()
            item["key"] = a[1]
        return item

''' + ladder("query", 11, ("self.atom", "self.select_item"), indent="    ", params="self, x")

AGGREGATE_ARM = ("elif t[0] == \"ident\" and nxt[0] == \"punct\" and nxt[1] == \"(\":", "item = {\"agg\": func")

WIDE = '''\
def report(rows, limit, sep, header, out):
    total = 0
    lines = []
    for r in rows[:limit]:
        total += r
        lines.append(sep.join([header, str(r)]))
    out.extend(lines)
    return total
'''
