import type {
  PackageStats,
  PairCoupling,
  PartitionQualityResult,
} from "@codewatch/graph";
import type { ArchResult } from "./graph-arch.js";
import { formatArchMermaid } from "./graph-arch.js";

/**
 * Format the architecture diagram + partition-quality analysis as a single
 * markdown document. Used by `graph arch --health`.
 */
export function formatArchHealth(result: ArchResult): string {
  const lines: string[] = [];
  lines.push(`# Architecture — snap ${result.snapshot.id} (${result.snapshot.ref})`);
  lines.push("");
  lines.push("```mermaid");
  lines.push(formatArchMermaid(result));
  lines.push("```");
  lines.push("");
  if (result.quality) pushQualityAnalysis(lines, result.quality);
  return lines.join("\n");
}

function pushQualityAnalysis(
  lines: string[],
  quality: PartitionQualityResult,
): void {
  pushPartitionHeader(lines, quality);
  pushPerPackageTable(lines, quality.perPackage);
  pushPairCouplingTable(lines, quality.pairCoupling);
  pushFlagSummary(lines, quality);
}

function pushPartitionHeader(
  lines: string[],
  quality: PartitionQualityResult,
): void {
  const fit = describeQFit(quality.modularityQ);
  lines.push("## Partition quality");
  lines.push("");
  lines.push(
    `Newman-Girvan **Q = ${quality.modularityQ.toFixed(3)}** ${fit}. ` +
      `Computed over ${quality.totalEdges} edges.`,
  );
  lines.push("");
}

function describeQFit(q: number): string {
  if (q >= 0.3) return "(packages capture the natural dependency clustering)";
  if (q >= 0.1) return "(partition partly captures structure)";
  return "(partition does not match the natural clustering — boundaries may be arbitrary)";
}

function pushPerPackageTable(
  lines: string[],
  perPackage: readonly PackageStats[],
): void {
  lines.push("### Per package");
  lines.push("");
  lines.push("| Package | Files | Internal | Out | In | Cohesion | Instability | Layer | Flags |");
  lines.push("|---|--:|--:|--:|--:|--:|--:|---|---|");
  for (const p of perPackage) {
    const flagStr = p.flags.length === 0 ? "" : p.flags.join(", ");
    lines.push(
      `| ${p.pkgId} | ${p.fileCount} | ${p.internalEdges} | ${p.outgoingEdges} | ${p.incomingEdges} | ${p.cohesion.toFixed(2)} | ${p.instability.toFixed(2)} | ${p.layer} | ${flagStr} |`,
    );
  }
  lines.push("");
}

function pushPairCouplingTable(
  lines: string[],
  pairs: readonly PairCoupling[],
): void {
  lines.push("### Pair coupling");
  lines.push("");
  if (pairs.length === 0) {
    lines.push("_No cross-package edges._");
    lines.push("");
    return;
  }
  lines.push("| From → To | Edges | Intensity | Flag |");
  lines.push("|---|--:|--:|---|");
  for (const c of pairs) {
    const flag = c.flag === "none" ? "" : c.flag;
    lines.push(
      `| ${c.from} → ${c.to} | ${c.edges} | ${c.intensity.toFixed(2)} | ${flag} |`,
    );
  }
  lines.push("");
}

function pushFlagSummary(
  lines: string[],
  quality: PartitionQualityResult,
): void {
  if (quality.flagsCount === 0) {
    lines.push("_No structural-quality flags raised._");
    lines.push("");
    return;
  }
  const pkgFlags = quality.perPackage.flatMap((p) =>
    p.flags.map((f) => `- **${p.pkgId}** — ${f}`),
  );
  const pairFlags = quality.pairCoupling
    .filter((c) => c.flag === "tight")
    .map(
      (c) =>
        `- **${c.from} → ${c.to}** — tight coupling (${c.edges} edges, intensity ${c.intensity.toFixed(2)})`,
    );
  lines.push(`### Flags (${quality.flagsCount})`);
  lines.push("");
  for (const f of pkgFlags) lines.push(f);
  for (const f of pairFlags) lines.push(f);
  lines.push("");
}
