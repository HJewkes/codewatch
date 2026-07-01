import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import { loadSnapshot, renderHtml } from "@code-style/render";
import { runGraphReportCommand } from "./graph-report.js";
import { runGraphCheckCommand } from "./graph-check.js";
import { runGraphArchCommand } from "./graph-arch.js";
import { dashboardTemplate } from "./dashboard-template.js";

/**
 * `graph dashboard` — assemble a project-status payload from the snapshot and
 * write a single self-contained HTML dashboard (the embedded template with
 * `window.__CODEWATCH__` injected). Reuses the report/check/arch computations
 * so it stays consistent with the CLI's own numbers.
 */

/**
 * Render the interactive Cytoscape dependency graph (the `render` package) so
 * the Architecture view can embed it. Snapshot-level, window-independent.
 * Returns base64 HTML for a data-URI iframe, or null on failure / opt-out.
 */
async function dependencyGraphHtml(opts: DashboardCommandOptions): Promise<string | null> {
  if (opts.graph === false) return null;
  try {
    const input = await loadSnapshot(opts.db);
    const html = await renderHtml(input, { title: `${opts.repo ?? "repo"} — dependency graph` });
    return Buffer.from(html, "utf8").toString("base64");
  } catch {
    return null; // graph is optional; never fail the dashboard over it.
  }
}

interface DashboardCommandOptions {
  db: string;
  config: string;
  out: string;
  graph?: boolean;
  repoRoot?: string;
  windowDays?: number;
  vs?: string;
  repo?: string;
  includeScripts?: boolean;
}

function buildPayload(
  report: ReturnType<typeof runGraphReportCommand>,
  violations: { rule: string; severity: "error" | "warning"; file: string; detail: string; status: "new" | "carry" | "fixed" }[],
  arch: ArchInfo,
  opts: DashboardCommandOptions,
) {
  const boundaryHealth = arch.boundaryHealth;
  const snap = report.snapshot;
  const scary = report.hotspots.filter((h) => h.score >= 3000).length;
  const openNew = violations.filter((v) => v.status === "new").length;
  const carry = violations.filter((v) => v.status === "carry").length;
  const maxComplexity = report.hotspots.reduce((m, h) => Math.max(m, h.complexity), 0);
  const health = Math.max(0, Math.min(100, 100 - scary * 6 - (openNew + carry) * 5));
  const vs = opts.vs;

  return {
    meta: {
      repo: opts.repo ?? "repo",
      snapshotId: snap.id,
      ref: snap.ref ?? "wd",
      windowDays: report.windowDays,
      generatedAt: new Date().toISOString(),
      indexVersion: snap.indexVersion,
      emptyWindow: report.emptyWindow ?? false,
      hint: report.hint,
      baseline: vs ? { ref: vs, snapshotId: 0 } : null,
    },
    kpis: {
      health,
      newHotspots: scary,
      knowledgeSilos: report.busFactorRisks.length,
      boundaryHealth,
      openViolations: { total: openNew + carry, new: openNew, carry, fixed: 0 },
      maxComplexity,
    },
    hotspots: report.hotspots.map((h) => ({
      nodeId: h.nodeId, churn: h.churn, complexity: h.complexity, score: h.score,
    })),
    busFactorRisks: report.busFactorRisks.map((b) => ({
      nodeId: b.nodeId, topAuthorShare: b.topAuthorShare, churn: b.churn,
    })),
    couplingClusters: report.couplingClusters.map((c) => ({
      a: c.fileA, b: c.fileB, coEdits: c.count, hidden: false,
    })),
    centralFiles: report.centralFiles.map((c) => ({ nodeId: c.nodeId, score: c.score })),
    packages: arch.packages,
    violations,
    drift: report.drift && {
      baselineSnapshotId: report.drift.baselineSnapshot.id,
      newHotspots: report.drift.newHotspots.map((h) => ({ nodeId: h.nodeId, score: h.score })),
      worsened: report.drift.worsenedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      improved: report.drift.improvedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      resolved: report.drift.resolvedHotspots.map((d) => ({ nodeId: d.nodeId, before: d.before, after: d.after, delta: d.delta })),
      newSilos: report.drift.newSilos.map((s) => s.nodeId),
      newCoupling: report.drift.newCoupling.map((c) => ({ a: c.fileA, b: c.fileB, coEdits: c.count, hidden: false })),
    },
  };
}

interface ArchInfo {
  boundaryHealth?: number;
  packages: { pkgId: string; instability: number; abstractness: number; fileCount: number; layer: string; cohesion: number; crossEdges: number }[];
}

function archInfo(db: string, repoRoot: string): ArchInfo {
  try {
    const arch = runGraphArchCommand({ db, repoRoot, health: true });
    const q = arch.quality;
    return {
      boundaryHealth: q?.modularityQ,
      packages: (q?.perPackage ?? []).map((p) => ({
        pkgId: p.pkgId,
        instability: p.instability,
        abstractness: p.abstractness,
        fileCount: p.fileCount,
        layer: p.layer,
        cohesion: p.cohesion,
        // Cross-package edges: 0 ⇒ an isolated dir, not a real package (its
        // instability is a meaningless 0/0). The Architecture view drops these.
        crossEdges: p.outgoingEdges + p.incomingEdges,
      })),
    };
  } catch {
    return { packages: [] }; // arch is a nice-to-have; never fail the dashboard.
  }
}

