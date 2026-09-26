import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idempotentRunner, type LegacyStepRunner } from "@titan-design/workflow";
import { runAuditCommand } from "../commands/audit.js";
import { runTriage, type TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import { formatTriageSummary, type VerdictRecord } from "../commands/triage-output.js";
import type { VerdictRow } from "../commands/triage-prompt.js";
import { preflightAuth, type TriageHarness } from "../commands/triage-runner.js";
import { fakeReader, row, shownText, SILENT_RUNNERS } from "./triage-fake-reader.js";

const CORE_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const UTIL_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]
`;

const CALLER_SRC = `from pkg.util import _normalise


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const CONTROLS = loadControls();
const HELPER_CLEAN = CONTROLS.find((c) => c.id === "py-helper-clean")!;
const HELPER_SLOP = CONTROLS.find((c) => c.id === "py-helper-slop")!;

/** Right on the slop control, wrong on the clean one: both controls come back confirmed. */
const verdictFor = (path: string): VerdictRow["verdict"] => (path === "pkg/core.py" ? "justified" : "confirmed");

/** The first shown line of any excerpt section other than `path`, as a citation. */
function otherShownLine(prompt: string, path: string): VerdictRow["citations"][number] | undefined {
  const other = [...prompt.matchAll(/^=== (\S+)$/gm)].map((m) => m[1]!).find((p) => p !== path);
  const line = other && Number(/^\s*(\d+)\| /m.exec(prompt.split(`=== ${other}\n`)[1]!)?.[1]);
  return other && line ? { path: other, lineStart: line, lineEnd: line, quote: shownText(prompt, other, line) } : undefined;
}

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

  // A fresh audit per test: triage stores its verdicts, and a stored verdict skips its question on the next run.
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-run-"));
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

  it("keeps a verdict whose key carries the question header's path suffix, stored under the asked key", async () => {
    const asked: string[] = [];
    const runner = fakeReader((q, prompt) => {
      if (q.path !== "pkg/core.py") return [row(q, prompt, q.path === HELPER_SLOP.path ? "confirmed" : "justified")];
      asked.push(q.key);
      return [{ ...row(q, prompt, "confirmed"), key: `${q.key}] pkg/core.py:10-12` }];
    });

    const { report, verdicts } = await runTriage({ ...base(), runner });

    expect(report.dropped.total).toBe(0);
    expect(verdicts.map((v) => v.key)).toEqual(asked);
  });

  it("keeps a verdict that cites both the helper and its caller in another file", async () => {
    writeFileSync(join(dir, "pkg", "util.py"), UTIL_SRC);
    writeFileSync(join(dir, "pkg", "core.py"), CALLER_SRC);
    await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
    const runner = fakeReader((q, prompt) => {
      const answer = row(q, prompt, "justified");
      const other = otherShownLine(prompt, q.path);
      return other ? [{ ...answer, citations: [...answer.citations, other] }] : [answer];
    });

    const { report, verdicts } = await runTriage({ ...base(), runner });

    const helper = verdicts.filter((v) => v.path === "pkg/util.py");
    expect(report.dropped.total).toBe(0);
    expect(helper.map((v) => v.citations.map((c) => c.path))).toEqual([["pkg/util.py", "pkg/core.py"]]);
  });

  it("builds the reader on the claude-print harness by default and on the SDK when asked", async () => {
    const built: TriageHarness[] = [];
    const buildReader = ({ harness }: { harness: TriageHarness }) => {
      built.push(harness);
      return fakeReader((q, prompt) => [row(q, prompt, "unclear")]);
    };

    const byDefault = await runTriage({ ...base(), buildReader });
    const bySdk = await runTriage({ ...base(), buildReader, harness: "sdk", out: join(dir, "sdk-out") });

    expect(built).toEqual(["claude-print", "sdk"]);
    expect([byDefault.report.harness, bySdk.report.harness]).toEqual(["claude-print", "sdk"]);
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

  it("keeps launching past a retryable failure until --max-failures is exceeded and records each failed call", async () => {
    const flaky: LegacyStepRunner = { run: async () => ({ ok: false, error: "claude -p reached --max-turns 2", retryable: true, usage: { costUsd: 0.1 } }) };

    const { report } = await runTriage({ ...base(), controls: CONTROLS, controlCount: 4, concurrency: 1, maxFailures: 1, runner: flaky });

    expect(report.stoppedBy).toBe("failure");
    expect(report.calls.failed).toHaveLength(2);
    expect(report.calls.failed[0]).toMatchObject({ retryable: true, error: "claude -p reached --max-turns 2" });
    expect(report.calls.failed[0]!.costUsd).toBeGreaterThan(0);
    expect(report.skipped).toHaveLength(3);
    expect(report.settings.maxFailures).toBe(1);
    expect(report.cost.spentUsd).toBeCloseTo(report.calls.failed.reduce((n, f) => n + f.costUsd, 0));
  });

  it("reports controls not run instead of a zero score when no planted control reached the reader", async () => {
    const refusing: LegacyStepRunner = { run: async () => ({ ok: false, error: "reader refused", retryable: false }) };

    const { report, outDir } = await runTriage({ ...base(), controls: CONTROLS, controlCount: 4, concurrency: 1, runner: refusing });

    expect(report.controls.controls).toHaveLength(4);
    expect(report.controls.status).toBe("not-run");
    expect(report.controls.score.total).toBe(0);
    const summary = formatTriageSummary(report, outDir).join("\n");
    expect(summary).toContain("controls not run");
    expect(summary).not.toContain("0/4 correct");
    const onDisk = JSON.parse(readFileSync(join(outDir, "triage.json"), "utf8"));
    expect(onDisk.controls.status).toBe("not-run");
  });
});

describe("preflightAuth", () => {
  let bin: string;

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), "triage-bin-"));
  });

  afterEach(() => rmSync(bin, { recursive: true, force: true }));

  const installClaude = () => {
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
  };

  it("fails the SDK harness in one actionable line when no subscription token is set", () => {
    installClaude();
    expect(() => preflightAuth("sdk", { PATH: bin })).toThrow(/^triage needs model auth: .*claude setup-token/);
  });

  it("passes the SDK harness with a subscription token and no claude binary", () => {
    expect(() => preflightAuth("sdk", { PATH: bin, CLAUDE_CODE_OAUTH_TOKEN: "token" })).not.toThrow();
  });

  it("passes the claude-print harness with a claude binary on PATH and no token", () => {
    installClaude();
    expect(() => preflightAuth("claude-print", { PATH: bin })).not.toThrow();
  });

  it("fails the claude-print harness in one actionable line when no claude binary is on PATH", () => {
    expect(() => preflightAuth("claude-print", { PATH: bin })).toThrow(/^triage needs the claude CLI: no `claude` binary on PATH;.*--harness sdk$/);
  });
});
