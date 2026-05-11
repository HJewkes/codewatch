import type {
  BusFactorChange,
  BusFactorRow,
  CouplingDelta,
  CouplingRow,
  HotspotDelta,
  HotspotRow,
  ReportDrift,
} from "./graph-report-types.js";
import type { SnapshotRow } from "@code-style/graph";

export interface ComputeDriftInput {
  baselineSnapshot: SnapshotRow;
  currentHotspots: readonly HotspotRow[];
  baselineHotspots: readonly HotspotRow[];
  currentSilos: readonly BusFactorRow[];
  baselineSilos: readonly BusFactorRow[];
  currentCoupling: readonly CouplingRow[];
  baselineCoupling: readonly CouplingRow[];
}

export function computeReportDrift(input: ComputeDriftInput): ReportDrift {
  const hot = diffHotspots(input.currentHotspots, input.baselineHotspots);
  const silos = diffSilos(input.currentSilos, input.baselineSilos);
  const coupling = diffCoupling(input.currentCoupling, input.baselineCoupling);
  return {
    baselineSnapshot: input.baselineSnapshot,
    newHotspots: hot.added,
    resolvedHotspots: hot.removed,
    worsenedHotspots: hot.worsened,
    improvedHotspots: hot.improved,
    newSilos: silos.added,
    resolvedSilos: silos.removed,
    newCoupling: coupling.added,
    intensifiedCoupling: coupling.intensified,
  };
}

function diffHotspots(
  cur: readonly HotspotRow[],
  base: readonly HotspotRow[],
): {
  added: HotspotRow[];
  removed: HotspotRow[];
  worsened: HotspotDelta[];
  improved: HotspotDelta[];
} {
  const baseById = new Map(base.map((r) => [r.nodeId, r] as const));
  const curById = new Map(cur.map((r) => [r.nodeId, r] as const));
  const added: HotspotRow[] = [];
  const removed: HotspotRow[] = [];
  const worsened: HotspotDelta[] = [];
  const improved: HotspotDelta[] = [];
  for (const r of cur) {
    const b = baseById.get(r.nodeId);
    if (!b) {
      added.push(r);
      continue;
    }
    const delta = r.score - b.score;
    if (delta > 0) worsened.push({ nodeId: r.nodeId, before: b.score, after: r.score, delta });
    else if (delta < 0) improved.push({ nodeId: r.nodeId, before: b.score, after: r.score, delta });
  }
  for (const b of base) {
    if (!curById.has(b.nodeId)) removed.push(b);
  }
  worsened.sort((a, b) => b.delta - a.delta);
  improved.sort((a, b) => a.delta - b.delta);
  return { added, removed, worsened, improved };
}

function diffSilos(
  cur: readonly BusFactorRow[],
  base: readonly BusFactorRow[],
): { added: BusFactorChange[]; removed: BusFactorChange[] } {
  const baseIds = new Set(base.map((r) => r.nodeId));
  const curIds = new Set(cur.map((r) => r.nodeId));
  const added: BusFactorChange[] = [];
  const removed: BusFactorChange[] = [];
  for (const r of cur) {
    if (!baseIds.has(r.nodeId)) added.push({ nodeId: r.nodeId, churn: r.churn });
  }
  for (const r of base) {
    if (!curIds.has(r.nodeId)) removed.push({ nodeId: r.nodeId, churn: r.churn });
  }
  added.sort((a, b) => b.churn - a.churn);
  removed.sort((a, b) => b.churn - a.churn);
  return { added, removed };
}

function diffCoupling(
  cur: readonly CouplingRow[],
  base: readonly CouplingRow[],
): { added: CouplingRow[]; intensified: CouplingDelta[] } {
  const key = (r: { fileA: string; fileB: string }): string =>
    `${r.fileA}\t${r.fileB}`;
  const baseByKey = new Map(base.map((r) => [key(r), r] as const));
  const added: CouplingRow[] = [];
  const intensified: CouplingDelta[] = [];
  for (const r of cur) {
    const b = baseByKey.get(key(r));
    if (!b) added.push(r);
    else if (r.count > b.count) {
      intensified.push({
        fileA: r.fileA,
        fileB: r.fileB,
        before: b.count,
        after: r.count,
      });
    }
  }
  intensified.sort((a, b) => b.after - b.before - (a.after - a.before));
  return { added, intensified };
}
