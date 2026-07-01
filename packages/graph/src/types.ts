export type NodeKind =
  | "package"
  | "module"
  | "file"
  | "symbol"
  | "external";

export type EdgeKind =
  | "imports"
  | "re-exports"
  | "calls"
  | "extends"
  | "implements"
  | "references"
  | "depends-on";

export type IdAliasReason = "rename" | "move" | "merge";

export type NodeRole =
  | "test"
  | "fixture"
  | "barrel"
  | "types"
  | "config"
  | "script"
  | "source";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId?: string;
  language?: string;
  role?: NodeRole;
  attrs?: Record<string, unknown>;
}

export interface GraphEdge {
  srcId: string;
  dstId: string;
  kind: EdgeKind;
  attrs?: Record<string, unknown>;
}

export interface GraphMetric {
  nodeId: string;
  name: string;
  value: number | null;
  unit?: string;
}

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SnapshotRow {
  id: number;
  ref: string;
  commitHash: string | null;
  takenAt: string;
  indexVersion: string;
  attrs: Record<string, unknown>;
}

export interface EntryPoint {
  nodeId: string;
  kind: string;
  attrs?: Record<string, unknown>;
}

export interface IdAlias {
  oldId: string;
  newId: string;
  reason: IdAliasReason;
}

export interface FileFingerprint {
  fileId: string;
  contentHash: string;
}

export interface MetricDelta {
  nodeId: string;
  name: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface NodeRename {
  oldId: string;
  newId: string;
  reason: IdAliasReason;
  node: GraphNode;
}

export interface GraphDiffSummary {
  fromSnapshotId: number;
  toSnapshotId: number;
  addedNodes: number;
  removedNodes: number;
  renamedNodes: number;
  unchangedNodes: number;
  addedEdges: number;
  removedEdges: number;
  metricChanges: number;
}

export interface GraphDiff {
  summary: GraphDiffSummary;
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  renamedNodes: NodeRename[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  metricDeltas: MetricDelta[];
}

export type Severity = "error" | "warning";

export interface MetricMaxRule {
  type: "metric-max";
  id: string;
  metric: string;
  max: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface MetricMinRule {
  type: "metric-min";
  id: string;
  metric: string;
  min: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface MetricProductMaxRule {
  type: "metric-product-max";
  id: string;
  metrics: string[];
  max: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface ForbidImportRule {
  type: "forbid-import";
  id: string;
  from: string;
  to: string;
  severity?: Severity;
}

export interface LayeredDepsRule {
  type: "layered-deps";
  id: string;
  layers: string[][];
  severity?: Severity;
}

export interface NoInternalOnlyBarrelsRule {
  type: "no-internal-only-barrels";
  id: string;
  /**
   * Path prefixes that mark package roots (e.g. ["packages/cli", "packages/core"]).
   * A barrel and its importer are "same-package" iff they share the same longest-matching prefix.
   * Required because node ids carry no intrinsic notion of package membership.
   */
  packageRoots: string[];
  severity?: Severity;
  /** Globs/substrings to skip — e.g. CLI bin entries that look like barrels to the role classifier. */
  exclude?: string[];
}

export type CheckRule =
  | MetricMaxRule
  | MetricMinRule
  | MetricProductMaxRule
  | ForbidImportRule
  | LayeredDepsRule
  | NoInternalOnlyBarrelsRule;

export interface CheckRulesFile {
  rules: CheckRule[];
}

export interface CheckViolation {
  ruleId: string;
  severity: Severity;
  nodeId: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
  destinationId?: string;
  isCarryover?: boolean;
}

export interface CheckResult {
  snapshotId: number;
  baselineSnapshotId?: number;
  rulesEvaluated: number;
  nodesEvaluated: number;
  violations: CheckViolation[];
  newErrors: number;
  newWarnings: number;
  carryoverErrors: number;
  carryoverWarnings: number;
  passed: boolean;
}
