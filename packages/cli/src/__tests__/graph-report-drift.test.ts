import { describe, it, expect } from "vitest";
import { computeReportDrift } from "../commands/graph-report-drift.js";
import type {
  BusFactorRow,
  CouplingRow,
  HotspotRow,
} from "../commands/graph-report-types.js";

const SNAP = {
  id: 99,
  ref: "baseline",
  commitHash: null,
  takenAt: new Date(0).toISOString(),
  indexVersion: "0.1.0",
  attrs: {},
};

function hot(id: string, score: number): HotspotRow {
  return { nodeId: id, churn: 0, complexity: 0, score };
}

function silo(id: string, churn = 0): BusFactorRow {
  return { nodeId: id, busFactor: 1, topAuthorShare: 1, churn };
}

function pair(a: string, b: string, count: number): CouplingRow {
  return { fileA: a, fileB: b, count };
}

describe("computeReportDrift — hotspots", () => {
  it("classifies entries by presence/absence/score-delta", () => {
    const drift = computeReportDrift({
      baselineSnapshot: SNAP,
      currentHotspots: [hot("a", 100), hot("b", 80), hot("d", 50)],
      baselineHotspots: [hot("a", 90), hot("b", 100), hot("c", 60)],
      currentSilos: [],
      baselineSilos: [],
      currentCoupling: [],
      baselineCoupling: [],
    });
    expect(drift.newHotspots.map((r) => r.nodeId)).toEqual(["d"]);
    expect(drift.resolvedHotspots.map((r) => r.nodeId)).toEqual(["c"]);
    expect(drift.worsenedHotspots.map((d) => d.nodeId)).toEqual(["a"]);
    expect(drift.improvedHotspots.map((d) => d.nodeId)).toEqual(["b"]);
    expect(drift.worsenedHotspots[0]!.delta).toBe(10);
    expect(drift.improvedHotspots[0]!.delta).toBe(-20);
  });

  it("sorts worsened by absolute delta desc", () => {
    const drift = computeReportDrift({
      baselineSnapshot: SNAP,
      currentHotspots: [hot("a", 200), hot("b", 110)],
      baselineHotspots: [hot("a", 100), hot("b", 100)],
      currentSilos: [],
      baselineSilos: [],
      currentCoupling: [],
      baselineCoupling: [],
    });
    expect(drift.worsenedHotspots.map((d) => d.nodeId)).toEqual(["a", "b"]);
  });
});

describe("computeReportDrift — silos", () => {
  it("flags newly-emerged silos and resolved silos", () => {
    const drift = computeReportDrift({
      baselineSnapshot: SNAP,
      currentHotspots: [],
      baselineHotspots: [],
      currentSilos: [silo("a", 50), silo("b", 200)],
      baselineSilos: [silo("a", 10), silo("c", 80)],
      currentCoupling: [],
      baselineCoupling: [],
    });
    expect(drift.newSilos.map((s) => s.nodeId)).toEqual(["b"]);
    expect(drift.resolvedSilos.map((s) => s.nodeId)).toEqual(["c"]);
  });
});

describe("computeReportDrift — coupling", () => {
  it("flags new pairs and intensified counts", () => {
    const drift = computeReportDrift({
      baselineSnapshot: SNAP,
      currentHotspots: [],
      baselineHotspots: [],
      currentSilos: [],
      baselineSilos: [],
      currentCoupling: [pair("a", "b", 5), pair("c", "d", 3), pair("e", "f", 2)],
      baselineCoupling: [pair("a", "b", 2), pair("c", "d", 3)],
    });
    expect(drift.newCoupling.map((p) => `${p.fileA}|${p.fileB}`)).toEqual(["e|f"]);
    expect(drift.intensifiedCoupling.map((p) => `${p.fileA}|${p.fileB}`)).toEqual(
      ["a|b"],
    );
    expect(drift.intensifiedCoupling[0]!.before).toBe(2);
    expect(drift.intensifiedCoupling[0]!.after).toBe(5);
  });
});
