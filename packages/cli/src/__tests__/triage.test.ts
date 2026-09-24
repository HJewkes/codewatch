import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerResult } from "@titan-design/style-checker";
import { idempotentRunner, inlineRunner, type LegacyStepRunner, type StepRunInput } from "@titan-design/workflow";
import { runAuditCommand } from "../commands/audit.js";
import { PYTHON_TOOLS, type PythonRunners } from "../commands/audit-runners.js";
import { runTriage, type TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import type { VerdictRecord } from "../commands/triage-output.js";
import type { VerdictRow } from "../commands/triage-prompt.js";
import { preflightAuth } from "../commands/triage-runner.js";

const CORE_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const EMPTY: RunnerResult = { diagnostics: [], exitCode: 0, failures: [], skippedRules: [] };
const SILENT_RUNNERS: PythonRunners = Object.fromEntries(PYTHON_TOOLS.map((tool) => [tool, () => Promise.resolve(EMPTY)]));

const CONTROLS = loadControls();
const HELPER_CLEAN = CONTROLS.find((c) => c.id === "py-helper-clean")!;
const HELPER_SLOP = CONTROLS.find((c) => c.id === "py-helper-slop")!;

interface AskedQuestion {
  key: string;
  path: string;
  line: number;
}

/** Reads the questions back out of a rendered prompt: `[key] path:line...`. */
function questionsIn(prompt: string): AskedQuestion[] {
  return [...prompt.matchAll(/^\[([^\]]+)\] ([^\s:]+):(\d+)/gm)].map((m) => ({ key: m[1]!, path: m[2]!, line: Number(m[3]) }));
}

/** The text the excerpt shows for one numbered line of one path. */
function shownText(prompt: string, path: string, line: number): string {
  const section = prompt.split(`=== ${path}\n`)[1]!.split("\n\n")[0]!;
  const match = section.split("\n").find((l) => new RegExp(`^\\s*${line}\\| `).test(l))!;
  return match.replace(/^\s*\d+\| /, "");
}

function row(q: AskedQuestion, prompt: string, verdict: VerdictRow["verdict"], quote = shownText(prompt, q.path, q.line)): VerdictRow {
  return { key: q.key, verdict, rationale: "fake reader", citations: [{ path: q.path, lineStart: q.line, lineEnd: q.line, quote }] };
}

/** A reader that answers each question with whatever `decide` returns for it. */
function fakeReader(decide: (q: AskedQuestion, prompt: string) => VerdictRow[]): LegacyStepRunner {
  return inlineRunner((input: StepRunInput) => JSON.stringify({ verdicts: questionsIn(input.prompt).flatMap((q) => decide(q, input.prompt)) }));
}

/** Right on the slop control, wrong on the clean one: both controls come back confirmed. */
const verdictFor = (path: string): VerdictRow["verdict"] => (path === "pkg/core.py" ? "justified" : "confirmed");

function readVerdicts(dir: string): VerdictRecord[] {
  const text = readFileSync(join(dir, ".codewatch", "audit", "verdicts.jsonl"), "utf8");
  return text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as VerdictRecord);
}

describe("runTriage with a fake reader", () => {
  let dir: string;
  const base = (): TriageRunOptions => ({
    path: dir,
    minRank: 0,
    includeTests: false,
    model: "sonnet",
    concurrency: 2,
    budgetUsd: 5,
    controls: [HELPER_CLEAN, HELPER_SLOP],
    controlCount: 2,
    seed: "fixed-seed",
  });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-run-"));
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("marks every verdict provisional when a clean control comes back confirmed", async () => {
    const runner = fakeReader((q, prompt) => [row(q, prompt, verdictFor(q.path))]);

    const { report } = await runTriage({ ...base(), runner });

    expect(report.controls.score).toMatchObject({ total: 2, correct: 1 });
    expect(report.controls.failed).toEqual(["py-helper-clean"]);
    const verdicts = readVerdicts(dir);
    expect(verdicts.map((v) => v.path)).toEqual(["pkg/core.py"]);
    expect(verdicts.every((v) => v.controlRun === "provisional")).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dir, ".codewatch", "audit", "triage.json"), "utf8"));
    expect(onDisk.controls.controlRun).toBe("provisional");
  });

  it("drops a verdict whose quote drifts by one character and one for a key never asked", async () => {
    const runner = fakeReader((q, prompt) => {
      if (q.path !== "pkg/core.py") return [row(q, prompt, q.path === HELPER_SLOP.path ? "confirmed" : "justified")];
      const drifted = shownText(prompt, q.path, q.line).replace("_normalise", "_normalize");
      return [row(q, prompt, "confirmed", drifted), { ...row(q, prompt, "confirmed"), key: "code-graph:never-asked#0" }];
    });

    const { report, verdicts } = await runTriage({ ...base(), runner });

    expect(report.dropped.byReason).toEqual({ "quote-mismatch": 1, "unasked-key": 1 });
    expect(report.dropped.total).toBe(2);
    expect(verdicts).toEqual([]);
    expect(report.controls.controlRun).toBe("ok");
  });

  it("stops launching at --budget-usd and lists the skipped bundles", async () => {
    const reader = fakeReader((q, prompt) => [row(q, prompt, "unclear")]);
    const costly: LegacyStepRunner = {
      run: async (input) => ({ ...(await reader.run(input)), usage: { costUsd: 0.4 } }) as Awaited<ReturnType<LegacyStepRunner["run"]>>,
    };

    const { report } = await runTriage({ ...base(), controls: CONTROLS, controlCount: 4, concurrency: 1, budgetUsd: 1, runner: idempotentRunner(costly) });

    expect(report.stoppedBy).toBe("budget");
    expect(report.calls.succeeded).toBe(3);
    expect(report.skipped).toHaveLength(2);
    expect(report.cost.spentUsd).toBeCloseTo(1.2);
  });
});

describe("preflightAuth", () => {
  it("fails in one actionable line when no subscription token is set", () => {
    expect(() => preflightAuth({ PATH: "/usr/bin" })).toThrow(/^triage needs model auth: .*claude setup-token/);
  });

  it("passes with a subscription token", () => {
    expect(() => preflightAuth({ CLAUDE_CODE_OAUTH_TOKEN: "token" })).not.toThrow();
  });
});
