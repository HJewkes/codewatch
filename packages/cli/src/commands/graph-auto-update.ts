import * as fs from "node:fs/promises";
import type { Command } from "commander";
import {
  runGraphIndex,
  type GraphIndexResult,
} from "@code-style/graph";
import { formatError } from "../utils/output.js";

export const DEFAULT_CONFIG_PATH = "./.codewatch/check.json";

export interface GraphAutoUpdateOptions {
  rootDirs: string[];
  dbPath?: string;
  configPath?: string;
}

export interface GraphAutoUpdateResult {
  /** False when `autoUpdate` is not enabled in the config — nothing was indexed. */
  ran: boolean;
  result?: GraphIndexResult;
}

/**
 * Read the `autoUpdate` opt-in flag from a check.json config. A missing,
 * unreadable, or invalid config means "disabled" — auto-update is strictly
 * opt-in and must never break a workflow by throwing here.
 */
async function readAutoUpdateFlag(configPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { autoUpdate?: unknown };
    return parsed.autoUpdate === true;
  } catch {
    return false;
  }
}

/**
 * Config-gated incremental re-index, intended for a post-commit hook. No-ops
 * unless `autoUpdate: true` is set in the check.json config; when enabled, runs
 * an incremental `graph index` (reusing byte-identical files) so the snapshot
 * stays fresh without anyone running the indexer by hand.
 */
export async function runGraphAutoUpdate(
  options: GraphAutoUpdateOptions,
): Promise<GraphAutoUpdateResult> {
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  if (!(await readAutoUpdateFlag(configPath))) {
    return { ran: false };
  }
  const result = await runGraphIndex({
    rootDirs: options.rootDirs,
    dbPath: options.dbPath,
    incremental: true,
  });
  return { ran: true, result };
}

export function registerGraphAutoUpdate(graphCmd: Command): void {
  graphCmd
    .command("auto-update [paths...]")
    .description(
      "Config-gated incremental re-index for a post-commit hook. No-ops unless `autoUpdate: true` is set in the check.json config; otherwise refreshes the snapshot by reusing byte-identical files.",
    )
    .option("--db <path>", "Database path (default: <path>/.codewatch/graph.db)")
    .option(
      "--config <path>",
      "check.json holding the autoUpdate opt-in flag",
      DEFAULT_CONFIG_PATH,
    )
    .action(async (paths: string[], options: { db?: string; config?: string }) => {
      try {
        const out = await runGraphAutoUpdate({
          rootDirs: paths.length > 0 ? paths : ["."],
          dbPath: options.db,
          configPath: options.config,
        });
        if (out.ran && out.result) {
          console.log(
            `auto-update: re-indexed snapshot ${out.result.snapshotId} ` +
              `(${out.result.reusedFiles} reused, ${out.result.reparsedFiles} re-parsed)`,
          );
        }
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
