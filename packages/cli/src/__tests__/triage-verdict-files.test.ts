import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LegacyStepRunner } from "@titan-design/workflow";
import { runAuditCommand } from "../commands/audit.js";
import { runTriage, type TriageRunOptions } from "../commands/triage.js";
import { loadControls } from "../commands/triage-controls/controls.js";
import type { VerdictRecord } from "../commands/triage-output.js";
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

function readJsonl(file: string): VerdictRecord[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as VerdictRecord);
}

describe("triage verdict carry from committed files", () => {
  let dir: string;
  let verdictsDir: string;
  const fragment = (id: string) => join(verdictsDir, "verdicts.d", `${id}.jsonl`);
  const head = () => join(verdictsDir, "verdicts.jsonl");
  const audit = () => runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  const triage = (runner: LegacyStepRunner, extra: Partial<TriageRunOptions> = {}) => {
    const options: TriageRunOptions = { path: dir, minRank: 0, includeTests: false, model: "sonnet", concurrency: 2, budgetUsd: 5, controls: CONTROLS, controlCount: 2, seed: "fixed" };
    return runTriage({ ...options, ...extra, runner });
  };
  const withFiles = (runId: string) => ({ verdictsDir, runId });

  async function rebuildGraphDb(): Promise<void> {
    const codewatch = join(dir, ".codewatch");
    for (const name of readdirSync(codewatch).filter((n) => n.startsWith("graph.db"))) rmSync(join(codewatch, name));
    await audit();
  }

  function foldIntoHead(id: string): void {
    renameSync(fragment(id), head());
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "triage-files-"));
    verdictsDir = join(dir, ".codewatch");
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "__init__.py"), "");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
    writeFileSync(join(dir, "pkg", "extra.py"), EXTRA_SRC);
    await audit();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes no model calls on an unchanged tree after graph.db is deleted and rebuilt", async () => {
    const first = await triage(countingReader().runner, withFiles("cp-1"));
    expect(readJsonl(fragment("cp-1")).map((r) => r.key).sort()).toEqual(first.verdicts.map((v) => v.key).sort());

    await rebuildGraphDb();
    const second = countingReader();
    const { report } = await triage(second.runner, withFiles("cp-2"));

    expect(second.calls()).toBe(0);
    expect(existsSync(fragment("cp-2"))).toBe(false);
    expect(report.verdictStore.files).toEqual({ dir: verdictsDir, reused: 2, fragment: null });
    const view = readJsonl(join(dir, ".codewatch", "audit", "verdicts.jsonl"));
    expect(view.map((r) => r.key).sort()).toEqual(first.verdicts.map((v) => v.key).sort());
    expect(view.every((r) => r.provenance === "file" && r.runId === "cp-1")).toBe(true);
  });

  it("ignores committed files and writes no fragment when the flag is not given", async () => {
    await triage(countingReader().runner, withFiles("cp-1"));
    const fragmentBytes = readFileSync(fragment("cp-1"), "utf8");

    await rebuildGraphDb();
    const again = countingReader();
    const { report } = await triage(again.runner);

    expect(again.asked.map((q) => q.path).sort()).toEqual(["pkg/core.py", "pkg/extra.py"]);
    expect(report.verdictStore.files).toBeUndefined();
    expect(readdirSync(join(verdictsDir, "verdicts.d"))).toEqual(["cp-1.jsonl"]);
    expect(readFileSync(fragment("cp-1"), "utf8")).toBe(fragmentBytes);
  });

  it("keeps the first attempt's verdicts when a run id is reused for a retry", async () => {
    const partial = fakeReader((q, prompt) => (q.path === "pkg/extra.py" ? [] : [row(q, prompt, "justified")]));
    await triage(partial, withFiles("cp-2"));
    expect(readJsonl(fragment("cp-2")).map((r) => r.path)).toEqual(["pkg/core.py"]);

    const retry = countingReader();
    await triage(retry.runner, withFiles("cp-2"));

    expect(retry.asked.map((q) => q.path)).toEqual(["pkg/extra.py"]);
    expect(readJsonl(fragment("cp-2")).map((r) => r.path)).toEqual(["pkg/core.py", "pkg/extra.py"]);
  });

  it("refuses to rewrite a fragment it cannot read whole", async () => {
    mkdirSync(join(verdictsDir, "verdicts.d"));
    writeFileSync(fragment("cp-2"), "{not json\n");

    await expect(triage(countingReader().runner, withFiles("cp-2"))).rejects.toThrow(/refusing to rewrite/);
    expect(readFileSync(fragment("cp-2"), "utf8")).toBe("{not json\n");
  });

  it("writes only the changed finding's verdict to the new fragment and leaves the head file alone", async () => {
    await triage(countingReader().runner, withFiles("cp-1"));
    foldIntoHead("cp-1");
    const headBytes = readFileSync(head(), "utf8");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC.replace("v / total", "v * total"));

    await rebuildGraphDb();
    const second = countingReader();
    const { report } = await triage(second.runner, withFiles("cp-2"));

    expect(second.asked.map((q) => q.path)).toEqual(["pkg/core.py"]);
    expect(readFileSync(head(), "utf8")).toBe(headBytes);
    expect(readJsonl(fragment("cp-2")).map((r) => [r.path, r.provenance, r.runId])).toEqual([["pkg/core.py", "model", "cp-2"]]);
    expect(report.verdictStore.files).toEqual({ dir: verdictsDir, reused: 1, fragment: fragment("cp-2") });
  });

  it("lets a later fragment replace the head's verdict for the same key", async () => {
    await triage(countingReader().runner, withFiles("cp-1"));
    foldIntoHead("cp-1");
    const [overridden, ...rest] = readJsonl(head());
    writeFileSync(fragment("cp-2"), `${JSON.stringify({ ...overridden!, verdict: "confirmed", runId: "cp-2" })}\n`);

    await rebuildGraphDb();
    const { report } = await triage(countingReader().runner, withFiles("cp-3"));

    const byKey = new Map(report.verdictStore.reused.map((r) => [r.key, r.verdict]));
    expect(byKey.get(overridden!.key)).toBe("confirmed");
    for (const r of rest) expect(byKey.get(r.key)).toBe("justified");
  });

  it("skips a malformed line with a warning and still reuses the rest", async () => {
    await triage(countingReader().runner, withFiles("cp-1"));
    writeFileSync(fragment("cp-1"), `${readFileSync(fragment("cp-1"), "utf8")}{not json\n`);

    await rebuildGraphDb();
    const again = countingReader();
    const { report } = await triage(again.runner, withFiles("cp-2"));

    expect(again.calls()).toBe(0);
    expect(report.warnings).toEqual([`${fragment("cp-1")}:3 is not a verdict row; skipped`]);
  });

  it("skips a parseable row graph.db would reject and still saves the run beside a changed finding", async () => {
    await triage(countingReader().runner, withFiles("cp-1"));
    foldIntoHead("cp-1");
    const rows = readJsonl(head());
    const badLine = rows.findIndex((r) => r.path === "pkg/extra.py") + 1;
    writeFileSync(head(), rows.map((r) => JSON.stringify(r.path === "pkg/extra.py" ? { ...r, verdict: "Confirmed" } : r)).join("\n") + "\n");
    writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC.replace("v / total", "v * total"));

    await rebuildGraphDb();
    const again = countingReader();
    const { report } = await triage(again.runner, withFiles("cp-2"));

    expect(again.asked.map((q) => q.path).sort()).toEqual(["pkg/core.py", "pkg/extra.py"]);
    expect(report.warnings).toEqual([`${head()}:${badLine} is not a verdict row; skipped`]);
    expect(readJsonl(fragment("cp-2")).map((r) => r.path).sort()).toEqual(["pkg/core.py", "pkg/extra.py"]);
  });
});
