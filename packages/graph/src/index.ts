export type {
  NodeKind,
  NodeRole,
  EdgeKind,
  IdAliasReason,
  GraphNode,
  GraphEdge,
  GraphMetric,
  GraphFragment,
  SnapshotRow,
  EntryPoint,
  IdAlias,
  MetricDelta,
  NodeRename,
  GraphDiff,
  GraphDiffSummary,
  Severity,
  CheckRule,
  MetricMaxRule,
  MetricMinRule,
  MetricProductMaxRule,
  ForbidImportRule,
  CheckRulesFile,
  CheckViolation,
  CheckResult,
} from "./types.js";

export { runMigrations } from "./migrations.js";
export { openDatabase, GraphDatabase } from "./database.js";

export {
  TsMorphGraphExtractor,
  type TsMorphGraphExtractorOptions,
} from "./extractors/ts-morph-extractor.js";
export {
  fileId,
  moduleId,
  parentModuleId,
  packageId,
  externalId,
} from "./extractors/ids.js";

export {
  runGraphIndex,
  type GraphIndexOptions,
  type GraphIndexResult,
  type GraphIndexDurations,
} from "./indexer.js";

export { diffSnapshots, type DiffSnapshotsOptions } from "./diff.js";
export { computeMetrics } from "./metrics.js";
export { computeSourceMetrics } from "./source-metrics.js";
export {
  computeChurnMetrics,
  parseChurnLog,
  aggregateChurn,
  resolveRenamedPath,
  type ChurnEntry,
  type ComputeChurnOptions,
} from "./churn.js";
export { patternToRegex, compilePatterns, matchesAny } from "./patterns.js";
export { runChecks, validateRules, type RunChecksOptions } from "./check.js";
export { classifyRole, annotateRoles, ALL_ROLES } from "./roles.js";
