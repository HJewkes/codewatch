import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Finding } from "@titan-design/code-graph";
import { runAuditCommand } from "../commands/audit.js";

/**
 * An etl-like CLI whose tests feed `main` through a flag-defaulting helper and also call a private
 * helper and a public internal one directly: neither helper is an entry while the CLI exists.
 */
const ETL_FILES: Readonly<Record<string, string>> = {
  "etl/__init__.py": "",
  "etl/cli.py": `import argparse
import json

from etl.steps import run_steps


def main(argv=None):
    parser = argparse.ArgumentParser(prog="etl")
    parser.add_argument("pipeline")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    with open(args.pipeline) as handle:
        doc = json.load(handle)
    result = run_steps(doc.get("steps", []), execute=args.execute)
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    main()
`,
  "etl/steps.py": `def _rename(step, columns):
    if step["from"] not in columns:
        return {"ok": False, "code": "MISSING_COLUMN"}
    return {"ok": True}


def run_steps(steps, execute=False):
    for step in steps:
        merge = step.get("merge")
        strategy = step.get("strategy", "left")
        if merge is not None and strategy not in ("left", "right"):
            return {"ok": False, "code": "BAD_STRATEGY"}
        if execute and step["op"] == "rename":
            outcome = _rename(step, ["a", "b"])
            if not outcome["ok"]:
                return outcome
    return {"ok": True}
`,
  "tests/test_cli.py": `import json

from etl.cli import main

BASE = {"op": "rename", "from": "a", "merge": "m", "strategy": "left"}


def run(tmp_path, steps, execute=True):
    path = tmp_path / "p.json"
    path.write_text(json.dumps({"steps": steps}))
    return main([str(path)] + (["--execute"] if execute else []))


def test_missing_column_fails(tmp_path, capsys):
    assert run(tmp_path, [{"op": "rename", "from": "z", "merge": "m", "strategy": "left"}]) == 1
    assert "MISSING_COLUMN" in capsys.readouterr().out


def test_null_merge_is_accepted(tmp_path):
    assert run(tmp_path, [dict(BASE, merge=None)]) == 0


def test_merge_dropped(tmp_path):
    step = dict(BASE)
    del step["merge"]
    assert run(tmp_path, [step]) == 0
`,
  "tests/test_steps.py": `from etl.steps import run_steps


def test_run_steps_accepts_no_steps():
    assert run_steps([]) is not None
`,
  "tests/test_rename.py": `from etl.steps import _rename


def test_rename_reports_missing_column():
    assert "MISSING" in _rename({"from": "z"}, ["a"])["code"]
`,
};

/** A library with no CLI: its public function is the entry, and its tests never pass it an empty list. */
const LIBRARY_FILES: Readonly<Record<string, string>> = {
  "pkg/__init__.py": "",
  "pkg/core.py": "def summarise(values):\n    total = sum(values)\n    return round(max(values) / total, 2)\n",
  "tests/test_core.py": "from pkg.core import summarise\n\n\ndef test_summarise():\n    assert summarise([1, 3]) is not None\n",
};

/** A CLI that parses its one flag by hand and is spawned by its tests through a module-level script path. */
const HAND_ROLLED_FILES: Readonly<Record<string, string>> = {
  "tool.py": `import json
import sys


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    doc = json.loads(sys.stdin.read())
    if "--strict" in args and doc.get("name") is None:
        print(json.dumps({"code": "NAME_REQUIRED"}))
        return 1
    print(json.dumps({"name": doc.get("name"), "size": doc.get("size", 0)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`,
  "tests/test_tool.py": `import json
import subprocess
import sys

SCRIPT = "tool.py"


def run(doc, strict=True):
    args = [sys.executable, SCRIPT] + (["--strict"] if strict else [])
    return subprocess.run(args, input=json.dumps(doc), capture_output=True, text=True)


def test_strict_needs_a_name():
    assert "NAME_REQUIRED" in run({"size": 1, "kind": "a"}).stdout
`,
};

