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

export interface Kpis {
  /** Composite health 0–100, higher = healthier. */
  health: number;
  healthTrend?: number;
  newHotspots: number;
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
  /** True when the pair is change-coupled but has NO import edge — hidden coupling. */
  hidden?: boolean;
}

export interface CentralFile {
  nodeId: string;
  score: number;
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
  newHotspots: { nodeId: string; score: number }[];
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
}

export interface CodewatchData {
  meta: DashboardMeta;
  kpis: Kpis;
  hotspots: Hotspot[];
  busFactorRisks: BusFactorRisk[];
  couplingClusters: CouplingPair[];
  centralFiles: CentralFile[];
  packages?: PackageStat[];
  violations: Violation[];
  drift?: Drift;
}

declare global {
  interface Window {
    __CODEWATCH__?: CodewatchData;
    /** Per-window payloads (keyed by window-days) for client-side switching. */
    __CODEWATCH_WINDOWS__?: Record<string, CodewatchData>;
  }
}
