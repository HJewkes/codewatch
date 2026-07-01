import { loadChurnEntries, openDatabase, computePageRank } from "@code-style/graph";
import { runGraphReportCommand } from "./graph-report.js";
import { runGraphCheckCommand } from "./graph-check.js";
import { runGraphArchCommand } from "./graph-arch.js";

/**
 * Payload assembly for `graph dashboard`. Kept separate from the command wiring
 * so the command file stays small (the report/check/arch reuse and the per-window
 * window-signature dedup live here).
 */

export interface DashboardCommandOptions {
  db: string;
  config: string;
  out: string;
  graph?: boolean;
  repoRoot?: string;
  windowDays?: number;
  vs?: string;
  repo?: string;
  includeScripts?: boolean;
}

export interface ArchInfo {
  boundaryHealth?: number;
  packages: { pkgId: string; instability: number; abstractness: number; fileCount: number; layer: string; cohesion: number; crossEdges: number }[];
}

/**
 * Snapshot-level (window-independent) derived data: which file pairs are joined
 * by a static import edge, and each node's PageRank centrality. Computed once
 * per snapshot from a single db open, shared across all window payloads.
 */
export interface SnapshotContext {
  linkedPairs: ReadonlySet<string>;
  centrality: ReadonlyMap<string, number>;
}

export function buildPayload(
  report: ReturnType<typeof runGraphReportCommand>,
  violations: { rule: string; severity: "error" | "warning"; file: string; detail: string; status: "new" | "carry" | "fixed" }[],
  arch: ArchInfo,
  opts: DashboardCommandOptions,
  authorCount: number | undefined,
  snapCtx: SnapshotContext,
) {
  const boundaryHealth = arch.boundaryHealth;
  const snap = report.snapshot;
  const linkedPairs = snapCtx.linkedPairs;
  const scary = report.hotspots.filter((h) => h.score >= 3000).length;
  const openNew = violations.filter((v) => v.status === "new").length;
  const carry = violations.filter((v) => v.status === "carry").length;
  const maxComplexity = report.hotspots.reduce((m, h) => Math.max(m, h.complexity), 0);
  const health = Math.max(0, Math.min(100, 100 - scary * 6 - (openNew + carry) * 5));
  const vs = opts.vs;

  return {
    meta: {
      repo: opts.repo ?? "repo",
      snapshotId: snap.id,
      ref: snap.ref ?? "wd",
      windowDays: report.windowDays,
      generatedAt: new Date().toISOString(),
      indexVersion: snap.indexVersion,
      authorCount,
      emptyWindow: report.emptyWindow ?? false,
      hint: report.hint,
      // Resolve the baseline snapshot id from the drift comparison (0 only when
      // no drift was computed, e.g. baseline == current) instead of hardcoding 0.
      baseline: vs ? { ref: vs, snapshotId: report.drift?.baselineSnapshot.id ?? 0 } : null,
    },
    kpis: {
      health,
      scaryHotspots: scary,
      knowledgeSilos: report.busFactorRisks.length,
      boundaryHealth,
      openViolations: { total: openNew + carry, new: openNew, carry, fixed: 0 },
      maxComplexity,
    },
    hotspots: report.hotspots.map((h) => ({
      nodeId: h.nodeId, churn: h.churn, complexity: h.complexity, score: h.score,
    })),
    busFactorRisks: report.busFactorRisks.map((b) => ({
      nodeId: b.nodeId, topAuthorShare: b.topAuthorShare, churn: b.churn,
    })),
    testCoverageRisks: report.testCoverageRisks.map((t) => ({
      nodeId: t.nodeId, testBusFactor: t.testBusFactor,
      testTopAuthorShare: t.testTopAuthorShare, linkedTests: t.linkedTests,
    })),
    couplingClusters: report.couplingClusters.map((c) => ({
      a: c.fileA, b: c.fileB, coEdits: c.count, hidden: !linkedPairs.has(pairKey(c.fileA, c.fileB)),
    })),
    centralFiles: buildCentralFiles(report, snapCtx.centrality),
    packages: arch.packages,
    violations,
    drift: report.drift && {
      baselineSnapshotId: report.drift.baselineSnapshot.id,
      newHotspots: report.drift.newHotspots.map((h) => ({ nodeId: h.nodeId, score: h.score })),
      worsened: report.drift.worsenedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      improved: report.drift.improvedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      resolved: report.drift.resolvedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      newSilos: report.drift.newSilos.map((s) => s.nodeId),
      newCoupling: report.drift.newCoupling.map((c) => ({ a: c.fileA, b: c.fileB, coEdits: c.count, hidden: !linkedPairs.has(pairKey(c.fileA, c.fileB)) })),
    },
  };
}

export type DashboardPayload = ReturnType<typeof buildPayload>;

const DEFAULT_WINDOWS = [30, 90, 180];

/**
 * Build one payload per churn window (30/90/180 + any requested), deduped by
 * content so the client-side window switcher only appears when the data
 * genuinely differs. Returns the kept windows, the primary window key, and the
 * resolved snapshot id.
 */
