import type { ParsedFile } from "@codewatch/core";
import type { SourceFile } from "ts-morph";
import { collectDeclaredSpans, type LineSpan } from "../declared-names.js";
import { fileId, symbolId } from "./ids.js";
import type { GraphNode } from "../types.js";

/**
 * A `symbol` node for a declaration, tagging whether it is exported (C-64) and,
 * when it is a function/method/class, its 1-based line span (C-63) so coverage
 * can be attributed by range containment. A span-less symbol (an exported type or
 * const value) just carries `exported`.
 */
function makeSymbolNode(
  fileId: string,
  name: string,
  exported: boolean,
  span: LineSpan | undefined,
): GraphNode {
  return {
    id: symbolId(fileId, name),
    kind: "symbol",
    name,
    parentId: fileId,
    language: "typescript",
    attrs: span
      ? { exported, startLine: span.startLine, endLine: span.endLine }
      : { exported },
  };
}

/**
 * A `symbol` node per declaration a file owns (model B, C-64). Two sources, both
 * source-local so an unchanged file's symbol nodes are byte-identical across runs
 * and the incremental indexer carries them forward without re-parsing:
 *
 * - **Exported declarations** (`exported: true`) — from ts-morph's
 *   `getExportedDeclarations`, which barrel-resolves. Names this file merely
 *   re-exports are skipped: they belong to the origin file's symbol nodes, so
 *   `references` edges resolved through a barrel land on the file that does the
 *   work, not the hub (C-53 / C-55). Covers functions, classes, types, and
 *   exported const values alike — the reference-edge targets.
 * - **Non-exported functions / methods / classes** (`exported: false`) — from the
 *   tree-sitter declared-name walk (same parser as complexity), so an internal
 *   helper like `mergeFragments` gets a node and, by name match, its own
 *   complexity, closing the C-59 Dossier gap. Internal *non-callable* bindings
 *   (plain const values) are intentionally excluded — only functions/methods/
 *   classes.
 */
export function buildSymbolNodes(
  repoRoot: string,
  sourceFile: SourceFile,
  file: ParsedFile,
): GraphNode[] {
  const fId = fileId(repoRoot, sourceFile.getFilePath());
  const spans = collectDeclaredSpans(file);
  const out: GraphNode[] = [];
  const exported = new Set<string>();
  for (const [name, decls] of sourceFile.getExportedDeclarations()) {
    const declaredHere = decls.some((d) => d.getSourceFile() === sourceFile);
    if (!declaredHere) continue;
    exported.add(name);
    out.push(makeSymbolNode(fId, name, true, spans.get(name)));
  }
  for (const [name, span] of spans) {
    if (exported.has(name)) continue;
    out.push(makeSymbolNode(fId, name, false, span));
  }
  return out;
}
