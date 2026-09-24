import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFindings, listVerdicts, type StoredVerdict } from "@titan-design/code-graph";
import type { LegacyStepRunner } from "@titan-design/workflow";
import { runAuditCommand } from "../commands/audit.js";
import { runTriage, type TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import type { VerdictRecord } from "../commands/triage-output.js";
import { openGraphStore } from "../utils/graph-store.js";
import { fakeReader, row, SILENT_RUNNERS, type AskedQuestion } from "./triage-fake-reader.js";

const CORE_SRC = `def _normalise(values):
    total = sum(values)
    return [v / total for v in values]


def summarise(values):
    shares = _normalise(values)
    return max(shares)
`;

const EXTRA_SRC = `def _scale(values, factor):
    doubled = [v * factor for v in values]
    return doubled


def rescale(values):
    scaled = _scale(values, 2)
    return min(scaled)
`;

const CONTROLS = loadControls().filter((c) => c.id === "py-helper-clean" || c.id === "py-helper-slop");

interface CountingReader {
  runner: LegacyStepRunner;
  asked: AskedQuestion[];
  calls: () => number;
}

/** Answers every question `justified` and records each call and each real (non-control) question. */
function countingReader(): CountingReader {
  const asked: AskedQuestion[] = [];
  let calls = 0;
  const inner = fakeReader((q, prompt) => {
    if (q.path.startsWith("pkg/")) asked.push(q);
    return [row(q, prompt, "justified")];
  });
  const runner: LegacyStepRunner = {
    run: (input) => {
      calls++;
      return inner.run(input);
    },
  };
  return { runner, asked, calls: () => calls };
}

function readVerdictsFile(dir: string): VerdictRecord[] {
  const text = readFileSync(join(dir, ".codewatch", "audit", "verdicts.jsonl"), "utf8");
  return text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as VerdictRecord);
}

function latestVerdicts(dir: string): { snapshotId: number; verdicts: StoredVerdict[]; hashed: number } {
  const store = openGraphStore(join(dir, ".codewatch", "graph.db"));
  try {
    const snapshotId = store.listSnapshots({ limit: 1 })[0]!.id;
    const hashed = listFindings(store, snapshotId).filter((f) => f.excerptHash !== undefined).length;
    return { snapshotId, verdicts: listVerdicts(store, snapshotId), hashed };
  } finally {
    store.close();
  }
}

describe("triage verdicts persisted in graph.db", () => {
  let dir: string;
  const audit = () => runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  const triage = (runner: LegacyStepRunner) => {
    const options: TriageRunOptions = { path: dir, minRank: 0, includeTests: false, model: "sonnet", concurrency: 2, budgetUsd: 5, controls: CONTROLS, controlCount: 2 };
    return runTriage({ ...options, runner });
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-persist-"));
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    writeFileSync(join(dir, "pkg", "extra.py"), EXTRA_SRC);
    await audit();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes no model calls when an unchanged tree is audited and triaged again", async () => {
    const first = countingReader();
    const firstRun = await triage(first.runner);
    const firstSnapshot = latestVerdicts(dir).snapshotId;
    expect(first.asked.map((q) => q.path).sort()).toEqual(["pkg/core.py", "pkg/extra.py"]);

    await audit();
    const second = countingReader();
    const { report } = await triage(second.runner);

    expect(second.calls()).toBe(0);
    const stored = latestVerdicts(dir);
    expect(stored.snapshotId).toBeGreaterThan(firstSnapshot);
    expect(stored.verdicts.map((v) => v.key).sort()).toEqual(firstRun.verdicts.map((v) => v.key).sort());
    expect(stored.verdicts.every((v) => v.carriedFrom === firstSnapshot && v.verdict === "justified")).toBe(true);
    expect(report.verdictStore).toMatchObject({ carriedFrom: firstSnapshot, carried: 2, fresh: 0, skippedByVerdict: 2 });
    const onDisk = JSON.parse(readFileSync(join(dir, ".codewatch", "audit", "triage.json"), "utf8"));
    expect(onDisk.verdictStore.reused.map((r: { carriedFrom: number }) => r.carriedFrom)).toEqual([firstSnapshot, firstSnapshot]);
  });

  it("writes every carried verdict to verdicts.jsonl on a fully carried rerun", async () => {
    await triage(countingReader().runner);
    const first = readVerdictsFile(dir);
    const firstSnapshot = latestVerdicts(dir).snapshotId;

    await audit();
    await triage(countingReader().runner);

    const second = readVerdictsFile(dir);
    expect(first.every((r) => r.provenance === "model" && r.carriedFrom === undefined)).toBe(true);
    expect(second).toHaveLength(first.length);
    expect(second.every((r) => r.provenance === "carried" && r.carriedFrom === firstSnapshot)).toBe(true);
    expect(second.map((r) => [r.key, r.path, r.verdict])).toEqual(first.map((r) => [r.key, r.path, r.verdict]));
  });

  it("asks again only about the finding whose excerpt changed by one character", async () => {
    await triage(countingReader().runner);
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC.replace("v / total", "v * total"));

    await audit();
    const second = countingReader();
    const { report } = await triage(second.runner);

    expect(second.asked.map((q) => q.path)).toEqual(["pkg/core.py"]);
    expect(report.verdictStore).toMatchObject({ carried: 1, fresh: 1, skippedByVerdict: 1 });
    expect(report.verdictStore.reused.map((r) => r.path)).toEqual(["pkg/extra.py"]);
    expect(readVerdictsFile(dir).map((r) => [r.path, r.provenance])).toEqual([["pkg/core.py", "model"], ["pkg/extra.py", "carried"]]);
    const stored = latestVerdicts(dir);
    expect(stored.verdicts).toHaveLength(2);
    expect(stored.hashed).toBeGreaterThan(0);
  });

  it("skips questions already judged in the same snapshot without re-auditing", async () => {
    await triage(countingReader().runner);

    const again = countingReader();
    const { report } = await triage(again.runner);

    expect(again.calls()).toBe(0);
    expect(report.verdictStore).toMatchObject({ carried: 0, fresh: 0, skippedByVerdict: 2 });
  });
});
