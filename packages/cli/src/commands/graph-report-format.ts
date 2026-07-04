import type {
  BusFactorChange,
  BusFactorRow,
  CentralRow,
  CouplingDelta,
  CouplingRow,
  GraphReportResult,
  HotspotDelta,
  DeadModuleRow,
  GrowthRiskRow,
  HotspotRow,
  ReportDrift,
  TestCoverageRow,
  UntestedRiskRow,
  UnusedExportRow,
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
  if (result.emptyWindow && result.hint) {
    lines.push(`> ⚠️ ${result.hint}`);
    lines.push("");
  }
  // With no churn in the window, Hotspots / Knowledge-silos / Test-coverage /
  // Coupling are all churn-derived and definitionally empty — rendering four
  // "_No …_" stubs reads as a broken report. Show the hint plus the structural
  // (churn-independent) Centrality signal instead (C-23).
  if (!result.emptyWindow) {
    pushHotspots(lines, result.hotspots);
    pushBusFactor(lines, result.busFactorRisks);
    pushTestCoverage(lines, result.testCoverageRisks);
    pushCoupling(lines, result.couplingClusters);
  }
  pushCentral(lines, result.centralFiles);
  pushUnusedExports(lines, result.unusedExports);
  pushDeadModules(lines, result.deadModules);
  pushGrowthRisks(lines, result.growthRisks);
  pushUntestedRisks(lines, result.untestedRisks);
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

function pushTestCoverage(
  lines: string[],
  rows: readonly TestCoverageRow[],
): void {
  lines.push("## Test-coverage silos (test bus factor = 1)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No single-author test coverage in the window._");
    lines.push("");
    return;
  }
  lines.push("| Source | Test top-author share | Linked tests |");
  lines.push("|---|--:|--:|");
  for (const r of rows) {
    lines.push(
      `| ${r.nodeId} | ${(r.testTopAuthorShare * 100).toFixed(0)}% | ` +
        `${r.linkedTests} |`,
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

/**
 * Exported symbols nothing imports by name (C-65). Framed "no reference found",
 * not "dead" — an internal-only or externally-consumed export legitimately reads
 * zero here. The Confidence column splits internal (higher — safe to un-export or
 * remove) from public-API (lower — a barrel re-exports it, so a published-package
 * consumer might use it).
 */
function pushUnusedExports(
  lines: string[],
  rows: readonly UnusedExportRow[],
): void {
  lines.push("## Unused exports (no reference found)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No unreferenced exports._");
    lines.push("");
    return;
  }
  lines.push("| Export | File | Complexity | Confidence |");
  lines.push("|---|---|--:|---|");
  for (const r of rows) {
    const confidence = r.publicApi ? "public API" : "internal";
    lines.push(
      `| \`${r.name}\` | ${r.fileId} | ${r.cognitive} | ${confidence} |`,
    );
  }
  lines.push("");
}

/**
 * Files no importer reaches from the entry roots (C-65). Framed "no importer
 * found," not "dead" — a computed dynamic import, a DI/registry string, or a
 * non-barrel package entry can make a live file look unreferenced. A lead to
 * investigate, ranked by size.
 */
function pushDeadModules(lines: string[], rows: readonly DeadModuleRow[]): void {
  lines.push("## Unreferenced files (no importer found)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_Every file is reachable from an entry root._");
    lines.push("");
    return;
  }
  lines.push("| File | LOC | Role |");
  lines.push("|---|--:|---|");
  for (const r of rows) {
    lines.push(`| ${r.nodeId} | ${r.loc} | ${r.role} |`);
  }
  lines.push("");
}

/**
 * Structural scaling smells (C-66) — deep loop nesting, direct recursion, and
 * linear-scan calls inside loops, as growth-risk proxies. Explicitly heuristic:
 * a "smell," NOT a proven complexity bound (depth-2 loops over two different
 * collections are linear; a `.includes` on a `Set` is O(1); recursion may be
 * well-bounded).
 */
function pushGrowthRisks(lines: string[], rows: readonly GrowthRiskRow[]): void {
  lines.push("## Growth-risk (scaling smells — heuristic, not a proven bound)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No deep loop nesting._");
    lines.push("");
    return;
  }
  lines.push("| File | Scaling smells |");
  lines.push("|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.nodeId} | ${r.smells.join("; ")} |`);
  }
  lines.push("");
}

/**
 * Under-tested hotspots (C-63): load-bearing, complex, churning AND under-covered
 * — `hotspot × (1 − coverage)`. Empty unless a coverage report has been ingested
 * (`graph coverage`); coverage is an overlay, never inferred, so no report ⇒ no
 * rows rather than a stale/assumed number.
 */
function pushUntestedRisks(lines: string[], rows: readonly UntestedRiskRow[]): void {
  lines.push("## Untested risk (hotspot × uncovered)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No coverage ingested (run `graph coverage`), or every hotspot is covered._");
    lines.push("");
    return;
  }
  lines.push("| File | Coverage | Hotspot | Untested risk |");
  lines.push("|---|--:|--:|--:|");
  for (const r of rows) {
    lines.push(`| ${r.nodeId} | ${r.coverage}% | ${r.hotspot} | ${r.score} |`);
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
