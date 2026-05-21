import type {
  CheckRule,
  ForbidImportRule,
  LayeredDepsRule,
  MetricMaxRule,
  MetricMinRule,
  MetricProductMaxRule,
  NoInternalOnlyBarrelsRule,
  NodeRole,
  Severity,
} from "./types.js";

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
    case "layered-deps":
      return assertLayeredDeps(r);
    case "no-internal-only-barrels":
      return assertNoInternalOnlyBarrels(r);
    default:
      throw new Error(`rule[${index}] (${r.id}) unknown type "${r.type}"`);
  }
}

function assertNoInternalOnlyBarrels(
  r: Record<string, unknown>,
): NoInternalOnlyBarrelsRule {
  if (!Array.isArray(r.packageRoots) || r.packageRoots.length === 0) {
    throw new Error(
      `${r.id}: packageRoots must be a non-empty array of path-prefix strings`,
    );
  }
  for (const p of r.packageRoots) {
    if (typeof p !== "string" || !p) {
      throw new Error(`${r.id}: each packageRoots entry must be a non-empty string`);
    }
  }
  return {
    type: "no-internal-only-barrels",
    id: r.id as string,
    packageRoots: r.packageRoots as string[],
    severity: r.severity as Severity | undefined,
    exclude: parseStringArray(r.exclude),
  };
}

function assertLayeredDeps(r: Record<string, unknown>): LayeredDepsRule {
  if (!Array.isArray(r.layers) || r.layers.length < 2) {
    throw new Error(`${r.id}: layers must be an array of 2+ string arrays`);
  }
  for (const layer of r.layers) {
    if (!Array.isArray(layer) || !layer.every((p) => typeof p === "string")) {
      throw new Error(`${r.id}: each layer must be a string[]`);
    }
    if (layer.length === 0) {
      throw new Error(`${r.id}: empty layers not allowed`);
    }
  }
  const seen = new Set<string>();
  for (const layer of r.layers as string[][]) {
    for (const pkg of layer) {
      if (seen.has(pkg)) {
        throw new Error(`${r.id}: package "${pkg}" appears in more than one layer`);
      }
      seen.add(pkg);
    }
  }
  return {
    type: "layered-deps",
    id: r.id as string,
    layers: r.layers as string[][],
    severity: r.severity as Severity | undefined,
  };
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
