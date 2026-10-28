import { toFindings, type CheckResult, type CycleKind, type Finding } from "@titan-design/code-graph";

/** A finding that keeps an import cycle's member files and kind, which code-graph's `Finding` drops. */
export type AuditFinding = Finding & { members?: string[]; cycleKind?: CycleKind };

/** `toFindings`, plus `members` and `cycleKind` on cycle findings; it maps violations one to one, in order. */
export function auditFindings(result: CheckResult): AuditFinding[] {
  return toFindings(result).map((finding, i) => {
    const { members, cycleKind } = result.violations[i] ?? {};
    return members ? { ...finding, members, ...(cycleKind ? { cycleKind } : {}) } : finding;
  });
}
