import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  openCodeGraph,
  type CodeGraphStore,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
} from "@titan-design/code-graph";
import { runGraphScoreCommand, type GraphScoreCommandOptions } from "../commands/graph-score.js";
import { formatGraphScoreText } from "../commands/graph-score-format.js";
import { NO_QUALITY_MESSAGE } from "../commands/graph-score-inputs.js";

const FILES = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];

function treeNodes(): GraphNode[] {
  const files = FILES.map((id) => ({ id, kind: "file" as const, name: id }));
  const symbols = FILES.map((f) => ({ id: `${f}#run`, kind: "symbol" as const, name: "run", parentId: f }));
  return [...files, ...symbols];
}

/** Simple functions: CC 3 over 9 lines each, so erosion stays 0. */
function symbolMetrics(): GraphMetric[] {
  return FILES.flatMap((f) => [
    { nodeId: `${f}#run`, name: "symbol_cyclomatic", value: 3 },
    { nodeId: `${f}#run`, name: "symbol_body_lines", value: 9 },
  ]);
}

function imports(src: string, dst: string, weight: number): GraphEdge {
  return { srcId: src, dstId: dst, kind: "imports", attrs: { weight } };
}

function addSnapshot(
  dbPath: string,
  extra: { edges?: GraphEdge[]; metrics?: GraphMetric[]; withQuality?: boolean },
): void {
  const db: CodeGraphStore = openCodeGraph(dbPath);
  try {
    const id = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
    db.insertNodes(id, treeNodes());
    db.insertEdges(id, extra.edges ?? [imports("src/c.ts", "src/d.ts", 40)]);
    const base = extra.withQuality === false ? [] : symbolMetrics();
    db.insertMetrics(id, [...base, ...(extra.metrics ?? [])]);
  } finally {
    db.close();
  }
}

/** One scary hotspot (100 × 30 = 3000) and 2 of 40 import weight in an a ⇄ b value cycle. */
function addDegradedSnapshot(dbPath: string): void {
  addSnapshot(dbPath, {
    edges: [imports("src/a.ts", "src/b.ts", 1), imports("src/b.ts", "src/a.ts", 1), imports("src/c.ts", "src/d.ts", 38)],
    metrics: [
      { nodeId: "src/a.ts", name: "churn_30d", value: 100 },
      { nodeId: "src/a.ts", name: "cognitive_max", value: 30 },
    ],
  });
}

describe("runGraphScoreCommand", () => {
  let dir: string;
  let options: GraphScoreCommandOptions;
  let tick: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "codewatch-score-"));
    tick = 0;
    options = {
      db: path.join(dir, "graph.db"),
      repoRoot: dir,
      config: path.join(dir, "no-rules.json"),
      history: path.join(dir, ".codewatch", "score-history.jsonl"),
      now: () => new Date(Date.UTC(2026, 0, 1 + tick++)),
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("scores a clean tree 100 with no previous run and stores one history line", async () => {
    addSnapshot(options.db, {});

    const result = await runGraphScoreCommand(options);

    expect(result.run.score).toBe(100);
    expect(result.run.formulaVersion).toBe(1);
    expect(result.previous).toBeUndefined();
    expect(fs.readFileSync(options.history, "utf-8").trim().split("\n")).toHaveLength(1);
    expect(formatGraphScoreText(result).split("\n")[0]).toBe("score 100.0 (no previous run)");
  });

  it("pins the score and delta after a hotspot and a value cycle land, then compares with the last run", async () => {
    addSnapshot(options.db, {});
    await runGraphScoreCommand(options);
    addDegradedSnapshot(options.db);

    const second = await runGraphScoreCommand(options);
    const third = await runGraphScoreCommand(options);

    expect(second.run.score).toBe(88);
    expect(second.previous!.score).toBe(100);
    expect(second.delta!.score).toBe(-12);
    expect(second.delta!.components).toMatchObject({ "scary hotspots": 10, "value cycles": 2 });
    expect(formatGraphScoreText(second).split("\n")[0]).toBe("score 88.0 (Δ -12.0 vs snapshot 1 2026-01-01)");
    expect(third.run.score).toBe(88);
    expect(third.delta!.score).toBe(0);
  });

  it("refuses a snapshot without the quality measures and leaves the history untouched", async () => {
    addSnapshot(options.db, {});
    await runGraphScoreCommand(options);
    const before = fs.readFileSync(options.history);
    addSnapshot(options.db, { withQuality: false });

    await expect(runGraphScoreCommand(options)).rejects.toThrow(NO_QUALITY_MESSAGE);

    expect(fs.readFileSync(options.history).equals(before)).toBe(true);
  });

  it("lists the last two runs newest first in the trend", async () => {
    addSnapshot(options.db, {});
    await runGraphScoreCommand(options);
    addDegradedSnapshot(options.db);

    const result = await runGraphScoreCommand({ ...options, last: 2 });

    expect(result.trend.map((t) => [t.run.score, t.delta])).toEqual([
      [88, -12],
      [100, undefined],
    ]);
  });
});
