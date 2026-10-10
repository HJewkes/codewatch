import type { CheckRule, MetricMaxRule, MetricOutlierRule, NodeKind } from "@titan-design/code-graph";

function maxRule(id: string, metric: string, max: number, kind: NodeKind): MetricMaxRule {
  return { type: "metric-max", id, metric, max, kind, severity: "warning" };
}

/** Flags the top decile of the non-zero carriers, and only above an absolute floor, so a sparse metric is not all outliers. */
function outlierRule(id: string, metric: string, floor: number, kind: NodeKind): MetricOutlierRule {
  return { type: "metric-outlier", id, metric, kind, percentile: 90, rankNonZero: true, floor, severity: "warning" };
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
  outlierRule("symbol-comment-ratio", "symbol_comment_ratio", 0.5, "symbol"),
  maxRule("symbol-single-caller-helper", "symbol_single_caller_helper", 0, "symbol"),
  maxRule("symbol-constant-params", "symbol_constant_params", 0, "symbol"),
  maxRule("file-loc", "loc", 500, "file"),
  maxRule("file-nesting", "max_nesting_depth", 4, "file"),
  maxRule("file-lcom4", "lcom4_max", 2, "file"),
  maxRule("file-fan-in", "fan_in", 20, "file"),
  maxRule("file-unused-locals", "unused_locals", 0, "file"),
  maxRule("file-unused-params", "unused_params", 0, "file"),
  maxRule("file-unreachable", "unreachable_statements", 0, "file"),
  maxRule("file-swallowed-except", "swallowed_except", 0, "file"),
  outlierRule("file-except-density", "except_density", 3, "file"),
];

/**
 * Signals reported as qualitative flags: listed apart and left out of finding totals.
 * LCOM4 variants disagree with each other and lack outcome validation, so a high value
 * prompts a look at whether the file mixes concerns, never a graded split verdict.
 */
export const QUALITATIVE_SIGNALS: ReadonlySet<string> = new Set(["file-lcom4"]);

export const QUALITATIVE_FLAG_HINTS: Readonly<Record<string, string>> = {
  "file-lcom4": "may mix unrelated responsibilities; worth a look, not a split verdict",
};

/** A kind of test a code kind should have: met when any of `anyOf`, counts of reaching tests, is above zero. */
export interface TestKindRequirement {
  slug: string;
  missing: string;
  anyOf: readonly string[];
}

export interface TestKindPolicy {
  /** The 0/1 code-kind metric code-graph writes on a source symbol. */
  codeKind: string;
  label: string;
  requires: readonly TestKindRequirement[];
}

const ERROR_PATH: TestKindRequirement = { slug: "error-path", missing: "error-path test", anyOf: ["symbol_tests_error_path"] };

/**
 * Which test kinds each code kind should have (SCBench A1 design §2.2). Property tests are
 * optional, so no requirement names them alone. A parser's round-trip test waits for a
 * serializer fact code-graph does not record yet.
 */
export const TEST_KIND_POLICY: readonly TestKindPolicy[] = [
  {
    codeKind: "symbol_kind_output_boundary",
    label: "output boundary",
    requires: [
      { slug: "full-output", missing: "snapshot or exact-output test", anyOf: ["symbol_tests_snapshot", "symbol_tests_exact_output"] },
      ERROR_PATH,
    ],
  },
  {
    codeKind: "symbol_kind_parser",
    label: "parser",
    requires: [{ slug: "malformed-input", missing: "malformed-input error-path test", anyOf: ["symbol_tests_error_path"] }],
  },
  {
    codeKind: "symbol_kind_pure",
    label: "pure logic",
    requires: [
      { slug: "exact-value", missing: "exact-value test", anyOf: ["symbol_tests_exact_output", "symbol_tests_snapshot", "symbol_tests_roundtrip"] },
    ],
  },
  { codeKind: "symbol_kind_io", label: "I/O", requires: [ERROR_PATH] },
];
