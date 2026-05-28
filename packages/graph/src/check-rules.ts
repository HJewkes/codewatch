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
  NoInternalOnlyBarrelsRule,
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
    case "no-internal-only-barrels":
      return runNoInternalOnlyBarrelsRule(rule, ctx);
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
  // Layer strings are path prefixes (e.g. "packages/cli"). Longest-prefix
  // wins so nested packages can override their parent's layer if needed.
  const allPrefixes: string[] = [];
  const packageLayer = new Map<string, number>();
  for (let i = 0; i < rule.layers.length; i++) {
    for (const pkg of rule.layers[i]!) {
      packageLayer.set(pkg, i);
      allPrefixes.push(pkg);
    }
  }
  allPrefixes.sort((a, b) => b.length - a.length);
  const packageOf = (id: string): string | null => {
    for (const p of allPrefixes) {
      if (id === p || id.startsWith(`${p}/`)) return p;
    }
    return null;
  };

  const out: CheckViolation[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "imports" && edge.kind !== "re-exports") continue;
    const srcPkg = packageOf(edge.srcId);
    const dstPkg = packageOf(edge.dstId);
    if (srcPkg === null || dstPkg === null) continue;
    const srcLayer = packageLayer.get(srcPkg)!;
    const dstLayer = packageLayer.get(dstPkg)!;
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

function runNoInternalOnlyBarrelsRule(
  rule: NoInternalOnlyBarrelsRule,
  ctx: RuleContext,
): CheckViolation[] {
  const rootsByLength = [...rule.packageRoots].sort((a, b) => b.length - a.length);
  const packageOf = (id: string): string | null => {
    for (const root of rootsByLength) {
      if (id === root || id.startsWith(`${root}/`)) return root;
    }
    return null;
  };
  const excluders = compilePatterns(rule.exclude);

  const importersByDst = new Map<string, string[]>();
  for (const edge of ctx.edges) {
    if (edge.kind !== "imports" && edge.kind !== "re-exports") continue;
    let list = importersByDst.get(edge.dstId);
    if (!list) {
      list = [];
      importersByDst.set(edge.dstId, list);
    }
    list.push(edge.srcId);
  }

  const out: CheckViolation[] = [];
  for (const node of ctx.nodes) {
    if (node.kind !== "file") continue;
    if (node.role !== "barrel") continue;
    if (matchesAny(node.id, excluders)) continue;
    const barrelPkg = packageOf(node.id);
    if (barrelPkg === null) continue;
    const importers = importersByDst.get(node.id) ?? [];
    const externalCount = importers.reduce(
      (n, src) => (packageOf(src) !== barrelPkg ? n + 1 : n),
      0,
    );
    if (externalCount > 0) continue;
    out.push({
      ruleId: rule.id,
      severity: severityOf(rule),
      nodeId: node.id,
      message:
        importers.length === 0
          ? `barrel in package "${barrelPkg}" has no importers`
          : `barrel in package "${barrelPkg}" has ${importers.length} internal importer(s) but zero external`,
    });
  }
  return out;
}
