import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import {
  loadSnapshot,
  renderHtml,
  renderMultiViewHtml,
  collapseToPackages,
  collapseToDirectories,
  focusPackage,
  packagesInSnapshot,
  resolveBarrels,
  type GraphView,
} from "@codewatch/render";
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
    const repo = opts.repo ?? "repo";
    const b64 = (html: string): string => Buffer.from(html, "utf8").toString("base64");

    // Explicit single-scope requests stay single-view.
    const focus = parseFocusScope(opts.graphScope);
    if (focus) {
      return b64(await renderHtml(focusPackage(raw, focus), {
        title: `${repo} — ${focus} internal structure`,
        flat: true,
      }));
    }
    if (opts.graphScope === "file") {
      // The file-level graph is a 500+ node hairball; opt-in only. Lay it out as
      // an ELK compound hierarchy (files nested in package boxes) with orthogonal
      // routing rather than client-side cose-bilkent (C-48).
      return b64(await renderHtml(raw, { title: `${repo} — file dependencies`, compound: true }));
    }
    if (opts.graphScope === "nested") {
      // Drill deeper than `file`: nest files inside their directory boxes inside
      // their package boxes — package → subdir → file (C-56).
      return b64(await renderHtml(raw, {
        title: `${repo} — file dependencies (nested by directory)`,
        compound: true,
        nested: true,
      }));
    }
    if (opts.graphScope === "module") {
      return b64(await renderHtml(collapseToDirectories(raw), {
        title: `${repo} — module (directory) coupling`,
      }));
    }

    // Default: an interactive multi-view graph — the package overview, a module
    // (directory) coupling view, then one within-package focus view per package,
    // switchable from the toolbar picker. Each barrel-sensitive view also bakes a
    // hidden `::resolved` variant so the "See through barrels" toggle can flip
    // between the raw graph (imports land on the index.ts hub) and the resolved
    // one (edges rerouted to the files the barrel forwards to). The package
    // overview is invariant to barrels, so it needs no variant.
    const resolved = resolveBarrels(raw);
    const views: GraphView[] = [
      { id: "__overview__", label: "All packages", input: collapseToPackages(raw), flat: false },
      { id: "__modules__", label: "Modules", input: collapseToDirectories(raw, { resolve: false }), flat: false },
      { id: "__modules__::resolved", label: "Modules", input: collapseToDirectories(raw, { resolve: true }), flat: false, hidden: true },
      ...packagesInSnapshot(raw).flatMap((pkg) => [
        { id: pkg, label: pkg, input: focusPackage(raw, pkg), flat: true },
        { id: `${pkg}::resolved`, label: pkg, input: focusPackage(resolved, pkg), flat: true, hidden: true },
      ]),
    ];
    return b64(await renderMultiViewHtml(views, { title: `${repo} — architecture` }));
  } catch {
    return null; // graph is optional; never fail the dashboard over it.
  }
}

/** Accept "file", "nested", "module", "focus:<pkg>", or fall back to "package". */
function normalizeGraphScope(scope: string | undefined): string {
  if (scope === "file" || scope === "nested" || scope === "module") return scope;
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
    .option("--window-days <n>", "Primary churn window in days, or `lifetime` for all-time (needs a `--lifetime` index)")
    .option("--vs <ref>", "Baseline snapshot ref for deltas")
    .option("--repo <name>", "Repo display name")
    .option("--include-scripts", "Include scripts/ and archive/ files")
    .option("--no-graph", "Skip the embedded Cytoscape dependency graph (smaller output)")
    .option("--graph-scope <scope>", "Embedded graph granularity: package (default), module, file, nested (files-in-dirs), or focus:<pkg>", "package")
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
        windowDays: options.windowDays
          ? options.windowDays.toLowerCase() === "lifetime"
            ? "lifetime"
            : Number(options.windowDays)
          : undefined,
        vs: options.vs,
        repo: options.repo ?? basename(process.cwd()),
        includeScripts: options.includeScripts,
        graph: options.graph,
        graphScope: normalizeGraphScope(options.graphScope),
      });
      console.log(chalk.green(`✓ wrote ${out}`) + chalk.dim(` (snapshot ${snapshotId})`));
    });
}
