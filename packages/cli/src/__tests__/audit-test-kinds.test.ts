import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "@titan-design/code-graph";
import { runAuditCommand } from "../commands/audit.js";
import { parseChangedLines } from "../commands/audit-changed.js";

const IMAGE_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../bench/scbench/image/fixture");

/** A CLI whose only tests check substrings of its output, over a parser and two pure helpers. */
const CLI_FILES: Readonly<Record<string, string>> = {
  "inventory/__init__.py": "",
  "inventory/cli.py": `import argparse

from inventory.parse import parse_rows
from inventory.report import render_report


def main(argv=None):
    parser = argparse.ArgumentParser(prog="inventory")
    parser.add_argument("path")
    args = parser.parse_args(argv)
    with open(args.path) as handle:
        rows = parse_rows(handle.read())
    print(render_report(rows))
    return 0
`,
  "inventory/parse.py": `def parse_rows(text):
    rows = []
    for line in text.splitlines():
        sku, quantity, price = line.split(",")
        rows.append((sku, int(quantity), float(price)))
    return rows
`,
  "inventory/report.py": `def total_value(rows):
    return sum(quantity * price for _, quantity, price in rows)


def render_report(rows):
    lines = [f"{sku} {quantity}" for sku, quantity, _ in rows]
    lines.append(f"TOTAL {total_value(rows):.2f}")
    return "\\n".join(lines)


def describe_row(row):
    return f"{row[0]} x{row[1]}"
`,
  "tests/test_cli.py": `from inventory.cli import main


def test_main_lists_items(tmp_path, capsys):
    path = tmp_path / "stock.csv"
    path.write_text("apple,2,1.5\\n")
    main([str(path)])
    out = capsys.readouterr().out
    assert "apple" in out


def test_main_ends_with_total(tmp_path, capsys):
    path = tmp_path / "stock.csv"
    path.write_text("apple,2,1.5\\n")
    main([str(path)])
    assert capsys.readouterr().out.strip().splitlines()[-1].startswith("TOTAL")
`,
  "tests/test_report.py": `from inventory.report import total_value


def test_total_value_sums_lines():
    assert total_value([("a", 2, 1.5), ("b", 1, 4.0)]) == 7.0
`,
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A repo whose base commit is empty, with every fixture file staged: the whole tree is the PR's change. */
function stageAsChange(repo: string): void {
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "base"]);
  git(repo, ["add", "-A"]);
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

async function testKindRows(root: string, changedFrom?: string): Promise<Finding[]> {
  const result = await runAuditCommand({ path: root, noRuff: true, changedFrom, out: join(root, "out") });
  return result.findings.filter((f) => f.signal === "missing-test-kind");
}

const LOOSE_CLI_TESTS = "tests: tests/test_cli.py:4-9, tests/test_cli.py:12-16";

const ids = (rows: readonly Finding[]): string[] => rows.map((f) => f.id).sort();

let scratch: string;
let cliRows: Finding[];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "c189-test-kinds-"));
  writeFiles(join(scratch, "cli"), CLI_FILES);
  cliRows = await testKindRows(join(scratch, "cli"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("missing-test-kind findings on a CLI tested only by substring checks", () => {
  it("flags the boundary, the parser and the loosely tested pure helper, naming the tests that reach each", () => {
    expect(cliRows.map((f) => [f.id, f.evidence]).sort()).toEqual([
      [
        "codewatch:missing-test-kind:inventory/cli.py#main:error-path",
        `code kind: output boundary, I/O\nmissing: error-path test\n${LOOSE_CLI_TESTS}`,
      ],
      [
        "codewatch:missing-test-kind:inventory/cli.py#main:full-output",
        `code kind: output boundary\nmissing: snapshot or exact-output test\n${LOOSE_CLI_TESTS}\nnote: its tests assert only loose output`,
      ],
      [
        "codewatch:missing-test-kind:inventory/parse.py#parse_rows:malformed-input",
        `code kind: parser\nmissing: malformed-input error-path test\n${LOOSE_CLI_TESTS}`,
      ],
      [
        "codewatch:missing-test-kind:inventory/report.py#render_report:exact-value",
        `code kind: pure logic\nmissing: exact-value test\n${LOOSE_CLI_TESTS}`,
      ],
    ]);
  });

  it("flags a loose-only output boundary even though tests reach it, at the symbol's own span", () => {
    expect(cliRows.find((f) => f.id.endsWith("#main:full-output"))).toMatchObject({
      path: "inventory/cli.py",
      symbol: "main",
      lineStart: 7,
      lineEnd: 14,
      severity: "warning",
      tool: "codewatch",
    });
  });

  it("leaves an exactly tested helper and an untested, unchanged one alone", () => {
    expect(cliRows.filter((f) => f.symbol === "total_value" || f.symbol === "describe_row")).toEqual([]);
  });

  it("flags an untested symbol once the change touches it", async () => {
    const root = join(scratch, "cli-changed");
    writeFiles(root, CLI_FILES);
    stageAsChange(root);
    git(root, ["commit", "-q", "-m", "inventory"]);
    writeFiles(root, { "inventory/report.py": CLI_FILES["inventory/report.py"]!.replace("x{row[1]}", "x {row[1]}") });

    const rows = await testKindRows(root, "HEAD");

    expect(rows.filter((f) => f.symbol === "describe_row").map((f) => [f.id, f.evidence])).toEqual([
      ["codewatch:missing-test-kind:inventory/report.py#describe_row:exact-value", "code kind: pure logic\nmissing: exact-value test\ntests: none"],
    ]);
    expect(ids(rows)).toEqual(ids([...cliRows, ...rows.filter((f) => f.symbol === "describe_row")]));
  });
});

describe("missing-test-kind findings on the A1 image fixture, which has no tests", () => {
  let root: string;

  beforeAll(() => {
    root = join(scratch, "image");
    cpSync(IMAGE_FIXTURE, root, { recursive: true });
    stageAsChange(root);
  });

  it("flags nothing when no change is given, since no test reaches any symbol", async () => {
    expect(await testKindRows(root)).toEqual([]);
  });

  it("flags every pure function for an exact-value test when the whole tree is the change", async () => {
    const rows = await testKindRows(root, "HEAD");

    expect(ids(rows)).toEqual([
      "codewatch:missing-test-kind:shop/cart.py#cart_total:exact-value",
      "codewatch:missing-test-kind:shop/cart.py#total:exact-value",
      "codewatch:missing-test-kind:shop/pricing.py#line_total:exact-value",
      "codewatch:missing-test-kind:shop/pricing.py#unit_price:exact-value",
    ]);
    for (const f of rows) expect(f.evidence).toBe("code kind: pure logic\nmissing: exact-value test\ntests: none");
  });
});

describe("changed lines from a zero-context diff", () => {
  it("keeps new-side ranges per file, marks a pure deletion at its line and skips a deleted file", () => {
    const diff = [
      "--- a/pkg/a.py",
      "+++ b/pkg/a.py",
      "@@ -3,2 +3,3 @@ def f():",
      "@@ -10 +11,0 @@",
      "--- a/pkg/gone.py",
      "+++ /dev/null",
      "@@ -1,4 +0,0 @@",
      "--- /dev/null",
      "+++ b/pkg/new.py",
      "@@ -0,0 +1 @@",
    ].join("\n");

    expect([...parseChangedLines(diff)]).toEqual([
      ["pkg/a.py", [{ start: 3, end: 5 }, { start: 11, end: 11 }]],
      ["pkg/new.py", [{ start: 1, end: 1 }]],
    ]);
  });
});
