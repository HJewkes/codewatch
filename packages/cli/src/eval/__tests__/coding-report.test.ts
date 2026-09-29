import { describe, it, expect } from "vitest";
import { GOLD_PATCH_CAVEAT, renderArmReport, summarizeArms, type ArmRun } from "../coding-report.js";
import type { Ledger, TokenCounts } from "../coding-ledger.js";
import type { SetScore } from "../types.js";

interface Cache {
  create: number;
  read: number;
}

const NO_CACHE: Cache = { create: 0, read: 0 };

function ledger(inputTokens: number, calls = 1, cache: Cache = NO_CACHE): Ledger {
  return { inputTokens, cacheCreateTokens: cache.create, cacheReadTokens: cache.read, outputTokens: 0, calls };
}

function counts(inputTokens: number, cache: Cache = NO_CACHE): TokenCounts {
  return { inputTokens, cacheCreateTokens: cache.create, cacheReadTokens: cache.read, outputTokens: 0 };
}

function score(f1: number): SetScore {
  return { precision: f1, recall: f1, f1, truePositives: 0, expected: 0, predicted: 0 };
}

interface RunSpec {
  arm: string;
  taskId: string;
  resolved?: boolean;
  main?: number;
  helper?: number;
  mainCache?: Cache;
  helperCache?: Cache;
  f1?: number;
  preEditTurns?: number | null;
}

function run(spec: RunSpec): ArmRun {
  const main = spec.main ?? 1000;
  const helper = spec.helper ?? 0;
  const f1 = spec.f1 ?? 0.5;
  return {
    taskId: spec.taskId,
    arm: spec.arm,
    stratum: "s",
    resolved: spec.resolved ?? false,
    runError: false,
    failToPassPassed: 0,
    failToPassTotal: 1,
    passToPassRegressed: 0,
    main: ledger(main, 1, spec.mainCache),
    helper: ledger(helper, 1, spec.helperCache),
    sessionTotal: counts(main + helper, {
      create: (spec.mainCache?.create ?? 0) + (spec.helperCache?.create ?? 0),
      read: (spec.mainCache?.read ?? 0) + (spec.helperCache?.read ?? 0),
    }),
    ledgerGap: counts(0),
    costUsd: 0,
    numTurns: 1,
    toolCalls: {},
    editedFiles: [],
    localization: { file: score(f1), symbol: score(f1), line: score(f1) },
    preEditTurns: spec.preEditTurns === undefined ? 2 : spec.preEditTurns,
    readLocalization: score(f1),
  };
}

function headlineRow(report: string, arm: string): string {
  const table = report.split("## ")[1] ?? "";
  return table.split("\n").find((line) => line.startsWith(`| ${arm} |`)) ?? "";
}

