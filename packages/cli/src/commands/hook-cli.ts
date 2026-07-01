import type { Command } from "commander";
import { formatError, formatSuccess } from "../utils/output.js";

interface InstallOptions {
  withGraphCheck?: boolean;
  styleCheck?: boolean;
  graphPath?: string[];
  dbPath?: string;
  configPath?: string;
  bin?: string;
}

export function registerHookCommands(program: Command): void {
  const hookCmd = program
    .command("hook")
    .description("Manage git pre-commit and post-commit hooks");

  hookCmd
    .command("install")
    .description("Install codewatch pre-commit (and opt-in post-commit) hooks")
    .option(
      "--with-graph-check",
      "Also run `graph index <path> && graph check` when staged changes touch source files",
    )
    .option(
      "--no-style-check",
      "Skip the `codewatch diff --fix` line (use when no profile is configured)",
    )
    .option(
      "--graph-path <paths...>",
      "One or more directories to index for the graph check (default: .)",
    )
    .option(
      "--db-path <path>",
      "Shared db path for `graph index` and `graph check` (default: .codewatch/graph.db)",
    )
    .option(
      "--config-path <path>",
      "check.json the post-commit auto-update hook reads its opt-in flag from (default: .codewatch/check.json)",
    )
    .option(
      "--bin <command>",
      "CLI binary to invoke from the hook (default: codewatch)",
    )
    .action(async (options: InstallOptions) => {
      try {
        await runInstall(options);
        console.log(formatSuccess(describeInstalled(options)));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  hookCmd
    .command("remove")
    .description("Remove codewatch pre-commit and post-commit hooks")
    .action(async () => {
      try {
        const { removeHook, removeAutoUpdateHook } = await import("./hook.js");
        await removeHook(process.cwd());
        await removeAutoUpdateHook(process.cwd());
        console.log(formatSuccess("Pre-commit and post-commit hooks removed."));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}

async function runInstall(options: InstallOptions): Promise<void> {
  const { installHook, installAutoUpdateHook, removeAutoUpdateHook } =
    await import("./hook.js");
  await installHook(process.cwd(), {
    withGraphCheck: options.withGraphCheck,
    withStyleCheck: options.styleCheck,
    graphPath: options.graphPath,
    dbPath: options.dbPath,
    bin: options.bin,
  });
  // The post-commit auto-update hook shares the graph paths/db and only makes
  // sense alongside graph integration; it self-gates on `autoUpdate` in
  // check.json, so installing it is invisible until the user opts in there.
  if (options.withGraphCheck) {
    await installAutoUpdateHook(process.cwd(), {
      graphPath: options.graphPath,
      dbPath: options.dbPath,
      configPath: options.configPath,
      bin: options.bin,
    });
  } else {
    await removeAutoUpdateHook(process.cwd());
  }
}

function describeInstalled(options: InstallOptions): string {
  const parts: string[] = [];
  if (options.styleCheck !== false) parts.push("style");
  if (options.withGraphCheck) parts.push("graph check");
  const base = `Pre-commit hook installed (${parts.join(" + ")}).`;
  if (options.withGraphCheck) {
    return `${base} Post-commit auto-update hook installed (set "autoUpdate": true in check.json to enable).`;
  }
  return base;
}
