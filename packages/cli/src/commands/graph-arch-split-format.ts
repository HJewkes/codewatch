import type {
  ArchSplitResult,
  BridgeEdge,
  ClusterEvidence,
  CoEditDensity,
  PackageSplitEvidence,
} from "./graph-arch-split.js";

/**
 * Render the split diagnostic as markdown. This is EVIDENCE, not a verdict:
 * it surfaces internal clusters, the bridge edges between them, and per-cluster
 * coupling read-outs, and leaves the architectural call to a human. The dogfood
 * proved every structural signal false-positives on a thematically-grouped
 * package (codewatch's own `cli`), so there is deliberately nothing to "flag".
 */
export function formatArchSplit(result: ArchSplitResult): string {
  const lines: string[] = [];
  lines.push(`# Split diagnostic — snap ${result.snapshot.id} (${result.snapshot.ref})`);
  lines.push("");
  lines.push(
    "**Evidence only — no split verdict.** Internal clusters and their bridge " +
      "edges are shown so you can judge whether a package hides separable domains. " +
      "Modular sub-structure is the norm in file graphs; it is not by itself a reason to split.",
  );
  lines.push("");
  if (result.packages.length === 0) {
    lines.push(`_No package has ≥ ${result.minFiles} files; nothing to cluster._`);
    return lines.join("\n");
  }
  for (const pkg of result.packages) pushPackage(lines, pkg, result.coEditAvailable);
  return lines.join("\n");
}

export function formatArchSplitJson(result: ArchSplitResult): string {
  return JSON.stringify(result, null, 2);
}

function pushPackage(
  lines: string[],
  pkg: PackageSplitEvidence,
  coEditAvailable: boolean,
): void {
  lines.push(
    `## ${pkg.name} (${pkg.pkgId}) — ${pkg.fileCount} files, ` +
      `${pkg.clusters.length} clusters, sub-Q ${pkg.subModularityQ.toFixed(3)}`,
  );
  lines.push("");
  pushBridges(lines, pkg.bridges);
  pushClusters(lines, pkg.clusters);
  pushReadouts(lines, pkg, coEditAvailable);
}

/** Bridge edges lead — they are the actionable artifact regardless of any split. */
function pushBridges(lines: string[], bridges: readonly BridgeEdge[]): void {
  lines.push(`### Bridge edges (${bridges.length})`);
  lines.push("");
  if (bridges.length === 0) {
    lines.push("_No cross-cluster edges — clusters are already disconnected._");
    lines.push("");
    return;
  }
  lines.push("| From → To | Clusters | Count |");
  lines.push("|---|---|--:|");
  for (const b of bridges) {
    lines.push(
      `| ${b.from} → ${b.to} | ${b.fromCluster} → ${b.toCluster} | ${b.count} |`,
    );
  }
  lines.push("");
}

function pushClusters(lines: string[], clusters: readonly ClusterEvidence[]): void {
  lines.push("### Clusters");
  lines.push("");
  for (const c of clusters) {
    const ext =
      c.externalPackages.length === 0
        ? "no external deps"
        : `imports ${c.externalPackages.join(", ")}`;
    lines.push(`- **${c.id}** (${c.files.length} files) — ${ext}`);
    for (const f of c.files) lines.push(`  - ${f}`);
  }
  lines.push("");
}

function pushReadouts(
  lines: string[],
  pkg: PackageSplitEvidence,
  coEditAvailable: boolean,
): void {
  lines.push("### Method read-outs");
  lines.push("");
  lines.push(`- External-coupling cosine (min between ext-dep clusters): ${formatCosine(pkg.minExternalCosine)}`);
  lines.push(`- Directory alignment (cluster purity): ${pkg.directoryAlignment.toFixed(2)}`);
  lines.push(`- Co-edit density within/cross: ${formatCoEdit(pkg.coEdit, coEditAvailable)}`);
  lines.push("");
}

function formatCosine(cosine: number | null): string {
  return cosine === null
    ? "n/a (fewer than 2 clusters with external deps)"
    : cosine.toFixed(2);
}

function formatCoEdit(coEdit: CoEditDensity | undefined, available: boolean): string {
  if (!available || !coEdit) return "unavailable (no git history)";
  const ratio = coEdit.ratio === null ? "n/a" : coEdit.ratio.toFixed(2);
  return `${coEdit.within.toFixed(2)} / ${coEdit.cross.toFixed(2)} (ratio ${ratio})`;
}
