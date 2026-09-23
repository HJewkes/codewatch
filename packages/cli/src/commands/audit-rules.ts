import type { CheckRule, MetricMaxRule, MetricOutlierRule, NodeKind } from "@titan-design/code-graph";

function maxRule(id: string, metric: string, max: number, kind: NodeKind): MetricMaxRule {
  return { type: "metric-max", id, metric, max, kind, severity: "warning" };
}

function outlierRule(id: string, metric: string, percentile: number, kind: NodeKind): MetricOutlierRule {
  return { type: "metric-outlier", id, metric, percentile, kind, severity: "warning" };
}

/**
 * The built-in audit rule set over the metrics code-graph stores. Thresholds follow the
 * C-96 plan's Layer 1; a rule whose metric a snapshot lacks yields no findings.
 */
export const AUDIT_RULES: readonly CheckRule[] = [
  maxRule("symbol-cognitive", "symbol_cognitive", 15, "symbol"),
  maxRule("symbol-cyclomatic", "symbol_cyclomatic", 10, "symbol"),
  maxRule("symbol-loc", "symbol_loc", 60, "symbol"),
  maxRule("symbol-nesting", "symbol_max_nesting", 4, "symbol"),
  maxRule("symbol-pass-through", "symbol_pass_through", 0, "symbol"),
  maxRule("symbol-narrating-comments", "symbol_narrating_comments", 0, "symbol"),
  outlierRule("symbol-comment-ratio", "symbol_comment_ratio", 90, "symbol"),
  maxRule("file-loc", "loc", 500, "file"),
  maxRule("file-nesting", "max_nesting_depth", 4, "file"),
  maxRule("file-lcom4", "lcom4_max", 2, "file"),
  maxRule("file-fan-in", "fan_in", 20, "file"),
  maxRule("file-unused-locals", "unused_locals", 0, "file"),
  maxRule("file-unused-params", "unused_params", 0, "file"),
  maxRule("file-unreachable", "unreachable_statements", 0, "file"),
  maxRule("file-swallowed-except", "swallowed_except", 0, "file"),
  outlierRule("file-except-density", "except_density", 90, "file"),
];
