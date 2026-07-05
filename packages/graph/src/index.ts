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
  LayeredDepsRule,
  NoInternalOnlyBarrelsRule,
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
  parseSymbolId,
} from "./extractors/ids.js";

export {
  runGraphIndex,
  type GraphIndexOptions,
  type GraphIndexResult,
  type GraphIndexDurations,
} from "./indexer.js";

export { diffSnapshots, type DiffSnapshotsOptions } from "./diff.js";
export { computeMetrics } from "./metrics.js";
export { resolveBarrelEdges, edgeWeight } from "./barrel-resolve.js";
export { computeSourceMetrics } from "./source-metrics.js";
export { walkSourceFiles } from "./file-walk.js";
export { computeLcomMetrics } from "./lcom.js";
export {
  computeChurnMetrics,
  loadChurnEntries,
  parseChurnLog,
  aggregateChurn,
  resolveRenamedPath,
  type ChurnEntry,
  type ComputeChurnOptions,
} from "./churn.js";
export { detectGitToplevel, resolveGitRef } from "./git-renames.js";
export {
  computeChangeCoupling,
  couplingFor,
  type CoEditPair,
  type ChangeCouplingResult,
  type ComputeChangeCouplingOptions,
} from "./change-coupling.js";
export {
  computeSymbolConsumers,
  computeSymbolCoupling,
  type ReferenceEdgeLite,
  type SymbolConsumers,
  type SymbolCouplingPair,
  type SymbolCouplingOptions,
} from "./symbol-coupling.js";
export {
  computeOwnershipMetrics,
  computeTestCoverageOwnership,
  type ComputeOwnershipOptions,
  type OwnershipForFile,
} from "./ownership.js";
export {
  linkTestsToSources,
  testCoverageCountMetrics,
  groupTestsBySource,
  type TestSourceLink,
  type LinkMethod,
  type LinkTestsOptions,
} from "./test-linker.js";
export { patternToRegex, compilePatterns, matchesAny } from "./patterns.js";
export {
  computePageRank,
  getEdgeWeight,
  type PageRankOptions,
  type PageRankResult,
  type PageRankRow,
} from "./pagerank.js";
export {
  computePartitionQuality,
  invertBuckets,
  type PartitionQualityInput,
  type PartitionQualityResult,
  type PackageStats,
  type PairCoupling,
  type PackageFlag,
  type PairFlag,
  type PackageLayer,
} from "./partition-quality.js";
export {
  runChecks,
  validateRules,
  type RunChecksOptions,
  type ValidateRulesOptions,
} from "./check.js";
export {
  diffCheckResults,
  type CheckDiff,
  type DiffCheckResultsOptions,
  type UnchangedViolation,
} from "./check-diff.js";
export { classifyRole, annotateRoles, ALL_ROLES } from "./roles.js";
export {
  canonicalMetricName,
  canonicalRole,
  canonicalEdgeKind,
  metricAliasTarget,
  roleAliasTarget,
} from "./aliases.js";
export {
  planPrune,
  runPrune,
  type PrunePlan,
  type PruneOptions,
  type PruneResult,
} from "./prune.js";
export {
  attributeCoverage,
  COVERAGE_METRIC_NAME,
  type IstanbulCoverage,
  type SymbolSpan,
} from "./coverage.js";
