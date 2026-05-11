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

export interface GraphReportResult {
  snapshot: SnapshotRow;
  windowDays: number;
  hotspots: HotspotRow[];
  busFactorRisks: BusFactorRow[];
  couplingClusters: CouplingRow[];
  centralFiles: CentralRow[];
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
  resolvedHotspots: HotspotRow[];
  worsenedHotspots: HotspotDelta[];
  improvedHotspots: HotspotDelta[];
  newSilos: BusFactorChange[];
  resolvedSilos: BusFactorChange[];
  newCoupling: CouplingRow[];
  intensifiedCoupling: CouplingDelta[];
}
