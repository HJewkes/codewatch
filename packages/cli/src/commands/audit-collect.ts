import {
  parseSymbolId,
  type CodeGraphStore,
  type GraphMetric,
  type GraphNode,
} from "@titan-design/code-graph";
import type { FileStats, SymbolStats } from "./audit-score.js";

export interface SnapshotStats {
  files: FileStats[];
  symbols: SymbolStats[];
  pythonFiles: string[];
}

type MetricIndex = Map<string, Map<string, number>>;

function indexMetrics(metrics: readonly GraphMetric[]): MetricIndex {
  const byName: MetricIndex = new Map();
  for (const m of metrics) {
    if (m.value === null) continue;
    let values = byName.get(m.name);
    if (!values) byName.set(m.name, (values = new Map()));
    values.set(m.nodeId, m.value);
  }
  return byName;
}

function lineAttr(node: GraphNode, key: string): number | undefined {
  const value = node.attrs?.[key];
  return typeof value === "number" ? value : undefined;
}

function symbolStats(node: GraphNode, metrics: MetricIndex): SymbolStats | null {
  const cognitive = metrics.get("symbol_cognitive")?.get(node.id);
  const parsed = parseSymbolId(node.id);
  if (cognitive === undefined || !parsed) return null;
  return {
    path: parsed.fileId,
    symbol: parsed.name,
    lineStart: lineAttr(node, "startLine"),
    lineEnd: lineAttr(node, "endLine"),
    cognitive,
    cyclomatic: metrics.get("symbol_cyclomatic")?.get(node.id) ?? 0,
  };
}

function maxCognitiveByFile(symbols: readonly SymbolStats[]): Map<string, number> {
  const max = new Map<string, number>();
  for (const s of symbols) max.set(s.path, Math.max(max.get(s.path) ?? 0, s.cognitive));
  return max;
}

/** File and symbol measurements the score table ranks, read from one snapshot. */
export function collectSnapshotStats(store: CodeGraphStore, snapshotId: number): SnapshotStats {
  const nodes = store.listNodes(snapshotId, { includeSymbols: true });
  const metrics = indexMetrics(store.listMetrics(snapshotId));
  const symbols = nodes
    .filter((n) => n.kind === "symbol")
    .map((n) => symbolStats(n, metrics))
    .filter((s): s is SymbolStats => s !== null);
  const cognitiveMax = maxCognitiveByFile(symbols);
  const fileNodes = nodes.filter((n) => n.kind === "file");
  const files = fileNodes.map((n) => ({
    path: n.id,
    loc: metrics.get("loc")?.get(n.id) ?? 0,
    cognitiveMax: cognitiveMax.get(n.id) ?? 0,
  }));
  const pythonFiles = fileNodes.filter((n) => n.language === "python").map((n) => n.id);
  return { files, symbols, pythonFiles };
}