describe("renderArmReport", () => {
  it("headlines the main-ledger delta, not the session total, when helper tokens differ between arms", () => {
    const runs = [
      run({ arm: "A0", taskId: "t1", main: 1000, helper: 0 }),
      run({ arm: "A0", taskId: "t2", main: 3000, helper: 0 }),
      run({ arm: "AI", taskId: "t1", main: 800, helper: 5000 }),
      run({ arm: "AI", taskId: "t2", main: 2600, helper: 5000 }),
    ];

    const report = renderArmReport(summarizeArms(runs));

    const summary = summarizeArms(runs).arms.find((a) => a.arm === "AI");
    expect(summary?.mainDelta?.meanDelta).toBe(-300);
    expect(headlineRow(report, "AI")).toContain("-300");
    expect(headlineRow(report, "AI")).toContain("| 1,700 |");
    expect(headlineRow(report, "AI")).not.toContain("6,700");
    expect(headlineRow(report, "AI")).not.toContain("4,700");
    expect(report).toMatch(/## Helper overhead[\s\S]*\| AI \| 5,000 \|/);
    expect(report).toMatch(/## Session total \(reference only\)[\s\S]*\| AI \| 6,700 \|/);
  });

  it("counts cache-create and cache-read tokens as input in the main ledger, the delta and helper overhead", () => {
    const runs = [
      run({ arm: "A0", taskId: "t1", main: 1000, mainCache: { create: 200, read: 800 } }),
      run({
        arm: "AI",
        taskId: "t1",
        main: 500,
        mainCache: { create: 100, read: 400 },
        helper: 300,
        helperCache: { create: 50, read: 150 },
      }),
    ];

    const report = renderArmReport(summarizeArms(runs));

    expect(headlineRow(report, "A0")).toContain("| 2,000 |");
    expect(headlineRow(report, "AI")).toContain("| 1,000 |");
    expect(headlineRow(report, "AI")).toContain("-1,000");
    expect(report).toMatch(/## Helper overhead[\s\S]*\| AI \| 500 \|/);
    expect(report).toMatch(/## Session total \(reference only\)[\s\S]*\| AI \| 1,500 \|/);
  });

  it("prints localization-F1 under the reported-not-optimised heading with the gold-patch caveat", () => {
    const report = renderArmReport(summarizeArms([run({ arm: "A0", taskId: "t1", f1: 0.25 })]));

    const section = report.split("## Localization-F1 (reported, not optimised)")[1] ?? "";
    expect(section).toContain(GOLD_PATCH_CAVEAT);
    expect(section).toContain("| A0 | 0.25 | 0.25 | 0.25 | 1 |");
    expect(headlineRow(report, "A0")).not.toContain("0.25");
  });

  it("shows pre-edit turns and read-localization under diagnostics", () => {
    const runs = [
      run({ arm: "A0", taskId: "t1", preEditTurns: 4 }),
      run({ arm: "A0", taskId: "t2", preEditTurns: null }),
    ];

    const report = renderArmReport(summarizeArms(runs));

    expect(report.split("## Diagnostics")[1]).toContain("| A0 | 4.0 | 1 | 0.50 |");
  });
});

describe("summarizeArms", () => {
  it("orders arms by resolve rate and main tokens, never by localization-F1", () => {
    const runs = [
      run({ arm: "A0", taskId: "t1", resolved: false, main: 100, f1: 1 }),
      run({ arm: "A2", taskId: "t1", resolved: true, main: 900, f1: 0.9 }),
      run({ arm: "AI", taskId: "t1", resolved: true, main: 500, f1: 0 }),
    ];

    const order = summarizeArms(runs).arms.map((a) => a.arm);

    expect(order).toEqual(["AI", "A2", "A0"]);
  });

  it("leaves the delta absent for an arm with no tasks in common with the baseline", () => {
    const runs = [run({ arm: "A0", taskId: "t1" }), run({ arm: "AI", taskId: "t2" })];

    const summary = summarizeArms(runs);
    const report = renderArmReport(summary);

    expect(summary.arms.find((a) => a.arm === "AI")?.mainDelta).toBeUndefined();
    expect(headlineRow(report, "AI")).toContain("n/a (no shared tasks)");
    expect(report).not.toMatch(/NaN/);
  });

  it("reports every delta absent and names the missing baseline when A0 did not run", () => {
    const runs = [run({ arm: "AI", taskId: "t1" }), run({ arm: "A2", taskId: "t1" })];

    const summary = summarizeArms(runs);
    const report = renderArmReport(summary);

    expect(summary.baselinePresent).toBe(false);
    expect(summary.arms.every((a) => a.mainDelta === undefined)).toBe(true);
    expect(report).toContain("baseline arm A0 has no runs");
    expect(report).not.toMatch(/NaN/);
  });

  it("averages repeated runs of one task before pairing against the baseline", () => {
    const runs = [
      run({ arm: "A0", taskId: "t1", main: 1000 }),
      run({ arm: "AI", taskId: "t1", main: 600 }),
      run({ arm: "AI", taskId: "t1", main: 800 }),
      run({ arm: "AI", taskId: "t9", main: 50 }),
    ];

    const delta = summarizeArms(runs).arms.find((a) => a.arm === "AI")?.mainDelta;

    expect(delta).toEqual({ pairedTasks: 1, meanDelta: -300, baselineMean: 1000 });
  });
});
