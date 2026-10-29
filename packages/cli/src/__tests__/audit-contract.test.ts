import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Finding } from "@titan-design/code-graph";
import { runAuditCommand, type AuditCommandResult } from "../commands/audit.js";
import { openGraphStore } from "../utils/graph-store.js";

const PARSER_BASE = `class QueryError(Exception):
    pass


OPS = ("=", "<", ">")


class Parser:
    def __init__(self, tokens):
        self.tokens = list(tokens)
        self.pos = 0

    def err(self, msg):
        raise QueryError(msg)

    def next(self):
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def literal(self):
        tok = self.next()
        if tok[0] in ("number", "string"):
            return tok[1]
        self.err("expected literal")

    def atom(self):
        field = self.next()
        op = self.next()
        if op[1] not in OPS:
            self.err("bad operator")
        tok = self.next()
        if tok[0] not in ("number", "string"):
            self.err("expected literal")
        return ("cmp", field[1], op[1], tok[1])

    def where(self):
        return self.atom()


def parse(tokens, strict=True):
    return Parser(tokens).where()
`;

/** The guard moves into check_op; value() reaches literal() only for a literal, so the check is lost; next gains an optional step. */
const PARSER_HEAD = `class QueryError(Exception):
    pass


OPS = ("=", "<", ">")


class Parser:
    def __init__(self, tokens):
        self.tokens = list(tokens)
        self.pos = 0

    def err(self, msg):
        raise QueryError(msg)

    def next(self, step=1):
        tok = self.tokens[self.pos]
        self.pos += step
        return tok

    def literal(self):
        tok = self.next()
        if tok[0] in ("number", "string"):
            return tok[1]
        self.err("expected literal")

    def check_op(self, op):
        if op[1] not in OPS:
            self.err("bad operator")

    def value(self):
        if self.tokens[self.pos][0] in ("number", "string"):
            return self.literal()
        return self.next()[1]

    def atom(self):
        field = self.next()
        op = self.next()
        self.check_op(op)
        value = self.value()
        return ("cmp", field[1], op[1], value)

    def where(self):
        return self.atom()


def parse(tokens, strict=False):
    return Parser(tokens).where()
`;

const BASE_FILES: Readonly<Record<string, string>> = {
  "qparse/__init__.py": "",
  "qparse/parser.py": PARSER_BASE,
  "qparse/report.py": "def fmt(value):\n    return str(value)\n",
  "qparse/scale.py": `import functools


@functools.cache
def scale(value, factor=2):
    return value * factor
`,
  "qparse/cli.py": `from qparse.parser import parse
from qparse.report import fmt
from qparse.scale import scale


def main(argv):
    return parse(argv)


def head(tokens):
    return parse(tokens, True)


def show(value):
    return fmt(value)


def rescale(value):
    return scale(value)
`,
  "tests/test_parser.py": `import pytest

from qparse.parser import QueryError, parse


def test_parses_comparison():
    assert parse([("ident", "x"), ("op", "="), ("number", "1")]) == ("cmp", "x", "=", "1")


def test_rejects_bad_operator():
    with pytest.raises(QueryError, match="bad operator"):
        parse([("ident", "x"), ("op", "~"), ("number", "1")])
`,
  "src/format.ts": `export function pad(s: string, width = 2): string {
  if (width < 0) throw new RangeError("width must be positive");
  return s.padStart(width);
}
`,
  "src/table.ts": `import { pad } from "./format.js";
export function cell(s: string): string {
  return pad(s);
}
`,
  "src/guard.ts": `export function guard(n: number): number {
  if (n < 0) throw new Error("bad");
  return n;
}
`,
  "src/gate.ts": `import { guard } from "./guard.js";
export function gate(n: number): number {
  return guard(n);
}
`,
  "src/guard.test.ts": `import { expect, it } from "vitest";
import { guard } from "./guard.js";
it("rejects negatives", () => {
  expect(() => guard(-1)).toThrow("bad");
  expect("bad input").toContain("bad");
});
`,
  "scripts/repeat.mjs": `export function repeat(text, times = 2) {
  return text.repeat(times);
}
`,
  "scripts/repeat.test.mjs": `import { expect, it } from "vitest";
import { repeat } from "./repeat.mjs";
it("doubles by default", () => {
  expect(repeat("ab")).toBe("abab");
});
`,
  "src/format.test.ts": `import { expect, it } from "vitest";
import { pad } from "./format.js";
it("rejects a negative width", () => {
  expect(() => pad("x", -1)).toThrow("width must be positive");
});
`,
};

