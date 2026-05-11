import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  GraphReportResult,
  HotspotRow,
} from "./graph-report-types.js";

export function formatGraphReportMarkdown(result: GraphReportResult): string {
  const lines: string[] = [];
  lines.push(`# Codebase health report`);
  lines.push("");
  lines.push(
    `Snapshot ${result.snapshot.id} (${result.snapshot.ref}), ` +
      `${result.windowDays}-day window.`,
  );
  lines.push("");
  pushHotspots(lines, result.hotspots);
  pushBusFactor(lines, result.busFactorRisks);
  pushCoupling(lines, result.couplingClusters);
  pushCentral(lines, result.centralFiles);
  return lines.join("\n");
}

export function formatGraphReportJson(result: GraphReportResult): string {
  return JSON.stringify(result, null, 2);
}

function pushHotspots(lines: string[], rows: readonly HotspotRow[]): void {
  lines.push("## Hotspots (churn × complexity)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No hotspots._");
    lines.push("");
    return;
  }
  lines.push("| File | Churn | Complexity | Score |");
  lines.push("|---|--:|--:|--:|");
  for (const r of rows) {
    lines.push(`| ${r.nodeId} | ${r.churn} | ${r.complexity} | ${r.score} |`);
  }
  lines.push("");
}

function pushBusFactor(lines: string[], rows: readonly BusFactorRow[]): void {
  lines.push("## Knowledge-silo risks (bus factor = 1)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No single-owner files in the window._");
    lines.push("");
    return;
  }
  lines.push("| File | Top-author share | Churn |");
  lines.push("|---|--:|--:|");
  for (const r of rows) {
    lines.push(
      `| ${r.nodeId} | ${(r.topAuthorShare * 100).toFixed(0)}% | ${r.churn} |`,
    );
  }
  lines.push("");
}

function pushCoupling(lines: string[], rows: readonly CouplingRow[]): void {
  lines.push("## Tight coupling clusters (co-edits)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No co-edits ≥ 2 in window._");
    lines.push("");
    return;
  }
  lines.push("| File A | File B | Co-edits |");
  lines.push("|---|---|--:|");
  for (const r of rows) {
    lines.push(`| ${r.fileA} | ${r.fileB} | ${r.count} |`);
  }
  lines.push("");
}

function pushCentral(lines: string[], rows: readonly CentralRow[]): void {
  lines.push("## Most central files (uniform PageRank)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No central files._");
    lines.push("");
    return;
  }
  lines.push("| File | PageRank |");
  lines.push("|---|--:|");
  for (const r of rows) {
    lines.push(`| ${r.nodeId} | ${r.score.toExponential(2)} |`);
  }
  lines.push("");
}
