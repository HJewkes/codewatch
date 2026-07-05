import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { formatError, formatSuccess } from "../utils/output.js";
import { installHook } from "./hook.js";
import { runGraphIndexCommand } from "./graph-index.js";

/**
 * A generic, repo-agnostic starter rule set. Metric ceilings only — no
 * `layered-deps`/`forbid-import`/`no-internal-only-barrels`, because those need
 * project-specific package roots the scaffolder cannot infer. The `$comment`
 * points users at the schema reference to add architecture rules themselves.
 * `scary-hotspots` is churn-based, so it is meant to run with `--baseline`.
 */
const DEFAULT_CHECK_CONFIG = {
  $comment:
    "codewatch fitness rules — see docs/check-json-schema.md for the full schema. " +
    "Run `codewatch graph check --snapshot head --baseline main` in CI. " +
    "Add `layered-deps`/`no-internal-only-barrels` rules for architecture enforcement.",
  rules: [
    {
      id: "max-file-loc",
      type: "metric-max",
      metric: "loc",
      kind: "file",
      max: 350,
      excludeRoles: ["test", "fixture"],
    },
    {
      id: "max-cyclomatic-per-function",
      type: "metric-max",
      metric: "cyclomatic_max",
      kind: "file",
      max: 30,
      excludeRoles: ["test", "fixture"],
    },
    {
      id: "max-nesting-depth",
      type: "metric-max",
      metric: "max_nesting_depth",
      kind: "file",
      max: 5,
      excludeRoles: ["test", "fixture"],
    },
    {
      $comment:
        "High churn x high cognitive load = the riskiest file to touch. " +
        "Run with --baseline so existing hotspots are carryover, not new failures.",
      id: "scary-hotspots",
      type: "metric-product-max",
      metrics: ["churn_30d", "cognitive_max", "recency_30d"],
      kind: "file",
      max: 3000,
      excludeRoles: ["test", "fixture"],
    },
  ],
} as const;

export interface GraphInitCommandOptions {
  path: string;
  db?: string;
  config?: string;
  force?: boolean;
  hook?: boolean;
  index?: boolean;
  json?: boolean;
}

export interface GraphInitResult {
  configPath: string;
  config: "written" | "skipped";
  hookInstalled: boolean;
  seededSnapshotId: number | null;
}

export async function runGraphInitCommand(
  options: GraphInitCommandOptions,
): Promise<GraphInitResult> {
  const targetDir = resolve(options.path);
  const configPath = resolve(
    options.config ?? `${targetDir}/.codewatch/check.json`,
  );
  const dbPath = options.db ?? `${targetDir}/.codewatch/graph.db`;

  const config = await writeCheckConfig(configPath, options.force ?? false);
  if (options.hook) {
    await installHook(targetDir, { withGraphCheck: true, dbPath });
  }
  const seededSnapshotId = options.index
    ? await seedBaseline(targetDir, dbPath)
    : null;

  return {
    configPath,
    config,
    hookInstalled: options.hook ?? false,
    seededSnapshotId,
  };
}

async function writeCheckConfig(
  configPath: string,
  force: boolean,
): Promise<"written" | "skipped"> {
  if (!force && (await exists(configPath))) return "skipped";
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(DEFAULT_CHECK_CONFIG, null, 2) + "\n");
  return "written";
}

async function seedBaseline(targetDir: string, dbPath: string): Promise<number> {
  const { result } = await runGraphIndexCommand({
    rootDirs: [targetDir],
    dbPath,
    ref: "main",
  });
  return result.snapshotId;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export function formatGraphInitJson(result: GraphInitResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatGraphInitText(result: GraphInitResult): string {
  const lines: string[] = [];
  lines.push(
    result.config === "written"
      ? formatSuccess(`Wrote ${result.configPath}`)
      : `Kept existing ${result.configPath} (use --force to overwrite)`,
  );
  if (result.hookInstalled) {
    lines.push(formatSuccess("Installed pre-commit hook (graph index + check)"));
  }
  if (result.seededSnapshotId !== null) {
    lines.push(
      formatSuccess(`Seeded baseline snapshot ${result.seededSnapshotId}`),
    );
  }
  lines.push("");
  lines.push("Next: `codewatch graph check --snapshot head --baseline main`");
  return lines.join("\n");
}

export function registerGraphInit(graphCmd: Command): void {
  graphCmd
    .command("init [path]")
    .description(
      "Scaffold a .codewatch workspace: writes a default check.json, optionally installs the pre-commit hook and seeds a baseline snapshot.",
    )
    .option("--db <path>", "Graph db path (default: <path>/.codewatch/graph.db)")
    .option(
      "--config <path>",
      "check.json path (default: <path>/.codewatch/check.json)",
    )
    .option("--force", "Overwrite an existing check.json")
    .option("--hook", "Install the pre-commit hook (graph index + check)")
    .option("--index", "Seed a baseline snapshot by indexing <path> now")
    .option("--json", "Output structured JSON")
    .action(async (path: string | undefined, options: GraphInitCommandOptions) => {
      try {
        const result = await runGraphInitCommand({ ...options, path: path ?? "." });
        console.log(
          options.json
            ? formatGraphInitJson(result)
            : formatGraphInitText(result),
        );
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
    });
}