const HEAD_FILES: Readonly<Record<string, string>> = {
  "scripts/repeat.mjs": `export function repeat(text, times = 3) {
  return text.repeat(times);
}
`,
  "qparse/scale.py": `import functools


@functools.cache
def scale(value, factor=3):
    return value * factor
`,
  "src/guard.ts": `export function guard(n: number): number {
  return Math.max(n, 0);
}
`,
  "qparse/parser.py": PARSER_HEAD,
  "qparse/report.py": 'def fmt(value, unit):\n    return f"{value}{unit}"\n',
  "src/format.ts": `export function pad(s: string, width = 4): string {
  return s.padStart(Math.max(width, 0));
}
`,
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** BASE committed, HEAD left in the working tree, so `--changed-from HEAD` is the change. */
function commitBaseThenEdit(repo: string): void {
  writeFiles(repo, BASE_FILES);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  writeFiles(repo, HEAD_FILES);
}

const contractRows = (result: AuditCommandResult): Finding[] => result.findings.filter((f) => f.signal === "contract-change");

const evidenceOf = (rows: readonly Finding[], idSuffix: string): string => rows.find((f) => f.id.endsWith(idSuffix))?.evidence ?? "";

let scratch: string;
let repo: string;
let changedRun: AuditCommandResult;
let rows: Finding[];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "c236-contract-"));
  repo = join(scratch, "repo");
  mkdirSync(repo);
  commitBaseThenEdit(repo);
  changedRun = await runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, changedFrom: "HEAD", out: join(scratch, "out") });
  rows = contractRows(changedRun);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("contract-change findings against --changed-from", () => {
  it("flags a removed error site that its callers and tests still rely on", () => {
    expect(rows.map((f) => f.id)).toEqual([
      "codewatch:contract-change:qparse/parser.py#Parser.atom:error-removed:QueryError-expected-literal",
      "codewatch:contract-change:qparse/parser.py#parse:default-changed:strict",
      "codewatch:contract-change:qparse/report.py#fmt:param-added:unit",
      "codewatch:contract-change:qparse/scale.py#scale:default-changed:factor",
      "codewatch:contract-change:scripts/repeat.mjs#repeat:default-changed:times",
      "codewatch:contract-change:src/format.ts#pad:default-changed:width",
      "codewatch:contract-change:src/format.ts#pad:error-removed:RangeError-width-must-be-positive",
      "codewatch:contract-change:src/guard.ts#guard:error-removed:Error-bad",
    ]);
    expect(rows[0]).toMatchObject({ path: "qparse/parser.py", lineStart: 36, lineEnd: 41, symbol: "Parser.atom", severity: "warning", tool: "codewatch" });
    expect(rows[0]!.evidence).toBe(
      [
        'change: removed error site QueryError("expected literal") via err, was qparse/parser.py:34 at base',
        "callers not in diff: qparse/parser.py:43-44 Parser.where",
        "callers in diff: none",
        // code-graph leaves `Parser(tokens).where()` unresolved, so no test reaches the method.
        "tests not in diff: none",
        "tests asserting it: none",
      ].join("\n"),
    );
  });

  it("stays silent when an error check moves into a new helper", () => {
    expect(rows.filter((f) => f.id.includes("bad-operator"))).toEqual([]);
    expect(rows.filter((f) => f.id.includes("Parser.next"))).toEqual([]);
  });

  it("lists only the callers a changed default affects", () => {
    const evidence = evidenceOf(rows, "#parse:default-changed:strict");
    expect(evidence).toContain("change: default of strict: True -> False");
    expect(evidence).toContain("callers not in diff: qparse/cli.py:6-7 main");
    expect(evidence).not.toContain("head");
    expect(evidence).toContain("tests/test_parser.py:6-7");
  });

  it("names the tests that assert a removed TS error", () => {
    const evidence = evidenceOf(rows, "#pad:error-removed:RangeError-width-must-be-positive");
    expect(evidence).toContain("tests asserting it: src/format.test.ts:4");
    expect(evidence).toContain("callers not in diff: src/table.ts:2-4 cell");
    expect(evidence).toContain("tests not in diff: src/format.test.ts");
  });

  it("reads the default of a decorated def and lists the caller that omits it", () => {
    const evidence = evidenceOf(rows, "#scale:default-changed:factor");
    expect(evidence).toContain("change: default of factor: 2 -> 3");
    expect(evidence).toContain("callers not in diff: qparse/cli.py:18-19 rescale");
  });

  it("reads a changed default in a .mjs script and lists the .test.mjs caller outside the diff", () => {
    const evidence = evidenceOf(rows, "scripts/repeat.mjs#repeat:default-changed:times");
    expect(evidence).toBe(
      ["change: default of times: 2 -> 3", "callers not in diff: none", "callers in diff: none", "tests not in diff: scripts/repeat.test.mjs"].join("\n"),
    );
  });

  it("does not count a short message as asserted by an unrelated test line", () => {
    expect(evidenceOf(rows, "#guard:error-removed:Error-bad")).toContain("tests asserting it: none");
  });

  it("names the callers that omit an added required param", () => {
    expect(evidenceOf(rows, "#fmt:param-added:unit")).toContain("callers not in diff: qparse/cli.py:14-15 show");
  });

  it("keeps the head snapshot the latest", () => {
    const store = openGraphStore(changedRun.dbPath);
    try {
      expect(store.listSnapshots({ limit: 1 })[0]?.id).toBe(changedRun.snapshotId);
    } finally {
      store.close();
    }
  });

  it("reports nothing without --changed-from", async () => {
    const plain = await runAuditCommand({ path: repo, noRuff: true, noTsSlop: true, out: join(scratch, "plain") });
    expect(contractRows(plain)).toEqual([]);
  });
});
