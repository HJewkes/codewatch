import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import { loadSnapshot, renderHtml, collapseToPackages, focusPackage } from "@codewatch/render";
import { dashboardTemplate } from "./dashboard-template.js";
import {
  type DashboardCommandOptions,
  archInfo,
  collectViolations,
  computeWindowPayloads,
} from "./dashboard-payload.js";

/**
 * `graph dashboard` — assemble a project-status payload from the snapshot and
 * write a single self-contained HTML dashboard (the embedded template with
 * `window.__CODEWATCH__` injected). Reuses the report/check/arch computations
 * (in `dashboard-payload.ts`) so it stays consistent with the CLI's own numbers.
 */

/**
 * Render the interactive Cytoscape dependency graph (the `render` package) so
 * the Architecture view can embed it. Snapshot-level, window-independent.
 * Returns base64 HTML for a data-URI iframe, or null on failure / opt-out.
 */
async function dependencyGraphHtml(opts: DashboardCommandOptions): Promise<string | null> {
  if (opts.graph === false) return null;
  try {
    const raw = await loadSnapshot(opts.db);
    // Default to the package-level collapse — the file-level graph is a 500+ node
    // hairball that answers no question on load. `--graph-scope file` opts back
    // in; `focus:<pkg>` shows one package's files with the rest stubbed.
    const focus = parseFocusScope(opts.graphScope);
    const input = focus
      ? focusPackage(raw, focus)
      : opts.graphScope === "file"
        ? raw
        : collapseToPackages(raw);
    const scopeLabel = focus
      ? `${focus} — internal structure`
      : opts.graphScope === "file"
        ? "file dependencies"
        : "package dependencies";
    const html = await renderHtml(input, {
      title: `${opts.repo ?? "repo"} — ${scopeLabel}`,
      flat: Boolean(focus),
    });
    return Buffer.from(html, "utf8").toString("base64");
  } catch {
    return null; // graph is optional; never fail the dashboard over it.
  }
}

/** Accept "file", "focus:<pkg>", or fall back to "package". */
function normalizeGraphScope(scope: string | undefined): string {
  if (scope === "file") return "file";
  if (scope && scope.startsWith("focus:")) return scope;
  return "package";
}

/** `focus:<pkg>` → the package name; anything else → null. */
function parseFocusScope(scope: string | undefined): string | null {
  if (!scope || !scope.startsWith("focus:")) return null;
  const pkg = scope.slice("focus:".length).trim();
  return pkg || null;
}

export async function runGraphDashboardCommand(opts: DashboardCommandOptions): Promise<{ out: string; snapshotId: number }> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  // arch (structural) and violations are window-independent — compute once.
  const violations = await collectViolations(opts);
  const arch = archInfo(opts.db, repoRoot);
  const graphB64 = await dependencyGraphHtml(opts);

  // One deduped payload per churn window (client switches without a re-run).
  const { windows, primaryKey, snapshotId } = computeWindowPayloads(opts, repoRoot, violations, arch);

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
    .option("--graph-scope <scope>", "Embedded graph granularity: package (default), file, or focus:<pkg>", "package")
    .action(async (options: {
      db: string; config: string; out: string; repoRoot?: string;
      windowDays?: string; vs?: string; repo?: string; includeScripts?: boolean; graph?: boolean;
      graphScope?: string;
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
        graphScope: normalizeGraphScope(options.graphScope),
      });
      console.log(chalk.green(`✓ wrote ${out}`) + chalk.dim(` (snapshot ${snapshotId})`));
    });
}
