import { buildRuleContext } from "./check-context.js";
import { runRule } from "./check-rules.js";
import type { GraphDatabase } from "./database.js";
import type { CheckResult, CheckRule, CheckViolation } from "./types.js";

export { validateRules, type ValidateRulesOptions } from "./check-validate.js";

export interface RunChecksOptions {
  snapshotId: number;
  rules: readonly CheckRule[];
  baselineSnapshotId?: number;
}

export function runChecks(
  db: GraphDatabase,
  options: RunChecksOptions,
): CheckResult {
  const ctx = buildRuleContext(db, options.snapshotId);
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
  const ctx = buildRuleContext(db, baselineSnapshotId);
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

interface Counts {
  newErrors: number;
  newWarnings: number;
  carryoverErrors: number;
  carryoverWarnings: number;
}

function countByOriginAndSeverity(violations: readonly CheckViolation[]): Counts {
  const counts: Counts = {
    newErrors: 0,
    newWarnings: 0,
    carryoverErrors: 0,
    carryoverWarnings: 0,
  };
  for (const v of violations) {
    const isError = v.severity === "error";
    if (v.isCarryover) {
      if (isError) counts.carryoverErrors++;
      else counts.carryoverWarnings++;
    } else {
      if (isError) counts.newErrors++;
      else counts.newWarnings++;
    }
  }
  return counts;
}
