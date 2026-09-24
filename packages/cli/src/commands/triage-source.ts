import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  hashContent,
  parseSymbolId,
  type CodeGraphStore,
  type GraphNode,
  type NodeRole,
} from "@titan-design/code-graph";
import type { SymbolSpan } from "./audit-score.js";

/** What the bundler reads: file text, symbol spans, and call edges, all pinned to one snapshot. */
export interface BundleSource {
  /** The file's lines, or undefined when it is missing or no longer matches the snapshot. */
  lines(path: string): readonly string[] | undefined;
  symbols(path: string): readonly SymbolSpan[];
  /** The caller of a symbol when exactly one symbol or file calls it. */
  caller(symbolId: string): string | undefined;
}

function lineAttr(node: GraphNode, key: string): number | undefined {
  const value = node.attrs?.[key];
  return typeof value === "number" ? value : undefined;
}

function symbolSpansByFile(nodes: readonly GraphNode[]): Map<string, SymbolSpan[]> {
  const byFile = new Map<string, SymbolSpan[]>();
  for (const node of nodes) {
    const parsed = node.kind === "symbol" ? parseSymbolId(node.id) : null;
    if (!parsed) continue;
    const span = { path: parsed.fileId, symbol: parsed.name, lineStart: lineAttr(node, "startLine"), lineEnd: lineAttr(node, "endLine") };
    byFile.set(parsed.fileId, [...(byFile.get(parsed.fileId) ?? []), span]);
  }
  return byFile;
}

export function fileRoles(store: CodeGraphStore, snapshotId: number): Map<string, NodeRole> {
  const roles = new Map<string, NodeRole>();
  for (const n of store.listNodes(snapshotId)) if (n.kind === "file" && n.role) roles.set(n.id, n.role);
  return roles;
}

/** `calls` edges are symbol-layer edges, hidden from edge reads unless references are asked for. */
function soleCaller(store: CodeGraphStore, snapshotId: number, symbolId: string): string | undefined {
  const callers = new Set(
    store
      .listEdgesTouching(snapshotId, symbolId, { includeReferences: true })
      .filter((e) => e.kind === "calls" && e.dstId === symbolId)
      .map((e) => e.srcId),
  );
  return callers.size === 1 ? [...callers][0] : undefined;
}

function readPinned(root: string, p: string, fingerprint: string | undefined): string[] | string {
  const abs = path.join(root, p);
  if (!existsSync(abs)) return "missing from the working tree";
  const text = readFileSync(abs, "utf8");
  if (hashContent(text) !== fingerprint) return "changed since the audit's snapshot";
  return text.split("\n");
}

/** A source over one snapshot; files whose content drifted from it are skipped with a warning. */
export function snapshotSource(store: CodeGraphStore, snapshotId: number, root: string, warnings: string[]): BundleSource {
  const fingerprints = new Map(store.listFingerprints(snapshotId).map((f) => [f.fileId, f.contentHash]));
  const spans = symbolSpansByFile(store.listNodes(snapshotId, { includeSymbols: true }));
  const cache = new Map<string, string[] | undefined>();
  const lines = (p: string): string[] | undefined => {
    if (!cache.has(p)) {
      const read = readPinned(root, p, fingerprints.get(p));
      if (typeof read === "string") warnings.push(`${p} ${read}; skipped`);
      cache.set(p, typeof read === "string" ? undefined : read);
    }
    return cache.get(p);
  };
  return {
    lines,
    symbols: (p) => spans.get(p) ?? [],
    caller: (symbolId) => soleCaller(store, snapshotId, symbolId),
  };
}