export function computeWindowPayloads(
  opts: DashboardCommandOptions,
  repoRoot: string,
  violations: Awaited<ReturnType<typeof collectViolations>>,
  arch: ArchInfo,
): { windows: Record<string, DashboardPayload>; primaryKey: string; snapshotId: number } {
  const primaryWindow = opts.windowDays ?? 30;
  const windowsList = Array.from(new Set([primaryWindow, ...DEFAULT_WINDOWS])).sort((a, b) => a - b);
  const windows: Record<string, DashboardPayload> = {};
  const sigToKey = new Map<string, string>();
  let snapshotId = 0;
  let primaryKey = String(primaryWindow);
  // Import-linkage + centrality are snapshot-level (same for every window);
  // compute lazily once the first report resolves the snapshot id.
  let snapCtx: SnapshotContext = { linkedPairs: new Set(), centrality: new Map() };
  for (const w of windowsList) {
    const report = runGraphReportCommand({
      db: opts.db, repoRoot, windowDays: w, vs: opts.vs, includeScripts: opts.includeScripts,
    });
    if (report.snapshot.id !== snapshotId) snapCtx = snapshotContext(opts.db, report.snapshot.id);
    snapshotId = report.snapshot.id;
    const payload = buildPayload(report, violations, arch, opts, windowAuthorCount(repoRoot, w), snapCtx);
    const sig = windowSignature(payload);
    const existing = sigToKey.get(sig);
    if (existing) {
      if (w === primaryWindow) primaryKey = existing; // point primary at the kept key
      continue;
    }
    sigToKey.set(sig, String(w));
    windows[String(w)] = payload;
    if (w === primaryWindow) primaryKey = String(w);
  }
  return { windows, primaryKey, snapshotId };
}

export function archInfo(db: string, repoRoot: string): ArchInfo {
  try {
    const arch = runGraphArchCommand({ db, repoRoot, health: true });
    const q = arch.quality;
    return {
      boundaryHealth: q?.modularityQ,
      packages: (q?.perPackage ?? []).map((p) => ({
        pkgId: p.pkgId,
        instability: p.instability,
        abstractness: p.abstractness,
        fileCount: p.fileCount,
        layer: p.layer,
        cohesion: p.cohesion,
        // Cross-package edges: 0 ⇒ an isolated dir, not a real package (its
        // instability is a meaningless 0/0). The Architecture view drops these.
        crossEdges: p.outgoingEdges + p.incomingEdges,
      })),
    };
  } catch {
    return { packages: [] }; // arch is a nice-to-have; never fail the dashboard.
  }
}

export async function collectViolations(opts: DashboardCommandOptions) {
  try {
    const check = await runGraphCheckCommand({
      db: opts.db,
      config: opts.config,
      baseline: opts.vs ?? "previous",
    });
    return check.result.violations.map((v) => ({
      rule: v.ruleId,
      severity: (v.severity === "warning" ? "warning" : "error") as "error" | "warning",
      file: v.nodeId,
      detail: v.message,
      status: (v.isCarryover ? "carry" : "new") as "new" | "carry" | "fixed",
    }));
  } catch {
    return []; // no config / no baseline → render Fitness as "all clear".
  }
}

/** Signature over all window-dependent fields, to collapse identical windows. */
export function windowSignature(p: DashboardPayload): string {
  return JSON.stringify([p.hotspots, p.busFactorRisks, p.testCoverageRisks, p.couplingClusters, p.violations, p.centralFiles, p.kpis, p.meta.authorCount]);
}

/**
 * Distinct commit authors (by email) in the window, for the single-author guard
 * the dashboard uses to suppress degenerate bus-factor widgets. `undefined` when
 * git is unavailable — the guard then stays off rather than falsely claiming solo.
 */
export function windowAuthorCount(repoRoot: string, windowDays: number): number | undefined {
  const entries = loadChurnEntries({ repoRoot, windowDays });
  if (entries === null) return undefined;
  return new Set(entries.map((e) => e.author)).size;
}

/** Order-independent key for an undirected file pair (JSON tuple; no in-band separator). */
function pairKey(a: string, b: string): string {
  return a < b ? JSON.stringify([a, b]) : JSON.stringify([b, a]);
}

/**
 * Reading-order centrality (top-N central files) PLUS the centrality of every
 * node referenced elsewhere in the payload (hotspots, silos, coupling), so the
 * Dossier can always show a PageRank score instead of "—" for a hotspot that
 * falls outside the top-N central list. Sorted descending, so the Overview
 * "reading order" (top-6 slice) is unaffected.
 */
function buildCentralFiles(
  report: ReturnType<typeof runGraphReportCommand>,
  centrality: ReadonlyMap<string, number>,
): { nodeId: string; score: number }[] {
  const byId = new Map<string, number>();
  for (const c of report.centralFiles) byId.set(c.nodeId, c.score);
  const referenced = new Set<string>();
  for (const h of report.hotspots) referenced.add(h.nodeId);
  for (const b of report.busFactorRisks) referenced.add(b.nodeId);
  for (const c of report.couplingClusters) { referenced.add(c.fileA); referenced.add(c.fileB); }
  for (const id of referenced) if (!byId.has(id)) byId.set(id, centrality.get(id) ?? 0);
  return [...byId].map(([nodeId, score]) => ({ nodeId, score })).sort((a, b) => b.score - a.score);
}

/**
 * Snapshot-level derived data from a single db open: the set of file pairs
 * joined by a static `imports`/`re-exports` edge (a co-changed pair NOT in it is
 * "hidden" coupling — the actionable signal; test↔source and generated↔generator
 * pairs *do* import, so this demotes those tautologies), plus each node's
 * PageRank centrality. Window-independent — computed once per snapshot.
 */
export function snapshotContext(dbPath: string, snapshotId: number): SnapshotContext {
  const linkedPairs = new Set<string>();
  const centrality = new Map<string, number>();
  const db = openDatabase(dbPath);
  try {
    const nodes = db.listNodes(snapshotId);
    const edges = db.listEdges(snapshotId);
    for (const e of edges) {
      if (e.kind === "imports" || e.kind === "re-exports") linkedPairs.add(pairKey(e.srcId, e.dstId));
    }
    for (const r of computePageRank(nodes, edges).rows) centrality.set(r.nodeId, r.score);
  } finally {
    db.close();
  }
  return { linkedPairs, centrality };
}
