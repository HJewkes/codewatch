import type { Command } from "commander";
import { formatError } from "../utils/output.js";
import { registerGraphArch } from "./graph-arch.js";
import { registerGraphAutoUpdate } from "./graph-auto-update.js";
import { registerGraphCoupled } from "./graph-coupled.js";
import { registerGraphCoverage } from "./graph-coverage.js";
import { registerGraphDashboard } from "./graph-dashboard.js";
import { registerGraphPrune } from "./graph-prune.js";
import { registerGraphRelevant } from "./graph-relevant.js";
import { registerGraphRenderCheckDiff } from "./graph-render-check-diff.js";
import { registerRender, registerRenderDiff } from "./graph-render-cli.js";
import { registerGraphReport } from "./graph-report.js";
import { registerGraphWiki } from "./graph-wiki.js";

function reportError(err: unknown): void {
  console.error(formatError(err instanceof Error ? err.message : String(err)));
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

/** Parse `--churn-windows` (variadic and/or comma-separated) into positive days. */
function asNumberList(values: string[] | undefined): number[] | undefined {
  if (values === undefined) return undefined;
  const out = values
    .flatMap((v) => v.split(","))
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return out.length > 0 ? out : undefined;
}

export function registerGraphCommands(program: Command): void {
  const graphCmd = program
    .command("graph")
    .description("Code graph commands (index, query, render, check)");

  registerIndex(graphCmd);
  registerGraphAutoUpdate(graphCmd);
  registerDiff(graphCmd);
  registerCheck(graphCmd);
  registerCheckDiff(graphCmd);
  registerTop(graphCmd);
  registerGraphRelevant(graphCmd);
  registerGraphCoupled(graphCmd);
  registerGraphReport(graphCmd);
  registerGraphCoverage(graphCmd);
  registerGraphDashboard(graphCmd);
  registerGraphWiki(graphCmd);
  registerGraphArch(graphCmd);
  registerRenderDiff(graphCmd);
  registerRender(graphCmd);
  registerGraphRenderCheckDiff(graphCmd);
  registerGraphPrune(graphCmd);
}

function registerIndex(graphCmd: Command): void {
  graphCmd
    .command("index <paths...>")
    .description(
      "Build a code graph snapshot. Pass one or more directories to walk; node ids are rooted at the git toplevel so importers across subtrees share the same id space (e.g. `graph index packages tests`).",
    )
    .option(
      "--db <path>",
      "Database path (default: <git-toplevel>/.codewatch/graph.db)",
    )
    .option("--ref <ref>", "Snapshot ref label", "wd")
    .option("--ts-config <path>", "Path to tsconfig.json for ts-morph")
    .option(
      "--no-detect-renames",
      "Skip git rename detection (no id_alias entries)",
    )
    .option(
      "--no-compute-metrics",
      "Skip pure-graph metrics (fan_in, fan_out, instability)",
    )
    .option(
      "--no-churn",
      "Skip git churn metrics (churn_30d, churn_30d_commits, churn_30d_authors)",
    )
    .option(
      "--churn-window <days>",
      "Primary window (days) for churn/ownership/coupling metrics (default 30)",
    )
    .option(
      "--churn-windows <days...>",
      "Comma- or space-separated windows to store churn for so the dashboard switcher can resolve each (default 30,90,180)",
    )
    .option(
      "--no-incremental",
      "Force a full index — disable byte-identical file reuse (default: reuse the prior snapshot for unchanged files, falling back to a full index when files are added or removed)",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (
        rootDirs: string[],
        options: {
          db?: string;
          ref?: string;
          tsConfig?: string;
          detectRenames?: boolean;
          computeMetrics?: boolean;
          churn?: boolean;
          churnWindow?: string;
          churnWindows?: string[];
          incremental?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const { runGraphIndexCommand } = await import("./graph-index.js");
          const { output } = await runGraphIndexCommand({
            rootDirs,
            dbPath: options.db,
            ref: options.ref,
            tsConfigPath: options.tsConfig,
            detectRenames: options.detectRenames,
            computeMetrics: options.computeMetrics,
            computeChurn: options.churn,
            churnWindowDays: asNumber(options.churnWindow),
            churnWindows: asNumberList(options.churnWindows),
            incremental: options.incremental,
            json: options.json,
          });
          console.log(output);
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}

function registerDiff(graphCmd: Command): void {
  graphCmd
    .command("diff")
    .description("Diff two graph snapshots (added / removed / renamed nodes + edges, metric deltas)")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .requiredOption("--from <ref-or-id>", "From-side snapshot: numeric id or ref name")
    .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
    .option("--json", "Output structured JSON")
    .action(
      async (options: { db: string; from: string; to: string; json?: boolean }) => {
        try {
          const { runGraphDiffCommand, formatGraphDiffText, formatGraphDiffJson } =
            await import("./graph-diff.js");
          const result = await runGraphDiffCommand(options);
          console.log(
            options.json
              ? formatGraphDiffJson(result)
              : formatGraphDiffText(result),
          );
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}

function registerCheck(graphCmd: Command): void {
  graphCmd
    .command("check")
    .description("Run rule checks against a snapshot (max-complexity, no-imports, …). Exits non-zero on violations.")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--config <path>", "Rules file (JSON)", "./.codewatch/check.json")
    .option(
      "--snapshot <ref-or-id>",
      "Snapshot to check: numeric id or ref name (default: latest)",
    )
    .option(
      "--baseline <ref-or-id>",
      "Suppress violations that already exist in this baseline snapshot",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        config: string;
        snapshot?: string;
        baseline?: string;
        json?: boolean;
      }) => {
        try {
          const { runGraphCheckCommand, formatGraphCheckText, formatGraphCheckJson } =
            await import("./graph-check.js");
          const result = await runGraphCheckCommand({
            db: options.db,
            config: options.config,
            snapshot: options.snapshot,
            baseline: options.baseline,
          });
          console.log(
            options.json
              ? formatGraphCheckJson(result)
              : formatGraphCheckText(result),
          );
          process.exitCode = result.result.passed ? 0 : 1;
        } catch (err) {
          reportError(err);
          process.exitCode = 2;
        }
      },
    );
}

function registerCheckDiff(graphCmd: Command): void {
  graphCmd
    .command("check-diff")
    .description("Diff rule violations across two snapshots (new / resolved / worsened / improved)")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--config <path>", "Rules file (JSON)", "./.codewatch/check.json")
    .requiredOption("--from <ref-or-id>", "From-side snapshot")
    .requiredOption("--to <ref-or-id>", "To-side snapshot")
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        config: string;
        from: string;
        to: string;
        json?: boolean;
      }) => {
        try {
          const {
            runGraphCheckDiffCommand,
            formatGraphCheckDiffText,
            formatGraphCheckDiffJson,
          } = await import("./graph-check-diff.js");
          const result = await runGraphCheckDiffCommand(options);
          console.log(
            options.json
              ? formatGraphCheckDiffJson(result)
              : formatGraphCheckDiffText(result),
          );
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}

function registerTop(graphCmd: Command): void {
  graphCmd
    .command("top")
    .description("List top nodes by a metric (hotspot view)")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .requiredOption("--metric <name>", "Metric name (e.g. cyclomatic_max, loc, fan_in)")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .option("--limit <n>", "Number of rows to return", "20")
    .option("--kind <kind>", "Filter to one node kind (file, module, package, external)")
    .option(
      "--exclude <pattern...>",
      "Exclude node ids matching this glob or substring (repeatable)",
    )
    .option(
      "--exclude-role <role...>",
      "Exclude nodes with this role (test, fixture, barrel, types, config; repeatable)",
    )
    .option("--json", "Output structured JSON")
    .action(
      async (options: {
        db: string;
        metric: string;
        snapshot?: string;
        limit?: string;
        kind?: string;
        exclude?: string[];
        excludeRole?: string[];
        json?: boolean;
      }) => {
        try {
          const { runGraphTopCommand, formatGraphTopText, formatGraphTopJson } =
            await import("./graph-top.js");
          const result = runGraphTopCommand({
            db: options.db,
            metric: options.metric,
            snapshot: asNumber(options.snapshot),
            limit: asNumber(options.limit),
            kind: options.kind,
            exclude: options.exclude,
            excludeRole: options.excludeRole,
          });
          console.log(
            options.json ? formatGraphTopJson(result) : formatGraphTopText(result),
          );
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}
