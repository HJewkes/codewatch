import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckDiagnostic, RunnerResult } from "@titan-design/style-checker";
import { runAuditCommand } from "../commands/audit.js";
import { PYTHON_TOOLS, type PythonRunner, type PythonRunners, type PythonTool } from "../commands/audit-runners.js";

function diagnostic(rule: string, line: number, severity: CheckDiagnostic["severity"] = "warn"): CheckDiagnostic {
  return { file: "pkg/mod.py", line, column: 1, severity, message: `${rule} fired`, category: "audit", rule, fixable: false };
}

const RECORDED: Record<Exclude<PythonTool, "ruff">, CheckDiagnostic> = {
  vulture: diagnostic("vulture/unused-function", 1),
  pydoclint: diagnostic("pydoclint/DOC101", 2),
  pyright: diagnostic("pyright/reportUnnecessaryIsInstance", 3),
  "import-linter": diagnostic("import-linter/layers", 4, "error"),
  suppressions: diagnostic("suppression/noqa", 5),
};

function result(diagnostics: CheckDiagnostic[], warnings?: string[]): RunnerResult {
  return { diagnostics, exitCode: 0, failures: [], skippedRules: [], warnings };
}

type RecordingRunner = PythonRunner & { calls: string[][] };

function recording(res: RunnerResult): RecordingRunner {
  const calls: string[][] = [];
  const runner = (files: string[]): Promise<RunnerResult> => {
    calls.push(files);
    return Promise.resolve(res);
  };
  return Object.assign(runner, { calls });
}

function recordedRunners(): PythonRunners {
  const runners: PythonRunners = { ruff: recording(result([])) };
  for (const [tool, d] of Object.entries(RECORDED)) runners[tool as PythonTool] = recording(result([d]));
  return runners;
}

let dir: string;
let emptyDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "c105-runners-"));
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg", "__init__.py"), "");
  writeFileSync(join(dir, "pkg", "mod.py"), "def f(x):\n    return x\n");
  emptyDir = mkdtempSync(join(tmpdir(), "c105-runners-ts-"));
  writeFileSync(join(emptyDir, "index.ts"), "export const x = 1;\n");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

describe("codewatch audit Tier B runners", () => {
  it("writes each runner's diagnostic to findings.jsonl under its own tool with its rule as the signal", async () => {
    const res = await runAuditCommand({ path: dir, runners: recordedRunners() });

    const written = readFileSync(join(dir, ".codewatch", "audit", "findings.jsonl"), "utf8").trim().split("\n");
    const external = written.map((line) => JSON.parse(line)).filter((f) => f.tool !== "code-graph");
    expect(external.map((f) => [f.tool, f.signal, f.lineStart])).toEqual([
      ["vulture", "vulture/unused-function", 1],
      ["pydoclint", "pydoclint/DOC101", 2],
      ["pyright", "pyright/reportUnnecessaryIsInstance", 3],
      ["import-linter", "import-linter/layers", 4],
      ["suppressions", "suppression/noqa", 5],
    ]);
    expect(res.warnings).toEqual([]);
  });

  it("maps a warn diagnostic to a warning finding and keeps an error diagnostic an error", async () => {
    const res = await runAuditCommand({ path: dir, runners: recordedRunners() });

    const severity = (tool: string) => res.findings.find((f) => f.tool === tool)?.severity;
    expect(severity("vulture")).toBe("warning");
    expect(severity("import-linter")).toBe("error");
  });

  it("skips a tool that reports a warning, surfacing one skipped line and keeping the other tools' findings", async () => {
    const runners = recordedRunners();
    runners.pyright = recording(result([], ["pyright not found; install with `pip install pyright`"]));

    const res = await runAuditCommand({ path: dir, runners });

    expect(res.warnings).toEqual(["skipped pyright: pyright not found; install with `pip install pyright`"]);
    expect(res.findings.some((f) => f.tool === "pyright")).toBe(false);
    expect(res.findings.some((f) => f.tool === "vulture")).toBe(true);
  });

  it("runs none of the Python tools on a tree without Python files", async () => {
    const runners = recordedRunners();

    const res = await runAuditCommand({ path: emptyDir, runners });

    for (const tool of PYTHON_TOOLS) expect((runners[tool] as RecordingRunner).calls).toHaveLength(0);
    expect(res.findings.filter((f) => f.tool !== "code-graph")).toEqual([]);
  });

  it("--no-ruff skips ruff alone and still runs the other Python tools", async () => {
    const runners = recordedRunners();

    await runAuditCommand({ path: dir, noRuff: true, runners });

    expect((runners.ruff as RecordingRunner).calls).toHaveLength(0);
    expect((runners.vulture as RecordingRunner).calls[0]!.sort()).toEqual(["pkg/__init__.py", "pkg/mod.py"]);
  });
});
