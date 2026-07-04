import type { ParsedFile } from "@codewatch/core";
import type { Node } from "web-tree-sitter";
import type { GraphMetric } from "./types.js";

/**
 * Function-local dead-code metrics (C-65 Phase 1). Pure functions of one file's
 * bytes — the same class as the source metrics in source-metrics.ts — so they
 * ride the content-hash incremental reuse gate. Kept in their own module (not
 * appended to source-metrics.ts) so the already-churn-hot source-metrics.ts is
 * not touched; the reuse machinery folds these names in alongside
 * SOURCE_METRIC_NAMES (see incremental.ts) and index-metrics.ts computes them
 * fresh for (re)parsed files.
 */
export const DEAD_CODE_METRIC_NAMES: ReadonlySet<string> = new Set([
  "unreachable_statements",
]);

/** Statements that unconditionally end control flow in their block. */
const TERMINALS = new Set([
  "return_statement",
  "throw_statement",
  "break_statement",
  "continue_statement",
]);

/**
 * Per-file dead-code metrics for TypeScript files. Emitted sparsely — only when
 * a count is > 0 — so a clean file adds no rows (a full index and an incremental
 * re-index therefore produce the identical metric set). Non-TypeScript files are
 * skipped for now.
 */
export function computeDeadCodeMetrics(
  files: readonly ParsedFile[],
  fileIdOf: (filePath: string) => string,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const file of files) {
    if (file.language !== "typescript" && file.language !== "tsx") continue;
    const unreachable = countUnreachable(file.tree.rootNode);
    if (unreachable > 0) {
      out.push({
        nodeId: fileIdOf(file.filePath),
        name: "unreachable_statements",
        value: unreachable,
        unit: "count",
      });
    }
  }
  return out;
}

/**
 * Count statements that can never execute: those following an unconditional
 * terminal (`return`/`throw`/`break`/`continue`) inside the SAME
 * `statement_block`. Deliberately shallow — no CFG — so it only claims the
 * decidable case and stays near-zero false-positive:
 * - `switch` bodies are not plain blocks (fallthrough / `case` labels), so their
 *   statements are never in a `statement_block` here and aren't counted.
 * - Anything after a conditional (an `if` with no guaranteed terminal) is not
 *   counted, because the terminal must be a direct child of the block.
 * - A `function_declaration` after a terminal is hoisted (callable before the
 *   terminal), so it is excluded; comments are ignored too.
 */
function countUnreachable(root: Node): number {
  let count = 0;
  const visit = (node: Node): void => {
    if (node.type === "statement_block") count += unreachableInBlock(node);
    for (const child of node.namedChildren) {
      if (child) visit(child);
    }
  };
  visit(root);
  return count;
}

function unreachableInBlock(block: Node): number {
  let seenTerminal = false;
  let count = 0;
  for (const child of block.namedChildren) {
    if (!child) continue;
    if (
      seenTerminal &&
      child.type !== "comment" &&
      child.type !== "function_declaration"
    ) {
      count++;
    }
    if (TERMINALS.has(child.type)) seenTerminal = true;
  }
  return count;
}