interface Census {
  entries: { id: string; kind: string; classes: { class: string; subject: string; fed: Record<string, number>; never: string[] }[] }[];
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

async function audit(root: string): Promise<Finding[]> {
  const result = await runAuditCommand({ path: root, noRuff: true, noTsSlop: true, out: join(root, "out") });
  return result.findings;
}

const readCensus = (root: string): string => readFileSync(join(root, "out", "input-classes.json"), "utf8");
const inputClassRows = (rows: readonly Finding[]): Finding[] => rows.filter((f) => f.signal === "entry-input-class");
const classOf = (census: Census, entry: string, cls: string, subject: string) =>
  census.entries.find((e) => e.id === entry)?.classes.find((c) => c.class === cls && c.subject === subject);

let scratch: string;
let etlRoot: string;
let etlRows: Finding[];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "c237-input-classes-"));
  etlRoot = join(scratch, "etl");
  writeFiles(etlRoot, ETL_FILES);
  etlRows = await audit(etlRoot);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("entry-input-class findings on an etl-like CLI", () => {
  it("names the input classes a CLI's tests never feed, at the entry point only", () => {
    const rows = inputClassRows(etlRows);

    expect(rows.map((f) => f.id)).toEqual([
      "codewatch:entry-input-class:etl/cli.py#main:mode-error:MISSING_COLUMN@execute",
      "codewatch:entry-input-class:etl/cli.py#main:key:strategy",
      "codewatch:entry-input-class:etl/cli.py#main:key:merge",
      "codewatch:entry-input-class:etl/cli.py#main:empty:input",
      "codewatch:entry-input-class:etl/cli.py#main:mode:execute",
    ]);
    expect(rows.find((f) => f.id.endsWith(":key:strategy"))?.evidence).toContain("never: missing, null, empty");
    expect(rows.find((f) => f.id.endsWith(":key:merge"))?.evidence).toBe(
      [
        "entry: main (cli)",
        "class: key merge, read by run_steps at etl/steps.py:7",
        "fed: present 1, null 1, missing 1, empty 0",
        "never: empty",
        "tests: tests/test_cli.py:14-16, tests/test_cli.py:19-20, tests/test_cli.py:23-26",
      ].join("\n"),
    );
    expect(rows[0]).toMatchObject({ path: "etl/cli.py", symbol: "main", lineStart: 7, severity: "warning", tool: "codewatch" });
  });

  it("ranks an unasserted error code below the cap without dropping it from the census", () => {
    const census = JSON.parse(readCensus(etlRoot)) as Census;

    expect(etlRows.some((f) => f.id.includes(":unasserted:"))).toBe(false);
    expect(classOf(census, "etl/cli.py#main", "unasserted", "BAD_STRATEGY")?.never).toEqual(["asserted"]);
  });

  it("counts a key dropped with del and a key nulled through dict(BASE, ...)", () => {
    const census = JSON.parse(readCensus(etlRoot)) as Census;

    expect(classOf(census, "etl/cli.py#main", "key", "merge")?.fed).toEqual({ present: 1, null: 1, missing: 1, empty: 0 });
  });

  it("files no test-gap finding of either kind for a private or internal helper", () => {
    const helperRows = etlRows.filter(
      (f) => (f.signal === "missing-test-kind" || f.signal === "entry-input-class") && f.symbol !== "main",
    );

    expect(helperRows).toEqual([]);
  });

  it("writes the per-entry census beside findings.jsonl", async () => {
    const first = readCensus(etlRoot);
    const census = JSON.parse(first) as Census;

    expect(census.entries.map((e) => [e.id, e.kind])).toEqual([["etl/cli.py#main", "cli"]]);
    expect(classOf(census, "etl/cli.py#main", "mode", "execute")?.fed).toEqual({ on: 3, off: 0 });
    await audit(etlRoot);
    expect(readCensus(etlRoot)).toBe(first);
  });
});

describe("entry-input-class findings on a library with no CLI", () => {
  it("treats a tested public function as the entry when the repo has no CLI", async () => {
    const root = join(scratch, "library");
    writeFiles(root, LIBRARY_FILES);

    const rows = await audit(root);

    expect(rows.some((f) => f.signal === "missing-test-kind" && f.symbol === "summarise")).toBe(true);
    expect(inputClassRows(rows).map((f) => f.id)).toContain("codewatch:entry-input-class:pkg/core.py#summarise:empty:values");
  });
});

describe("entry-input-class findings on a hand-rolled CLI its tests spawn", () => {
  it("reads a flag compared against argv and a script named by a module-level constant", async () => {
    const root = join(scratch, "hand-rolled");
    writeFiles(root, HAND_ROLLED_FILES);

    const rows = await audit(root);
    const census = JSON.parse(readCensus(root)) as Census;

    expect(inputClassRows(rows).map((f) => f.id)).toContain("codewatch:entry-input-class:tool.py#main:mode-error:NAME_REQUIRED@strict");
    expect(classOf(census, "tool.py#main", "mode", "strict")?.fed).toEqual({ on: 1, off: 0 });
  });
});
