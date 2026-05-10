import type { GraphDatabase } from "./database.js";
import { compilePatterns, matchesAny } from "./patterns.js";
import type {
  CheckResult,
  CheckRule,
  CheckViolation,
  ForbidImportRule,
  GraphEdge,
  GraphNode,
  MetricMaxRule,
  MetricMinRule,
  Severity,
} from "./types.js";

export interface RunChecksOptions {
  snapshotId: number;
  rules: readonly CheckRule[];
}

interface RuleContext {
  nodes: readonly GraphNode[];
  nodesById: Map<string, GraphNode>;
  metricsByNode: Map<string, Map<string, number>>;
  edges: readonly GraphEdge[];
}

function severityOf(rule: CheckRule): Severity {
  return rule.severity ?? "error";
}

function buildContext(
  db: GraphDatabase,
  snapshotId: number,
): RuleContext {
  const nodes = db.listNodes(snapshotId);
  const edges = db.listEdges(snapshotId);
  const metrics = db.listMetrics(snapshotId);
  const nodesById = new Map<string, GraphNode>();
  for (const n of nodes) nodesById.set(n.id, n);
  const metricsByNode = new Map<string, Map<string, number>>();
  for (const m of metrics) {
    if (m.value === null) continue;
    let inner = metricsByNode.get(m.nodeId);
    if (!inner) {
      inner = new Map();
      metricsByNode.set(m.nodeId, inner);
    }
    inner.set(m.name, m.value);
  }
  return { nodes, nodesById, metricsByNode, edges };
}

function runMetricMaxRule(
  rule: MetricMaxRule,
  ctx: RuleContext,
): CheckViolation[] {
  const excluders = compilePatterns(rule.exclude);
  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (rule.kind && node.kind !== rule.kind) continue;
    if (matchesAny(node.id, excluders)) continue;
    const value = ctx.metricsByNode.get(node.id)?.get(rule.metric);
    if (value === undefined) continue;
    if (value <= rule.max) continue;
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: node.id,
      metric: rule.metric,
      value,
      threshold: rule.max,
      message: `${rule.metric}=${formatNumber(value)} > ${formatNumber(rule.max)}`,
    });
  }
  return out;
}

function runMetricMinRule(
  rule: MetricMinRule,
  ctx: RuleContext,
): CheckViolation[] {
  const excluders = compilePatterns(rule.exclude);
  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (rule.kind && node.kind !== rule.kind) continue;
    if (matchesAny(node.id, excluders)) continue;
    const value = ctx.metricsByNode.get(node.id)?.get(rule.metric);
    if (value === undefined) continue;
    if (value >= rule.min) continue;
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: node.id,
      metric: rule.metric,
      value,
      threshold: rule.min,
      message: `${rule.metric}=${formatNumber(value)} < ${formatNumber(rule.min)}`,
    });
  }
  return out;
}

function runForbidImportRule(
  rule: ForbidImportRule,
  ctx: RuleContext,
): CheckViolation[] {
  const fromRx = compilePatterns([rule.from]);
  const toRx = compilePatterns([rule.to]);
  const out: CheckViolation[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "imports" && edge.kind !== "re-exports") continue;
    if (!matchesAny(edge.srcId, fromRx)) continue;
    if (!matchesAny(edge.dstId, toRx)) continue;
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: edge.srcId,
      destinationId: edge.dstId,
      message: `${edge.srcId} imports ${edge.dstId} (forbidden: ${rule.from} → ${rule.to})`,
    });
  }
  return out;
}

function runRule(rule: CheckRule, ctx: RuleContext): CheckViolation[] {
  switch (rule.type) {
    case "metric-max":
      return runMetricMaxRule(rule, ctx);
    case "metric-min":
      return runMetricMinRule(rule, ctx);
    case "forbid-import":
      return runForbidImportRule(rule, ctx);
  }
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

export function runChecks(
  db: GraphDatabase,
  options: RunChecksOptions,
): CheckResult {
  const ctx = buildContext(db, options.snapshotId);
  const violations: CheckViolation[] = [];
  for (const rule of options.rules) {
    violations.push(...runRule(rule, ctx));
  }
  const hasError = violations.some((v) => v.severity === "error");
  return {
    snapshotId: options.snapshotId,
    rulesEvaluated: options.rules.length,
    nodesEvaluated: ctx.nodes.length,
    violations,
    passed: !hasError,
  };
}

export function validateRules(input: unknown): readonly CheckRule[] {
  if (!input || typeof input !== "object") {
    throw new Error("rules file must be an object with a `rules` array");
  }
  const obj = input as { rules?: unknown };
  if (!Array.isArray(obj.rules)) {
    throw new Error("rules file must have a `rules` array");
  }
  return obj.rules.map((r, i) => validateRule(r, i));
}

function validateRule(raw: unknown, index: number): CheckRule {
  if (!raw || typeof raw !== "object") {
    throw new Error(`rule[${index}] must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) {
    throw new Error(`rule[${index}] missing string id`);
  }
  if (typeof r.type !== "string") {
    throw new Error(`rule[${index}] (${r.id}) missing string type`);
  }
  switch (r.type) {
    case "metric-max":
      return assertMetricMax(r);
    case "metric-min":
      return assertMetricMin(r);
    case "forbid-import":
      return assertForbidImport(r);
    default:
      throw new Error(`rule[${index}] (${r.id}) unknown type "${r.type}"`);
  }
}

function assertMetricMax(r: Record<string, unknown>): MetricMaxRule {
  if (typeof r.metric !== "string") throw new Error(`${r.id}: metric must be a string`);
  if (typeof r.max !== "number") throw new Error(`${r.id}: max must be a number`);
  return {
    type: "metric-max",
    id: r.id as string,
    metric: r.metric,
    max: r.max,
    kind: r.kind as MetricMaxRule["kind"],
    severity: r.severity as Severity | undefined,
    exclude: Array.isArray(r.exclude) ? (r.exclude as string[]) : undefined,
  };
}

function assertMetricMin(r: Record<string, unknown>): MetricMinRule {
  if (typeof r.metric !== "string") throw new Error(`${r.id}: metric must be a string`);
  if (typeof r.min !== "number") throw new Error(`${r.id}: min must be a number`);
  return {
    type: "metric-min",
    id: r.id as string,
    metric: r.metric,
    min: r.min,
    kind: r.kind as MetricMinRule["kind"],
    severity: r.severity as Severity | undefined,
    exclude: Array.isArray(r.exclude) ? (r.exclude as string[]) : undefined,
  };
}

function assertForbidImport(r: Record<string, unknown>): ForbidImportRule {
  if (typeof r.from !== "string") throw new Error(`${r.id}: from must be a string`);
  if (typeof r.to !== "string") throw new Error(`${r.id}: to must be a string`);
  return {
    type: "forbid-import",
    id: r.id as string,
    from: r.from,
    to: r.to,
    severity: r.severity as Severity | undefined,
  };
}
