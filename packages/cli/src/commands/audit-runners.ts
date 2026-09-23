import { externalToFinding, type Finding } from "@titan-design/code-graph";
import {
  countSuppressions,
  runImportLinter,
  runPydoclintAudit,
  runPyrightAudit,
  runRuffAudit,
  runVultureAudit,
  type CheckDiagnostic,
  type RunnerResult,
} from "@titan-design/style-checker";

export type PythonRunner = (files: string[], options: { cwd: string }) => Promise<RunnerResult>;

export const PYTHON_TOOLS = ["ruff", "vulture", "pydoclint", "pyright", "import-linter", "suppressions"] as const;
export type PythonTool = (typeof PYTHON_TOOLS)[number];
export type PythonRunners = Partial<Record<PythonTool, PythonRunner>>;

export interface PythonToolsRun {
  findings: Finding[];
  warnings: string[];
}

/** Vulture's default of 60 reported linearmodels' public API as unused; 80 keeps the confident hits. */
const VULTURE_MIN_CONFIDENCE = 80;

const DEFAULT_RUNNERS: Record<PythonTool, PythonRunner> = {
  ruff: (files, options) => runRuffAudit(files, options),
  vulture: (files, options) => runVultureAudit(files, { ...options, minConfidence: VULTURE_MIN_CONFIDENCE }),
  pydoclint: (files, options) => runPydoclintAudit(files, { ...options, style: "numpy" }),
  pyright: (files, options) => runPyrightAudit(files, options),
  "import-linter": (_files, options) => runImportLinter(options),
  suppressions: (files, options) => Promise.resolve(countSuppressions(files, options)),
};

/** One finding per diagnostic: error stays error, warn and info become warning. */
export function diagnosticToFinding(tool: PythonTool, d: CheckDiagnostic): Finding {
  return externalToFinding({
    tool,
    rule: d.rule,
    file: d.file,
    line: d.line,
    endLine: d.endLine,
    message: d.message,
    severity: d.severity === "error" ? "error" : "warning",
  });
}

function resultNotes(tool: PythonTool, result: RunnerResult): string[] {
  const failures = result.failures.map((f) =>
    f.kind === "spawn-failed" ? `${tool} not found on PATH; ${tool} findings skipped` : `${tool}: ${f.message}`,
  );
  const skips = (result.warnings ?? []).map((w) => `skipped ${tool}: ${w}`);
  return [...failures, ...skips];
}

async function runOne(tool: PythonTool, run: PythonRunner, files: string[], cwd: string): Promise<PythonToolsRun> {
  const result = await run(files, { cwd });
  return { findings: result.diagnostics.map((d) => diagnosticToFinding(tool, d)), warnings: resultNotes(tool, result) };
}

/** Runs each tool over the Python files; a tool that is absent or unconfigured adds a warning, never an error. */
export async function runPythonTools(
  tools: readonly PythonTool[],
  files: string[],
  cwd: string,
  overrides: PythonRunners = {},
): Promise<PythonToolsRun> {
  if (files.length === 0) return { findings: [], warnings: [] };
  const runs = await Promise.all(tools.map((tool) => runOne(tool, overrides[tool] ?? DEFAULT_RUNNERS[tool], files, cwd)));
  return { findings: runs.flatMap((r) => r.findings), warnings: runs.flatMap((r) => r.warnings) };
}
