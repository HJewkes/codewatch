import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAuditCommand } from "../commands/audit.js";
import {
  countFlaggedLines,
  defaultRulesDir,
  loadTsSlopPack,
  parseAstGrepStream,
  runTsSlopRules,
  type AstGrepMatch,
  type TsSlopRun,
} from "../commands/audit-ts-slop.js";
import { TS_SLOP_FIXTURES } from "./ts-slop-fixtures.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const AST_GREP = join(repoRoot, "node_modules/.bin/ast-grep");
const SCB_CATEGORIES = [
  "boolean_and_comparison",
  "conditionals",
  "defensive",
  "dict_patterns",
  "loops_and_comprehensions",
  "misc",
  "type_annotations",
  "type_conversions",
];

function packRules(): Array<{ id: string; note: string; category: string }> {
  return readdirSync(defaultRulesDir())
    .filter((name) => name.endsWith(".yml"))
    .flatMap((name) => readFileSync(join(defaultRulesDir(), name), "utf8").split(/^---$/m))
    .map((doc) => ({
      id: /^id: (.+)$/m.exec(doc)?.[1] ?? "",
      note: /^note: (.+)$/m.exec(doc)?.[1] ?? "",
      category: /^ {2}category: (.+)$/m.exec(doc)?.[1] ?? "",
    }));
}

function match(ruleId: string, file: string, startLine: number, lines: string): AstGrepMatch {
  return { ruleId, file, startLine, endLine: startLine + lines.split("\n").length - 1, message: "m", lines };
}

describe("TS slop rule pack", () => {
  it("covers every SCBench verbosity category and names the scb rule each rule approximates", () => {
    const rules = packRules();

    expect(new Set(rules.map((r) => r.category))).toEqual(new Set(SCB_CATEGORIES));
    expect(rules.filter((r) => !/^approximates scb [a-z0-9-]+$/.test(r.note))).toEqual([]);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it("has a matching and a clean fixture for every rule and none for a rule that is gone", () => {
    expect(Object.keys(TS_SLOP_FIXTURES).sort()).toEqual(packRules().map((r) => r.id).sort());
  });

  it("binds a Tsx copy of each rule so .tsx files are scanned too", () => {
    const pack = loadTsSlopPack();

    expect(pack.match(/^language: Tsx$/gm)?.length).toBe(packRules().length);
  });
});

describe("TS slop rules on their fixtures", () => {
  let dir: string;
  let run: TsSlopRun;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ts-slop-"));
    const files: string[] = [];
    for (const [id, fixture] of Object.entries(TS_SLOP_FIXTURES)) {
      writeFileSync(join(dir, `${id}.match.ts`), fixture.match);
      writeFileSync(join(dir, `${id}.clean.ts`), fixture.clean);
      files.push(`${id}.match.ts`, `${id}.clean.ts`);
    }
    writeFileSync(join(dir, "view.tsx"), "export const V = (xs: number[]) => <b>{xs.filter((x) => x > 0)[0]}</b>;\n");
    run = await runTsSlopRules([...files, "view.tsx"], { cwd: dir, bin: AST_GREP });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hits = (file: string, id: string) => run.findings.filter((f) => f.path === file && f.signal === `ts-slop/${id}`);

  it("runs without warnings", () => {
    expect(run.warnings).toEqual([]);
  });

  it.each(Object.keys(TS_SLOP_FIXTURES))("%s fires on its match fixture and not on its clean one", (id) => {
    expect(hits(`${id}.match.ts`, id).length).toBeGreaterThan(0);
    expect(hits(`${id}.clean.ts`, id)).toEqual([]);
  });

  it("flags a .tsx file through the Tsx copy of a rule", () => {
    expect(hits("view.tsx", "filter-then-first-or-length")).toHaveLength(1);
  });

  it("reports findings under the ast-grep tool with 1-indexed lines", () => {
    const [finding] = hits("boolean-return-if-else.match.ts", "boolean-return-if-else");

    expect(finding).toMatchObject({ tool: "ast-grep", severity: "warning", lineStart: 2, lineEnd: 4 });
  });
});

describe("codewatch audit on a TS repo", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-slop-audit-"));
    writeFileSync(join(dir, "a.ts"), TS_SLOP_FIXTURES["json-roundtrip-clone"]!.match);
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\nexport const c = 2;\nexport const d = 3;\n");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("adds the slop findings and reports flagged TS lines over total TS lines", async () => {
    const result = await runAuditCommand({
      path: dir,
      tsSlop: (files, options) => runTsSlopRules(files, { ...options, bin: AST_GREP }),
    });

    expect(result.findings.filter((f) => f.tool === "ast-grep").map((f) => `${f.path} ${f.signal}`)).toEqual([
      "a.ts ts-slop/json-roundtrip-clone",
    ]);
    expect(result.tsVerbosity).toEqual({ verbosity_flagged_loc: 1, total_loc: 4, verbosity: 0.25 });
  });

  it("leaves verbosity out and says so when --no-ts-slop is set", async () => {
    const result = await runAuditCommand({ path: dir, noTsSlop: true });

    expect(result.tsVerbosity).toBeUndefined();
    expect(result.warnings).toContain("ts-slop skipped (--no-ts-slop)");
  });
});

describe("runTsSlopRules", () => {
  it("skips non-TS files without running ast-grep", async () => {
    const run = await runTsSlopRules(["a.py", "b.js"], { cwd: tmpdir(), bin: "/nonexistent/ast-grep" });

    expect(run).toEqual({ findings: [], warnings: [], flaggedLoc: 0 });
  });

  it("turns a missing ast-grep binary into a warning", async () => {
    const run = await runTsSlopRules(["a.ts"], { cwd: tmpdir(), bin: "/nonexistent/ast-grep" });

    expect(run.findings).toEqual([]);
    expect(run.flaggedLoc).toBeNull();
    expect(run.warnings).toEqual([expect.stringContaining("ast-grep not found")]);
  });
});

describe("countFlaggedLines", () => {
  it("unions overlapping matches per file and skips blank lines", () => {
    const matches = [
      match("a", "x.ts", 1, "if (a) {\n\n  return true;"),
      match("b", "x.ts", 3, "  return true;\n}"),
      match("a", "y.ts", 3, "z"),
    ];

    expect(countFlaggedLines(matches)).toBe(4);
  });
});

describe("parseAstGrepStream", () => {
  it("reads one JSON match per line with 0-indexed ranges shifted to 1-indexed", () => {
    const line = JSON.stringify({
      ruleId: "r",
      file: "a.ts",
      message: "m",
      lines: "x",
      range: { start: { line: 4 }, end: { line: 6 } },
    });

    expect(parseAstGrepStream(`${line}\n`)).toEqual([
      { ruleId: "r", file: "a.ts", startLine: 5, endLine: 7, message: "m", lines: "x" },
    ]);
  });
});
