import type {
  CrossPkgDepRow,
  PackageWiki,
  WikiResult,
} from "./graph-wiki-sections.js";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  HotspotRow,
} from "./graph-report-types.js";

export interface WikiFile {
  /** Path relative to the output directory. */
  path: string;
  content: string;
}

/** Slug for a per-package wiki page filename, e.g. "packages/cli" → "packages-cli.md". */
export function pageFilename(pkgId: string): string {
  return `${pkgId.replace(/\//g, "-")}.md`;
}

export function formatWiki(result: WikiResult): WikiFile[] {
  const out: WikiFile[] = [
    { path: "README.md", content: formatIndex(result) },
  ];
  for (const pkg of result.packages) {
    out.push({
      path: pageFilename(pkg.pkg.id),
      content: formatPackagePage(pkg, result),
    });
  }
  return out;
}

function formatIndex(result: WikiResult): string {
  const lines: string[] = [];
  lines.push(`# Codebase wiki`);
  lines.push("");
  lines.push(
    `Snapshot ${result.snapshot.id} (${result.snapshot.ref}), ` +
      `${result.windowDays}-day window. ` +
      `Generated ${new Date().toISOString().slice(0, 10)}.`,
  );
  lines.push("");
  if (result.packages.length === 0) {
    lines.push("_No packages found._");
    return lines.join("\n");
  }
  lines.push("| Package | Files | Churn | Hotspots | Silos |");
  lines.push("|---|--:|--:|--:|--:|");
  for (const p of result.packages) {
    const link = `[${p.pkg.id}](./${pageFilename(p.pkg.id)})`;
    lines.push(
      `| ${link} | ${p.summary.files} | ${p.summary.totalChurn} | ` +
        `${p.summary.hotspots} | ${p.summary.silos} |`,
    );
  }
  return lines.join("\n");
}

function formatPackagePage(pkg: PackageWiki, result: WikiResult): string {
  const lines: string[] = [];
  lines.push(`# ${pkg.pkg.id}`);
  if (pkg.pkg.name !== pkg.pkg.id) {
    lines.push("");
    lines.push(`_${pkg.pkg.name}_`);
  }
  lines.push("");
  lines.push(
    `Snapshot ${result.snapshot.id} (${result.snapshot.ref}), ` +
      `${result.windowDays}-day window. ` +
      `[← back to index](./README.md)`,
  );
  lines.push("");
  pushSummary(lines, pkg);
  pushHotspots(lines, pkg.hotspots);
  pushSilos(lines, pkg.silos);
  pushCoupling(lines, pkg.coupling);
  pushCrossDeps(lines, "Inbound dependencies", pkg.inbound, "from");
  pushCrossDeps(lines, "Outbound dependencies", pkg.outbound, "to");
  pushCentral(lines, pkg.central);
  return lines.join("\n");
}

function pushSummary(lines: string[], pkg: PackageWiki): void {
  lines.push("## At a glance");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|--:|");
  lines.push(`| Files | ${pkg.summary.files} |`);
  lines.push(`| Total churn | ${pkg.summary.totalChurn} |`);
  lines.push(`| Max distinct authors / file | ${pkg.summary.distinctAuthors} |`);
  lines.push(`| Hotspots | ${pkg.summary.hotspots} |`);
  lines.push(`| Single-owner files | ${pkg.summary.silos} |`);
  lines.push("");
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

function pushSilos(lines: string[], rows: readonly BusFactorRow[]): void {
  lines.push("## Knowledge silos (bus factor = 1)");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No single-owner files._");
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
  lines.push("## Tight coupling within this package");
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No intra-package co-edits ≥ 2 in window._");
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

function pushCrossDeps(
  lines: string[],
  title: string,
  rows: readonly CrossPkgDepRow[],
  preposition: "from" | "to",
): void {
  lines.push(`## ${title}`);
  lines.push("");
  if (rows.length === 0) {
    lines.push(`_No edges ${preposition} other packages._`);
    lines.push("");
    return;
  }
  lines.push(`| ${preposition === "from" ? "From" : "To"} | Count | Example |`);
  lines.push("|---|--:|---|");
  for (const r of rows) {
    lines.push(`| ${r.pkg} | ${r.count} | ${r.examples[0] ?? ""} |`);
  }
  lines.push("");
}

function pushCentral(lines: string[], rows: readonly CentralRow[]): void {
  lines.push("## Most central files (PageRank)");
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
