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
  MetricProductMaxRule,
  NodeRole,
  Severity,
} from "./types.js";

export interface RunChecksOptions {
  snapshotId: number;
  rules: readonly CheckRule[];
  baselineSnapshotId?: number;
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
  const excludedRoles = new Set(rule.excludeRoles ?? []);
  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (rule.kind && node.kind !== rule.kind) continue;
    if (matchesAny(node.id, excluders)) continue;
    if (node.role && excludedRoles.has(node.role)) continue;
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
  const excludedRoles = new Set(rule.excludeRoles ?? []);
  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (rule.kind && node.kind !== rule.kind) continue;
    if (matchesAny(node.id, excluders)) continue;
    if (node.role && excludedRoles.has(node.role)) continue;
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

function runMetricProductMaxRule(
  rule: MetricProductMaxRule,
  ctx: RuleContext,
): CheckViolation[] {
  const excluders = compilePatterns(rule.exclude);
  const excludedRoles = new Set(rule.excludeRoles ?? []);
  const composite = rule.metrics.join(" * ");
  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (rule.kind && node.kind !== rule.kind) continue;
    if (matchesAny(node.id, excluders)) continue;
    if (node.role && excludedRoles.has(node.role)) continue;
    const inner = ctx.metricsByNode.get(node.id);
    if (!inner) continue;
    const components = collectComponents(rule.metrics, inner);
    if (!components) continue;
    const product = components.reduce((a, b) => a * b, 1);
    if (product <= rule.max) continue;
    const detail = rule.metrics
      .map((m, i) => `${m}=${formatNumber(components[i]!)}`)
      .join(" * ");
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: node.id,
      metric: composite,
      value: product,
      threshold: rule.max,
      message: `${detail} = ${formatNumber(product)} > ${formatNumber(rule.max)}`,
    });
  }
  return out;
}

function collectComponents(
  metrics: readonly string[],
  values: ReadonlyMap<string, number>,
): number[] | null {
  const out: number[] = [];
  for (const m of metrics) {
    const v = values.get(m);
    if (v === undefined) return null;
    out.push(v);
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
    case "metric-product-max":
      return runMetricProductMaxRule(rule, ctx);
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
  const baselineKeys = options.baselineSnapshotId
    ? collectBaselineKeys(db, options.baselineSnapshotId, options.rules)
    : null;
  if (baselineKeys) {
    for (const v of violations) {
      if (baselineKeys.has(violationKey(v))) v.isCarryover = true;
    }
  }
  const counts = countByOriginAndSeverity(violations);
  return {
    snapshotId: options.snapshotId,
    baselineSnapshotId: options.baselineSnapshotId,
    rulesEvaluated: options.rules.length,
    nodesEvaluated: ctx.nodes.length,
    violations,
    newErrors: counts.newErrors,
    newWarnings: counts.newWarnings,
    carryoverErrors: counts.carryoverErrors,
    carryoverWarnings: counts.carryoverWarnings,
    passed: counts.newErrors === 0,
  };
}

function collectBaselineKeys(
  db: GraphDatabase,
  baselineSnapshotId: number,
  rules: readonly CheckRule[],
): Set<string> {
  const ctx = buildContext(db, baselineSnapshotId);
  const keys = new Set<string>();
  for (const rule of rules) {
    for (const v of runRule(rule, ctx)) {
      keys.add(violationKey(v));
    }
  }
  return keys;
}

function violationKey(v: CheckViolation): string {
  return v.destinationId
    ? `${v.ruleId}|${v.nodeId}|${v.destinationId}`
    : `${v.ruleId}|${v.nodeId}`;
}

function countByOriginAndSeverity(violations: readonly CheckViolation[]): {
  newErrors: number;
  newWarnings: number;
  carryoverErrors: number;
  carryoverWarnings: number;
} {
  let newErrors = 0;
  let newWarnings = 0;
  let carryoverErrors = 0;
  let carryoverWarnings = 0;
  for (const v of violations) {
    const isError = v.severity === "error";
    if (v.isCarryover) {
      if (isError) carryoverErrors++;
      else carryoverWarnings++;
    } else {
      if (isError) newErrors++;
      else newWarnings++;
    }
  }
  return { newErrors, newWarnings, carryoverErrors, carryoverWarnings };
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
    case "metric-product-max":
      return assertMetricProductMax(r);
    case "forbid-import":
      return assertForbidImport(r);
    default:
      throw new Error(`rule[${index}] (${r.id}) unknown type "${r.type}"`);
  }
}

function assertMetricProductMax(r: Record<string, unknown>): MetricProductMaxRule {
  if (!Array.isArray(r.metrics) || r.metrics.length < 2) {
    throw new Error(`${r.id}: metrics must be an array of 2+ metric names`);
  }
  if (!r.metrics.every((m): m is string => typeof m === "string")) {
    throw new Error(`${r.id}: metrics must be strings`);
  }
  if (typeof r.max !== "number") {
    throw new Error(`${r.id}: max must be a number`);
  }
  return {
    type: "metric-product-max",
    id: r.id as string,
    metrics: r.metrics,
    max: r.max,
    kind: r.kind as MetricProductMaxRule["kind"],
    severity: r.severity as Severity | undefined,
    exclude: parseStringArray(r.exclude),
    excludeRoles: parseRoleArray(r.id as string, r.excludeRoles),
  };
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
    exclude: parseStringArray(r.exclude),
    excludeRoles: parseRoleArray(r.id as string, r.excludeRoles),
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
    exclude: parseStringArray(r.exclude),
    excludeRoles: parseRoleArray(r.id as string, r.excludeRoles),
  };
}

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

const ROLE_VALUES: ReadonlySet<NodeRole> = new Set([
  "test",
  "fixture",
  "barrel",
  "types",
  "config",
  "source",
]);

function parseRoleArray(ruleId: string, value: unknown): NodeRole[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${ruleId}: excludeRoles must be an array`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !ROLE_VALUES.has(entry as NodeRole)) {
      throw new Error(
        `${ruleId}: unknown role "${entry}" — valid: ${[...ROLE_VALUES].join(", ")}`,
      );
    }
  }
  return value as NodeRole[];
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
