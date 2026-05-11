import type { ParsedFile } from "@code-style/core";
import type { Node } from "web-tree-sitter";
import type { GraphMetric } from "./types.js";

const TS_FUNCTION_TYPES = new Set([
  "function_declaration",
  "method_definition",
]);

const PY_FUNCTION_TYPES = new Set(["function_definition"]);

const TS_NESTING_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "try_statement",
]);

const PY_NESTING_TYPES = new Set([
  "if_statement",
  "for_statement",
  "while_statement",
  "try_statement",
]);

const TS_BRANCH_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
]);

const PY_BRANCH_TYPES = new Set([
  "if_statement",
  "elif_clause",
  "for_statement",
  "while_statement",
  "except_clause",
  "conditional_expression",
]);

interface FunctionStats {
  cyclomatic: number;
  nestingDepth: number;
}

export function computeSourceMetrics(
  files: readonly ParsedFile[],
  fileIdOf: (filePath: string) => string,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const file of files) {
    const id = fileIdOf(file.filePath);
    out.push(...metricsForFile(id, file));
  }
  return out;
}

function metricsForFile(nodeId: string, file: ParsedFile): GraphMetric[] {
  const out: GraphMetric[] = [];
  const loc = countLoc(file.content);
  out.push({ nodeId, name: "loc", value: loc, unit: "lines" });

  const stats = analyzeFunctions(file);
  out.push({
    nodeId,
    name: "function_count",
    value: stats.length,
    unit: "count",
  });

  if (stats.length > 0) {
    out.push({
      nodeId,
      name: "cyclomatic_max",
      value: Math.max(...stats.map((s) => s.cyclomatic)),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "cyclomatic_sum",
      value: stats.reduce((acc, s) => acc + s.cyclomatic, 0),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "max_nesting_depth",
      value: Math.max(...stats.map((s) => s.nestingDepth)),
      unit: "count",
    });
  }
  return out;
}

function countLoc(content: string): number {
  return content.split("\n").filter((l) => l.trim() !== "").length;
}

function analyzeFunctions(file: ParsedFile): FunctionStats[] {
  const stats: FunctionStats[] = [];
  const fnTypes =
    file.language === "python" ? PY_FUNCTION_TYPES : TS_FUNCTION_TYPES;
  const visit = (node: Node): void => {
    if (fnTypes.has(node.type)) {
      const body = node.childForFieldName("body");
      if (body) {
        stats.push({
          cyclomatic: cyclomaticOf(body, file.language),
          nestingDepth: nestingDepthOf(body, file.language, 0),
        });
      }
    }
    for (const child of node.children) {
      if (child) visit(child);
    }
  };
  visit(file.tree.rootNode);
  return stats;
}

function nestingDepthOf(node: Node, language: string, depth: number): number {
  const nestingTypes =
    language === "python" ? PY_NESTING_TYPES : TS_NESTING_TYPES;
  let maxDepth = depth;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const next = nestingTypes.has(child.type) ? depth + 1 : depth;
    const childMax = nestingDepthOf(child, language, next);
    if (childMax > maxDepth) maxDepth = childMax;
  }
  return maxDepth;
}

function cyclomaticOf(body: Node, language: string): number {
  const branchTypes =
    language === "python" ? PY_BRANCH_TYPES : TS_BRANCH_TYPES;
  let complexity = 1;
  const visit = (node: Node): void => {
    if (branchTypes.has(node.type)) complexity++;
    if (node.type === "binary_expression") {
      const op = node.childForFieldName("operator");
      if (op && (op.text === "&&" || op.text === "||")) complexity++;
    }
    if (language === "python" && node.type === "boolean_operator") {
      complexity++;
    }
    for (const child of node.namedChildren) {
      if (child) visit(child);
    }
  };
  visit(body);
  return complexity;
}
