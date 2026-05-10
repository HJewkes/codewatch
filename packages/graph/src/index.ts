export type {
  NodeKind,
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
