import type { ParsedFile } from "@codewatch/core";
import type { Node } from "web-tree-sitter";

const TS_DECL_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "class_declaration",
]);

const PY_DECL_TYPES = new Set(["function_definition", "class_definition"]);

/**
 * Names of every function, method, and class a file DECLARES — the model-B
 * symbol surface (C-64). A superset of the file's exports: internal helpers like
 * `mergeFragments` are included so they get a `symbol` node (and, by name match,
 * their per-function complexity) even though nothing imports them. Names come
 * from the same tree-sitter walk that computes complexity (source-metrics.ts), so
 * a declared name and its complexity never drift. Anonymous declarations (a
 * default-exported arrow, inline callbacks) contribute no name and are skipped.
 */
export function collectDeclaredNames(file: ParsedFile): Set<string> {
  const declTypes = file.language === "python" ? PY_DECL_TYPES : TS_DECL_TYPES;
  const names = new Set<string>();
  const visit = (node: Node): void => {
    const name = declaredNameAt(node, declTypes);
    if (name) names.add(name);
    for (const child of node.children) {
      if (child) visit(child);
    }
  };
  visit(file.tree.rootNode);
  return names;
}

/**
 * The declared name at this node, or null. Mirrors source-metrics' `functionAt`
 * handling of an arrow / function-expression bound to a `const`/`let`, but
 * returns the name for the broader declaration set (adds classes) and needs no
 * body.
 */
function declaredNameAt(
  node: Node,
  declTypes: ReadonlySet<string>,
): string | null {
  if (declTypes.has(node.type)) {
    return node.childForFieldName("name")?.text ?? null;
  }
  if (
    (node.type === "arrow_function" || node.type === "function_expression") &&
    node.parent?.type === "variable_declarator"
  ) {
    return node.parent.childForFieldName("name")?.text ?? null;
  }
  return null;
}
