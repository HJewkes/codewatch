/**
 * Dashboard data contract. A single JSON payload — produced by
 * `scripts/build-data.mjs` from `graph report --json` + `graph check` — is
 * injected as `window.__CODEWATCH__` into the built HTML (mirroring how the
 * render package injects `window.__GRAPH__`).
 */

export type Severity = "error" | "warning";
export type ViolationStatus = "new" | "carry" | "fixed";

export interface DashboardMeta {
  repo: string;
  snapshotId: number;
  ref: string;
  windowDays: number;
  generatedAt: string;
  indexVersion?: string;
  fileCount?: number;
  /** Distinct commit authors in the window; 1 ⇒ ownership widgets are N/A. */
  authorCount?: number;
  /** True when no file has churn in the window — churn widgets degrade. */
  emptyWindow?: boolean;
  hint?: string;
  baseline?: { ref: string; snapshotId: number } | null;
}

/** One penalty component of the composite health score (higher penalty = worse). */
export interface HealthComponent {
  label: string;
  penalty: number;
  detail: string;
}

export interface Kpis {
  /** Composite health 0–100, higher = healthier. */
  health: number;
  /** Transparent breakdown of the penalties subtracted from 100. */
  healthBreakdown?: HealthComponent[];
  healthTrend?: number;
  /** Count of files over the scary-hotspots threshold (score ≥ 3000). NOT the
   * count of hotspots new since baseline — that lives in `drift.newHotspots`. */
  scaryHotspots: number;
  knowledgeSilos: number;
  /** Modularity Q, 0–1, higher = cleaner package boundaries. */
  boundaryHealth?: number;
  openViolations: { total: number; new: number; carry: number; fixed: number };
  maxComplexity: number;
}

export interface Hotspot {
  nodeId: string;
  churn: number;
  complexity: number;
  score: number;
  /** Age-recency factor applied to the score (1 = no discount, <1 = new-file discount). */
  recency?: number;
  role?: string;
}

export interface BusFactorRisk {
  nodeId: string;
  topAuthorShare: number;
  churn: number;
}

export interface CouplingPair {
  a: string;
  b: string;
  coEdits: number;
  /** True when both files are indexed but NO import edge joins them — hidden coupling. */
  hidden?: boolean;
  /**
   * True when an endpoint has no node in the snapshot graph (e.g. a dir outside
   * the indexed workspace) — the import edge, if any, is invisible, so the pair
   * can't be called hidden or import-backed. Rendered as "unverifiable".
   */
  unindexed?: boolean;
}

export interface CentralFile {
  nodeId: string;
  score: number;
}

/**
 * Per-file structural metrics for the Dossier, keyed against fitness budgets so
 * the drawer shows a heat-colored readout of *why* a file is (or isn't) at risk.
 * Present only for files referenced elsewhere in the payload (i.e. any file the
 * Dossier can be opened on). Fields absent when the metric wasn't computed.
 */
export interface NodeMetrics {
  loc?: number;
  cognitiveMax?: number;
  cyclomaticMax?: number;
  maxNesting?: number;
  fanIn?: number;
  fanOut?: number;
  /** Inbound reference count (C-52): how heavily this file's exports are used. */
  utilization?: number;
  /** Distinct test files linking to this source (C-4); shown in the Dossier (C-59). */
  linkedTests?: number;
  /** Node role (e.g. "barrel") — explains barrel-resolved utilization=0. */
  role?: string;
}

export interface TestCoverageRisk {
  /** Source (non-test) file whose test coverage is owner-concentrated. */
  nodeId: string;
  /** Bus factor of the linked test files' authorship (1 = single test owner). */
  testBusFactor: number;
  /** Share of test churn from the single largest test author (0..1). */
  testTopAuthorShare: number;
  /** How many distinct test files link to this source. */
  linkedTests: number;
}

export interface Violation {
  rule: string;
  severity: Severity;
  file: string;
  detail: string;
  status: ViolationStatus;
}

export interface HotspotDelta {
  nodeId: string;
  before: number;
  after: number;
  delta: number;
}

export interface Drift {
  baselineSnapshotId: number;
  /** `before` is the baseline score of a file that existed then; `undefined` ⇒
   * newborn file (absent from baseline). Splits neutral new files from existing
   * files that climbed into the hotspot ranking. */
  newHotspots: { nodeId: string; score: number; before?: number }[];
  worsened: HotspotDelta[];
  improved: HotspotDelta[];
  resolved: HotspotDelta[];
  newSilos: string[];
  newCoupling: CouplingPair[];
}

export interface PackageStat {
  pkgId: string;
  /** Martin's instability I = fan-out / (fan-in + fan-out), 0..1. */
  instability: number;
  /** Abstractness proxy A = share of type-definition files, 0..1. */
  abstractness: number;
  fileCount: number;
  layer: string;
  cohesion: number;
  /** Cross-package edges; 0 ⇒ isolated dir (instability is a meaningless 0/0). */
  crossEdges?: number;
}

/** One export's per-symbol detail for the Dossier "Exports" table (C-53 utilization + C-59 complexity/consumers). */
export interface HotExport {
  name: string;
  utilization: number;
  /** The export's OWN cognitive complexity (C-58); undefined for a class/type/re-export. */
  cognitive?: number;
  /** Distinct files that reference this export (inbound `references` edges, C-59). */
  consumers: number;
}

/** A high-blast-radius export: heavily used, in a complex + churning file (C-53). */
export interface BlastRadiusEntry {
  symbolId: string;
  name: string;
  fileId: string;
  utilization: number;
  complexity: number;
  churn: number;
  score: number;
}

export interface CodewatchData {
  meta: DashboardMeta;
  kpis: Kpis;
  hotspots: Hotspot[];
  busFactorRisks: BusFactorRisk[];
  /** Test-coverage ownership (C-4): meaningful even on a single-author repo. */
  testCoverageRisks?: TestCoverageRisk[];
  couplingClusters: CouplingPair[];
  centralFiles: CentralFile[];
  /** Structural metrics keyed by nodeId, for the Dossier heat readout. */
  nodeMetrics?: Record<string, NodeMetrics>;
  /** Per-file ranked hot exports (C-53), keyed by fileId. */
  hotExports?: Record<string, HotExport[]>;
  /** Exports ranked by blast radius = utilization × complexity × churn (C-53). */
  blastRadius?: BlastRadiusEntry[];
  packages?: PackageStat[];
  violations: Violation[];
  drift?: Drift;
}

declare global {
  interface Window {
    __CODEWATCH__?: CodewatchData;
    /** Per-window payloads (keyed by window-days) for client-side switching. */
    __CODEWATCH_WINDOWS__?: Record<string, CodewatchData>;
    /** Base64 of the render-package Cytoscape dependency-graph HTML (embed). */
    __CODEWATCH_GRAPH__?: string;
  }
}
