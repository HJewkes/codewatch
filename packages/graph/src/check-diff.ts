import type { GraphDatabase } from "./database.js";
import { runChecks } from "./check.js";
import type { CheckRule, CheckViolation } from "./types.js";

export interface UnchangedViolation {
  from: CheckViolation;
  to: CheckViolation;
  delta: number | null;
}

export interface CheckDiff {
  fromSnapshotId: number;
  toSnapshotId: number;
  rulesEvaluated: number;
  newViolations: CheckViolation[];
  resolvedViolations: CheckViolation[];
  unchanged: UnchangedViolation[];
  worsened: UnchangedViolation[];
  improved: UnchangedViolation[];
}

export interface DiffCheckResultsOptions {
  fromSnapshotId: number;
  toSnapshotId: number;
  rules: readonly CheckRule[];
}

export function diffCheckResults(
  db: GraphDatabase,
  options: DiffCheckResultsOptions,
): CheckDiff {
  const from = runChecks(db, {
    snapshotId: options.fromSnapshotId,
    rules: options.rules,
  });
  const to = runChecks(db, {
    snapshotId: options.toSnapshotId,
    rules: options.rules,
  });

  const fromByKey = indexByKey(from.violations);
  const toByKey = indexByKey(to.violations);

  const newViolations: CheckViolation[] = [];
  const resolvedViolations: CheckViolation[] = [];
  const unchanged: UnchangedViolation[] = [];
  const worsened: UnchangedViolation[] = [];
  const improved: UnchangedViolation[] = [];

  for (const [key, toV] of toByKey) {
    const fromV = fromByKey.get(key);
    if (!fromV) {
      newViolations.push(toV);
      continue;
    }
    const delta = computeDelta(fromV, toV);
    const entry: UnchangedViolation = { from: fromV, to: toV, delta };
    unchanged.push(entry);
    if (delta !== null && delta > 0) worsened.push(entry);
    else if (delta !== null && delta < 0) improved.push(entry);
  }
  for (const [key, fromV] of fromByKey) {
    if (!toByKey.has(key)) resolvedViolations.push(fromV);
  }

  return {
    fromSnapshotId: options.fromSnapshotId,
    toSnapshotId: options.toSnapshotId,
    rulesEvaluated: options.rules.length,
    newViolations,
    resolvedViolations,
    unchanged,
    worsened,
    improved,
  };
}

function indexByKey(violations: readonly CheckViolation[]): Map<string, CheckViolation> {
  const out = new Map<string, CheckViolation>();
  for (const v of violations) out.set(violationKey(v), v);
  return out;
}

function violationKey(v: CheckViolation): string {
  return v.destinationId
    ? `${v.ruleId}|${v.nodeId}|${v.destinationId}`
    : `${v.ruleId}|${v.nodeId}`;
}

function computeDelta(from: CheckViolation, to: CheckViolation): number | null {
  if (from.value === undefined || to.value === undefined) return null;
  return to.value - from.value;
}
