import type { RenderInput } from "./types.js";

export type ViolationsByNode = Map<
  string,
  {
    error: number;
    warning: number;
    isCarryover: boolean;
    items: Array<{
      ruleId: string;
      severity: string;
      message: string;
      isCarryover: boolean;
    }>;
  }
>;

export interface DiffSummary {
  resolvedByNode: Map<string, Array<{ ruleId: string; message: string }>>;
  trendByNode: Map<string, "worsened" | "improved">;
  trendDetailsByNode: Map<string, Array<{ ruleId: string; before: number; after: number; delta: number }>>;
}

export function buildViolationsMap(
  checkResult: RenderInput["checkResult"],
): ViolationsByNode {
  const out: ViolationsByNode = new Map();
  if (!checkResult) return out;
  for (const v of checkResult.violations) {
    let entry = out.get(v.nodeId);
    if (!entry) {
      entry = { error: 0, warning: 0, isCarryover: true, items: [] };
      out.set(v.nodeId, entry);
    }
    if (v.severity === "error") entry.error++;
    else entry.warning++;
    if (!v.isCarryover) entry.isCarryover = false;
    entry.items.push({
      ruleId: v.ruleId,
      severity: v.severity,
      message: v.message,
      isCarryover: v.isCarryover ?? false,
    });
  }
  return out;
}

export function buildCheckDiffSummary(checkDiff: RenderInput["checkDiff"]): DiffSummary {
  const resolvedByNode = new Map<string, Array<{ ruleId: string; message: string }>>();
  const trendByNode = new Map<string, "worsened" | "improved">();
  const trendDetailsByNode = new Map<string, Array<{ ruleId: string; before: number; after: number; delta: number }>>();
  if (!checkDiff) return { resolvedByNode, trendByNode, trendDetailsByNode };
  for (const v of checkDiff.resolved) {
    let list = resolvedByNode.get(v.nodeId);
    if (!list) { list = []; resolvedByNode.set(v.nodeId, list); }
    list.push({ ruleId: v.ruleId, message: v.message });
  }
  for (const u of checkDiff.worsened) {
    trendByNode.set(u.violation.nodeId, "worsened");
    let list = trendDetailsByNode.get(u.violation.nodeId);
    if (!list) { list = []; trendDetailsByNode.set(u.violation.nodeId, list); }
    list.push({ ruleId: u.violation.ruleId, before: u.before, after: u.after, delta: u.after - u.before });
  }
  for (const u of checkDiff.improved) {
    if (!trendByNode.has(u.violation.nodeId)) trendByNode.set(u.violation.nodeId, "improved");
    let list = trendDetailsByNode.get(u.violation.nodeId);
    if (!list) { list = []; trendDetailsByNode.set(u.violation.nodeId, list); }
    list.push({ ruleId: u.violation.ruleId, before: u.before, after: u.after, delta: u.after - u.before });
  }
  return { resolvedByNode, trendByNode, trendDetailsByNode };
}

export function checkBadgeHtml(checkResult: RenderInput["checkResult"]): string {
  if (!checkResult) return "";
  const errors =
    checkResult.newErrors + checkResult.carryoverErrors;
  const warnings =
    checkResult.newWarnings + checkResult.carryoverWarnings;
  if (errors === 0 && warnings === 0) {
    return `<span class="overlay-badge" style="background:#26543e;color:#86efac">✓ rules pass</span>`;
  }
  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`<span class="overlay-badge" style="background:#5a2a2a;color:#fca5a5">${errors} error(s)</span>`);
  }
  if (warnings > 0) {
    parts.push(`<span class="overlay-badge" style="background:#5a4a2a;color:#fcd34d">${warnings} warning(s)</span>`);
  }
  return parts.join(" ");
}
