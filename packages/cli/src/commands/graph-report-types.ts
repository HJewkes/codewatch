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
}