async function collectViolations(opts: DashboardCommandOptions) {
  try {
    const check = await runGraphCheckCommand({
      db: opts.db,
      config: opts.config,
      baseline: opts.vs ?? "previous",
    });
    return check.result.violations.map((v) => ({
      rule: v.ruleId,
      severity: (v.severity === "warning" ? "warning" : "error") as "error" | "warning",
      file: v.nodeId,
      detail: v.message,
      status: (v.isCarryover ? "carry" : "new") as "new" | "carry" | "fixed",
    }));
  } catch {
    return []; // no config / no baseline → render Fitness as "all clear".
  }
}

const DEFAULT_WINDOWS = [30, 90, 180];

/** Signature over all window-dependent fields, to collapse identical windows. */
function windowSignature(p: ReturnType<typeof buildPayload>): string {
  return JSON.stringify([p.hotspots, p.busFactorRisks, p.couplingClusters, p.violations, p.centralFiles, p.kpis]);
}

export async function runGraphDashboardCommand(opts: DashboardCommandOptions): Promise<{ out: string; snapshotId: number }> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  // arch (structural) and violations are window-independent — compute once.
  const violations = await collectViolations(opts);
  const arch = archInfo(opts.db, repoRoot);
  const graphB64 = await dependencyGraphHtml(opts);

  // Pre-compute a payload per window so the client can switch without a re-run.
  // A requested window that isn't stored resolves (silently) to an available
  // one; key by the RESOLVED window and drop duplicates so the switcher only
  // appears when the data genuinely differs — never fake pills.
  const primaryWindow = opts.windowDays ?? 30;
  const windowsList = Array.from(new Set([primaryWindow, ...DEFAULT_WINDOWS])).sort((a, b) => a - b);
  const windows: Record<string, ReturnType<typeof buildPayload>> = {};
  const sigToKey = new Map<string, string>();
  let snapshotId = 0;
  let primaryKey = String(primaryWindow);
  for (const w of windowsList) {
    const report = runGraphReportCommand({
      db: opts.db, repoRoot, windowDays: w, vs: opts.vs, includeScripts: opts.includeScripts,
    });
    snapshotId = report.snapshot.id;
    const payload = buildPayload(report, violations, arch, opts);
    // Dedup by CONTENT, not just resolved window: a repo with no stored
    // churn_{w}d silently reuses one window's data for all, and a repo with no
    // churn at all produces identical (empty) payloads. Only keep windows whose
    // data genuinely differs, so the switcher never lies. Sign on every
    // window-dependent field, not just hotspots.
    const sig = windowSignature(payload);
    const existing = sigToKey.get(sig);
    if (existing) {
      if (w === primaryWindow) primaryKey = existing; // point primary at the kept key
      continue;
    }
    sigToKey.set(sig, String(w));
    windows[String(w)] = payload;
    if (w === primaryWindow) primaryKey = String(w);
  }

  const primary = windows[primaryKey] ?? Object.values(windows)[0];
  const enc = (v: unknown) => JSON.stringify(v).replace(/<\//g, "<\\/");
  // Only emit the multi-window map when there's real choice.
  const multi = Object.keys(windows).length > 1 ? `window.__CODEWATCH_WINDOWS__ = ${enc(windows)};` : "";
  const graph = graphB64 ? `window.__CODEWATCH_GRAPH__ = ${JSON.stringify(graphB64)};` : "";
  const inject = `<script>window.__CODEWATCH__ = ${enc(primary)};${multi}${graph}</script>`;
  const html = dashboardTemplate().replace("</head>", `${inject}</head>`);
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, html);
  return { out: opts.out, snapshotId };
}

export function registerGraphDashboard(graphCmd: Command): void {
  graphCmd
    .command("dashboard")
    .description(
      "Write a single self-contained HTML project-status dashboard (KPIs, hotspots, fitness, ownership) for the latest snapshot.",
    )
    .option("--db <path>", "Database path", "./.codewatch/graph.db")
    .option("--config <path>", "check.json for fitness violations", "./.codewatch/check.json")
    .option("--out <path>", "Output HTML path", "codewatch-dashboard.html")
    .option("--repo-root <path>", "Repo root for package/churn resolution")
    .option("--window-days <n>", "Churn window in days")
    .option("--vs <ref>", "Baseline snapshot ref for deltas")
    .option("--repo <name>", "Repo display name")
    .option("--include-scripts", "Include scripts/ and archive/ files")
    .option("--no-graph", "Skip the embedded Cytoscape dependency graph (smaller output)")
    .action(async (options: {
      db: string; config: string; out: string; repoRoot?: string;
      windowDays?: string; vs?: string; repo?: string; includeScripts?: boolean; graph?: boolean;
    }) => {
      const { out, snapshotId } = await runGraphDashboardCommand({
        db: options.db,
        config: options.config,
        out: options.out,
        repoRoot: options.repoRoot,
        windowDays: options.windowDays ? Number(options.windowDays) : undefined,
        vs: options.vs,
        repo: options.repo ?? basename(process.cwd()),
        includeScripts: options.includeScripts,
        graph: options.graph,
      });
      console.log(chalk.green(`✓ wrote ${out}`) + chalk.dim(` (snapshot ${snapshotId})`));
    });
}
