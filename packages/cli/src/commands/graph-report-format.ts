import type {
  BusFactorChange,
  BusFactorRow,
  CentralRow,
  CouplingDelta,
  CouplingRow,
  GraphReportResult,
  HotspotDelta,
  HotspotRow,
  ReportDrift,
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
  if (result.drift) pushDrift(lines, result.drift);
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

function pushDrift(lines: string[], drift: ReportDrift): void {
  lines.push(
    `## Drift since snapshot ${drift.baselineSnapshot.id} (${drift.baselineSnapshot.ref})`,
  );
  lines.push("");
  pushDriftHotspots(lines, drift);
  pushDriftSilos(lines, drift);
  pushDriftCoupling(lines, drift);
}

function pushDriftHotspots(lines: string[], drift: ReportDrift): void {
  lines.push("### Hotspots");
  lines.push("");
  pushList(lines, "🆕 New", drift.newHotspots.map((h) => h.nodeId));
  pushDeltaList(lines, "✅ Resolved", drift.resolvedHotspots);
  pushDeltaList(lines, "📤 Displaced (still high score, outranked)", drift.displacedHotspots);
  pushDeltaList(lines, "📈 Worsened", drift.worsenedHotspots);
  pushDeltaList(lines, "📉 Improved", drift.improvedHotspots);
  lines.push("");
}

function pushDriftSilos(lines: string[], drift: ReportDrift): void {
  lines.push("### Knowledge silos");
  lines.push("");
  pushList(lines, "🆕 New", drift.newSilos.map((s) => s.nodeId));
  pushList(lines, "✅ Resolved (bus_factor cleared or no churn)", drift.resolvedSilos.map((s) => s.nodeId));
  pushList(lines, "📤 Displaced (still single-owner, lower churn)", drift.displacedSilos.map((s) => s.nodeId));
  lines.push("");
}

function pushDriftCoupling(lines: string[], drift: ReportDrift): void {
  lines.push("### Coupling clusters");
  lines.push("");
  pushList(
    lines,
    "🆕 New pairs",
    drift.newCoupling.map((c) => `${c.fileA} ↔ ${c.fileB}`),
  );
  pushIntensified(lines, drift.intensifiedCoupling);
  lines.push("");
}

function pushList(
  lines: string[],
  label: string,
  items: readonly string[],
): void {
  if (items.length === 0) {
    lines.push(`- ${label}: _none_`);
    return;
  }
  lines.push(`- ${label}:`);
  for (const id of items) lines.push(`  - ${id}`);
}

function pushDeltaList(
  lines: string[],
  label: string,
  items: readonly HotspotDelta[],
): void {
  if (items.length === 0) {
    lines.push(`- ${label}: _none_`);
    return;
  }
  lines.push(`- ${label}:`);
  for (const d of items) {
    const sign = d.delta > 0 ? "+" : "";
    lines.push(`  - ${d.nodeId} (${d.before} → ${d.after}, ${sign}${d.delta})`);
  }
}

function pushIntensified(
  lines: string[],
  items: readonly CouplingDelta[],
): void {
  if (items.length === 0) {
    lines.push("- 📈 Intensified: _none_");
    return;
  }
  lines.push("- 📈 Intensified:");
  for (const c of items) {
    lines.push(
      `  - ${c.fileA} ↔ ${c.fileB} (${c.before} → ${c.after})`,
    );
  }
}

// Imported types (avoid unused-import warnings for shared types)
export type { BusFactorChange };
