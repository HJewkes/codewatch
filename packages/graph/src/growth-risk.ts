import type { ParsedFile } from "@codewatch/core";
import type { Node } from "web-tree-sitter";
import type { GraphMetric } from "./types.js";

/**
 * Growth-risk / scaling-smell metrics (C-66 Phase 2). Cheap, function-local
 * *heuristics* — NOT Big-O or a proven complexity class (real asymptotic
 * inference is undecidable; see the roadmap's hard NO). Pure functions of one
 * file's bytes, so they ride the content-hash incremental reuse gate, folded
 * into the carry-forward set in incremental.ts alongside the source/dead-code
 * metric names. Emitted sparsely (only when a smell is present).
 */
export const GROWTH_RISK_METRIC_NAMES: ReadonlySet<string> = new Set([
  "loop_depth",
]);

const TS_LOOP_TYPES = new Set([
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
]);

const PY_LOOP_TYPES = new Set(["for_statement", "while_statement"]);

/**
 * Per-file growth-risk metrics for TS/Python files. `loop_depth` is the maximum
 * *lexical* nesting of loops (a triple-nested loop → 3), a structural proxy for
 * a superlinear pattern — emitted only at depth ≥ 2 (a "quadratic-shaped" or
 * deeper smell; depth 0/1 is unremarkable). It is a SMELL, not a bound: depth-2
 * loops over two *different* collections are linear, and a `.includes` on a
 * `Set` is O(1). Non-TS/Python files are skipped.
 */
export function computeGrowthRiskMetrics(
  files: readonly ParsedFile[],
  fileIdOf: (filePath: string) => string,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const file of files) {
    const loopTypes = file.language === "python" ? PY_LOOP_TYPES : TS_LOOP_TYPES;
    const depth = maxLoopDepth(file.tree.rootNode, loopTypes, 0);
    if (depth >= 2) {
      out.push({
        nodeId: fileIdOf(file.filePath),
        name: "loop_depth",
        value: depth,
        unit: "count",
      });
    }
  }
  return out;
}

/** Deepest lexical nesting of loop constructs under `node`. */
function maxLoopDepth(
  node: Node,
  loopTypes: ReadonlySet<string>,
  depth: number,
): number {
  let max = depth;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const next = loopTypes.has(child.type) ? depth + 1 : depth;
    const childMax = maxLoopDepth(child, loopTypes, next);
    if (childMax > max) max = childMax;
  }
  return max;
}
