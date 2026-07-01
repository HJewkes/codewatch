import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
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

interface DashboardCommandOptions {
  db: string;
  config: string;
  out: string;
  repoRoot?: string;
  windowDays?: number;
  vs?: string;
  repo?: string;
  includeScripts?: boolean;
}

function buildPayload(
  report: ReturnType<typeof runGraphReportCommand>,
  violations: { rule: string; severity: "error" | "warning"; file: string; detail: string; status: "new" | "carry" | "fixed" }[],
  boundaryHealth: number | undefined,
  opts: DashboardCommandOptions,
) {
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
    violations,
  };
}

function boundaryQ(db: string, repoRoot: string): number | undefined {
  try {
    const arch = runGraphArchCommand({ db, repoRoot, health: true });
    return arch.quality?.modularityQ;
  } catch {
    return undefined; // Q is a nice-to-have; never fail the dashboard over it.
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

export async function runGraphDashboardCommand(opts: DashboardCommandOptions): Promise<{ out: string; snapshotId: number }> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const report = runGraphReportCommand({
    db: opts.db,
    repoRoot,
    windowDays: opts.windowDays,
    vs: opts.vs,
    includeScripts: opts.includeScripts,
  });
  const violations = await collectViolations(opts);
  const bq = boundaryQ(opts.db, repoRoot);
  const payload = buildPayload(report, violations, bq, opts);

  const json = JSON.stringify(payload).replace(/<\//g, "<\\/");
  const html = dashboardTemplate().replace(
    "</head>",
    `<script>window.__CODEWATCH__ = ${json};</script></head>`,
  );
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, html);
  return { out: opts.out, snapshotId: report.snapshot.id };
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
    .action(async (options: {
      db: string; config: string; out: string; repoRoot?: string;
      windowDays?: string; vs?: string; repo?: string; includeScripts?: boolean;
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
      });
      console.log(chalk.green(`✓ wrote ${out}`) + chalk.dim(` (snapshot ${snapshotId})`));
    });
}
