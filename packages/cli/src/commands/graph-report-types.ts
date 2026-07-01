import type { SnapshotRow } from "@code-style/graph";

export interface HotspotRow {
  nodeId: string;
  churn: number;
  complexity: number;
  score: number;
}

export interface BusFactorRow {
  nodeId: string;
  busFactor: number;
  topAuthorShare: number;
  churn: number;
}

export interface CouplingRow {
  fileA: string;
  fileB: string;
  count: number;
}

export interface CentralRow {
  nodeId: string;
  score: number;
}

export interface TestCoverageRow {
  /** Source (non-test) file whose test coverage is owner-concentrated. */
  nodeId: string;
  /** Bus factor of the linked test files' authorship (1 = single owner). */
  testBusFactor: number;
  /** Share of test churn from the single largest test author (0..1). */
  testTopAuthorShare: number;
  /** How many distinct test files link to this source. */
  linkedTests: number;
}

export interface GraphReportResult {
  snapshot: SnapshotRow;
  windowDays: number;
  hotspots: HotspotRow[];
  busFactorRisks: BusFactorRow[];
  testCoverageRisks: TestCoverageRow[];
  couplingClusters: CouplingRow[];
  centralFiles: CentralRow[];
  /** True when no file has churn > 0 in the window (churn sections all empty). */
  emptyWindow?: boolean;
  /** User-facing guidance shown when emptyWindow is true. */
  hint?: string;
  drift?: ReportDrift;
}

export interface HotspotDelta {
  nodeId: string;
  before: number;
  after: number;
  delta: number;
}

export interface BusFactorChange {
  nodeId: string;
  churn: number;
}

export interface CouplingDelta {
  fileA: string;
  fileB: string;
  before: number;
  after: number;
}

export interface ReportDrift {
  baselineSnapshot: SnapshotRow;
  newHotspots: HotspotRow[];
  /** Was in baseline top-N, score actually went down (or file gone). */
  resolvedHotspots: HotspotDelta[];
  /** Was in baseline top-N, score didn't improve — newer hotspots displaced it. */
  displacedHotspots: HotspotDelta[];
  worsenedHotspots: HotspotDelta[];
  improvedHotspots: HotspotDelta[];
  newSilos: BusFactorChange[];
  /** Was silo (bus_factor=1) in baseline, now bus_factor>1 or no churn in window. */
  resolvedSilos: BusFactorChange[];
  /** Still bus_factor=1, but churn dropped below top-N (still single-owner). */
  displacedSilos: BusFactorChange[];
  newCoupling: CouplingRow[];
  intensifiedCoupling: CouplingDelta[];
}
