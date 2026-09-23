import { describe, it, expect, vi } from "vitest";
import type { RunnerResult } from "@titan-design/style-checker";

const EMPTY: RunnerResult = { diagnostics: [], exitCode: 0, failures: [], skippedRules: [] };

vi.mock("@titan-design/style-checker", () => ({
  runRuffAudit: vi.fn(() => Promise.resolve(EMPTY)),
  runVultureAudit: vi.fn(() => Promise.resolve(EMPTY)),
  runPydoclintAudit: vi.fn(() => Promise.resolve(EMPTY)),
  runPyrightAudit: vi.fn(() => Promise.resolve(EMPTY)),
  runImportLinter: vi.fn(() => Promise.resolve(EMPTY)),
  countSuppressions: vi.fn(() => EMPTY),
}));

const checker = await import("@titan-design/style-checker");
const { PYTHON_TOOLS, runPythonTools } = await import("../commands/audit-runners.js");

describe("default Python tool runners", () => {
  it("calls each style-checker runner once with the audit's pinned options", async () => {
    const files = ["pkg/a.py"];

    await runPythonTools(PYTHON_TOOLS, files, "/repo");

    expect(checker.runRuffAudit).toHaveBeenCalledWith(files, { cwd: "/repo" });
    expect(checker.runVultureAudit).toHaveBeenCalledWith(files, { cwd: "/repo", minConfidence: 80 });
    expect(checker.runPydoclintAudit).toHaveBeenCalledWith(files, { cwd: "/repo", style: "numpy" });
    expect(checker.runPyrightAudit).toHaveBeenCalledWith(files, { cwd: "/repo" });
    expect(checker.runImportLinter).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(checker.countSuppressions).toHaveBeenCalledWith(files, { cwd: "/repo" });
  });
});
