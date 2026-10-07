import {
  computeChangeCoupling,
  loadChurnEntries,
  type ChurnWindow,
  type CoEditPair,
} from "@titan-design/code-graph/history";
import {
  keepNode,
  type CouplingRow,
  type ReportContext,
} from "@titan-design/code-graph";

/**
 * Co-edit pairs read from `git log` at report time, so this section stays in
 * codewatch rather than with code-graph's stored-index report sections.
 */
export function topCouplingClusters(
  ctx: ReportContext,
  repoRoot: string,
  windowDays: ChurnWindow,
  limit: number,
): CouplingRow[] {
  const entries = loadChurnEntries({ repoRoot, windowDays });
  if (entries === null) return [];
  const { pairs } = computeChangeCoupling(entries, { minCount: 2 });
  const filtered = pairs.filter(
    (p) => keepNode(ctx, p.fileA) && keepNode(ctx, p.fileB),
  );
  return filtered.slice(0, limit).map(toCouplingRow);
}

function toCouplingRow(p: CoEditPair): CouplingRow {
  return { fileA: p.fileA, fileB: p.fileB, count: p.count };
}
