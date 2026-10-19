import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import type { LegacyStepRunner } from "@titan-design/workflow";
import { runAuditCommand } from "../commands/audit.js";
import { registerTriageCommand } from "../commands/triage-cli.js";
import type { TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import type { Control } from "../commands/triage-controls/types.js";
import type { VerdictRecord } from "../commands/triage-output.js";
import { fakeReader, row, SILENT_RUNNERS } from "./triage-fake-reader.js";

// The SCBench A1 triage stage (bench/scbench/agent/claude_code_cw.yaml) through the real CLI
// parser and verdict persistence; only the model reader and the control pool are replaced.
// The stage wraps the CLI (bench/scbench/findings/triage_stage.py), which runs
// `codewatch triage <--workspace> <args after -->`.
const injected = vi.hoisted(() => ({ runner: undefined as LegacyStepRunner | undefined, controls: [] as readonly Control[] }));
vi.mock("../commands/triage.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../commands/triage.js")>();
  const runTriage = (o: TriageRunOptions) => real.runTriage({ ...o, runner: injected.runner, controls: injected.controls, controlCount: 2, seed: "fixed" });
  return { ...real, runTriage };
});

const STAGE_CONFIG = join(import.meta.dirname, "../../../../bench/scbench/agent/claude_code_cw.yaml");
const SPEC_LINE = "Shares are rounded to one decimal place from this part on.";
// A weakly tested function: the audit files a missing-test-kind gap, which triage asks
// about at any rank, with the spec beside it.
const CORE_SRC = "def summarise(values):\n    total = sum(values)\n    return round(max(values) / total, 2)\n";
const TEST_SRC = "from pkg.core import summarise\n\n\ndef test_summarise():\n    assert summarise([1, 3]) is not None\n";

function shippedTriageCommand(): string {
  const block = /^ {2}triage:\n(?: {4}.*\n)*? {4}command: >-\n((?: {6}.*\n)+)/m.exec(readFileSync(STAGE_CONFIG, "utf8"));
  return block![1]!.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" }).map((rel) => join(root, rel)).filter((p) => statSync(p).isFile());
}

describe("the SCBench A1 triage stage command", () => {
  let tmp: string;
  let workspace: string;
  let specFile: string;
  let prompts: string[];

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "scbench-triage-"));
    workspace = join(tmp, "workspace");
    for (const sub of ["pkg", "tests"]) mkdirSync(join(workspace, sub), { recursive: true });
    writeFileSync(join(workspace, "pkg", "__init__.py"), "");
    writeFileSync(join(workspace, "pkg", "core.py"), CORE_SRC);
    writeFileSync(join(workspace, "tests", "test_core.py"), TEST_SRC);
    mkdirSync(join(tmp, "cw-spec"));
    specFile = join(tmp, "cw-spec", "cp-2.md");
    writeFileSync(specFile, `# Part 2\n\n${SPEC_LINE}\n`);
    prompts = [];
    injected.runner = fakeReader((q, prompt) => {
      prompts.push(prompt);
      return [row(q, prompt, "confirmed")];
    });
    injected.controls = loadControls().filter((c) => c.id === "py-helper-clean" || c.id === "py-helper-slop");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runAuditCommand({ path: workspace, noRuff: true, runners: SILENT_RUNNERS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("shows the spec to the reader, writes checkpoint 2's new verdicts to verdicts.d/cp-2.jsonl and no spec text under the workspace", async () => {
    const stage = shippedTriageCommand()
      .replace('"$CW_SPEC_FILE"', specFile)
      .replace("$CW_CHECKPOINT", "2")
      .replaceAll("/workspace", workspace)
      .split(" ");
    expect(stage[stage.indexOf("-m") + 1]).toBe("findings.triage_stage");
    const argv = ["codewatch", "triage", stage[stage.indexOf("--workspace") + 1]!, ...stage.slice(stage.indexOf("--") + 1)];
    const program = new Command().exitOverride();
    registerTriageCommand(program);

    await program.parseAsync(["node", ...argv]);

    expect(process.exitCode).toBeUndefined();
    const fragment = join(workspace, ".codewatch", "verdicts.d", "cp-2.jsonl");
    expect(existsSync(fragment)).toBe(true);
    const rows = readFileSync(fragment, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as VerdictRecord);
    expect(rows.map((r) => [r.signal, r.path, r.runId])).toContainEqual(["missing-test-kind", "pkg/core.py", "cp-2"]);
    expect(prompts.some((prompt) => prompt.includes(SPEC_LINE))).toBe(true);
    expect(filesUnder(workspace).filter((p) => readFileSync(p).includes(SPEC_LINE))).toEqual([]);
  });
});
