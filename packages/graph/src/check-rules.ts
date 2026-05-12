import { compilePatterns, matchesAny } from "./patterns.js";
import type { RuleContext } from "./check-context.js";
import type {
  CheckRule,
  CheckViolation,
  ForbidImportRule,
  LayeredDepsRule,
  MetricMaxRule,
  MetricMinRule,
  MetricProductMaxRule,
  Severity,
} from "./types.js";

export function runRule(rule: CheckRule, ctx: RuleContext): CheckViolation[] {
  switch (rule.type) {
    case "metric-max":
      return runMetricMaxRule(rule, ctx);
    case "metric-min":
      return runMetricMinRule(rule, ctx);
    case "metric-product-max":
      return runMetricProductMaxRule(rule, ctx);
    case "forbid-import":
      return runForbidImportRule(rule, ctx);
    case "layered-deps":
      return runLayeredDepsRule(rule, ctx);
  }
}

function severityOf(rule: CheckRule): Severity {
  return rule.severity ?? "error";
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

function runLayeredDepsRule(
  rule: LayeredDepsRule,
  ctx: RuleContext,
): CheckViolation[] {
  const packageLayer = new Map<string, number>();
  for (let i = 0; i < rule.layers.length; i++) {
    for (const pkg of rule.layers[i]!) packageLayer.set(pkg, i);
  }
  const out: CheckViolation[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "imports" && edge.kind !== "re-exports") continue;
    const srcPkg = packageHead(edge.srcId);
    const dstPkg = packageHead(edge.dstId);
    const srcLayer = packageLayer.get(srcPkg);
    const dstLayer = packageLayer.get(dstPkg);
    if (srcLayer === undefined || dstLayer === undefined) continue;
    if (srcLayer >= dstLayer) continue;
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: edge.srcId,
      destinationId: edge.dstId,
      message: `${srcPkg} (layer ${srcLayer}) imports ${dstPkg} (layer ${dstLayer})`,
    });
  }
  return out;
}

function packageHead(id: string): string {
  const slash = id.indexOf("/");
  return slash < 0 ? id : id.slice(0, slash);
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

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}
