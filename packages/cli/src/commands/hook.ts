import * as fs from "node:fs/promises";
import * as path from "node:path";

const MARKER_BEGIN = "# codewatch pre-commit hook (begin)";
const MARKER_END = "# codewatch pre-commit hook (end)";
const POST_MARKER_BEGIN = "# codewatch post-commit hook (begin)";
const POST_MARKER_END = "# codewatch post-commit hook (end)";
const TS_GLOB = "\\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$";

export interface InstallHookOptions {
  withGraphCheck?: boolean;
  withStyleCheck?: boolean;
  /**
   * One or more directories the indexer should walk. Accepts a single
   * path (back-compat) or an array. Multiple paths get joined with
   * spaces; the indexer treats them as additional roots.
   */
  graphPath?: string | string[];
  dbPath?: string;
  bin?: string;
}

const DEFAULT_BIN = "codewatch";

export async function installHook(
  projectDir: string,
  options: InstallHookOptions = {},
): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");
  const stripped = await readWithoutBlock(hookPath);
  const base = stripped ?? "#!/bin/sh\n";
  const block = renderBlock(options);
  await fs.writeFile(hookPath, base.trimEnd() + "\n" + block);
  await fs.chmod(hookPath, 0o755);
}

export async function removeHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");
  const stripped = await readWithoutBlock(hookPath);
  if (stripped === null) return;
  await fs.writeFile(hookPath, stripped);
}

async function readWithoutBlock(
  hookPath: string,
  begin = MARKER_BEGIN,
  end = MARKER_END,
): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf-8");
  } catch {
    return null;
  }
  return stripBlock(content, begin, end);
}

export function stripBlock(
  content: string,
  begin = MARKER_BEGIN,
  end = MARKER_END,
): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inside && trimmed === begin) {
      inside = true;
      continue;
    }
    if (inside && trimmed === end) {
      inside = false;
      continue;
    }
    if (inside) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

const DEFAULT_DB_PATH = ".codewatch/graph.db";
const DEFAULT_CONFIG_PATH = ".codewatch/check.json";

function normalizeGraphPaths(value: string | string[] | undefined): string {
  if (value === undefined) return ".";
  if (typeof value === "string") return value;
  if (value.length === 0) return ".";
  return value.join(" ");
}

function renderBlock(options: InstallHookOptions): string {
  const bin = options.bin ?? DEFAULT_BIN;
  const styleCheck = options.withStyleCheck !== false;
  const graphCheck = options.withGraphCheck === true;
  if (!styleCheck && !graphCheck) {
    throw new Error(
      "hook install would write an empty hook (both style and graph check are disabled)",
    );
  }
  const lines = [MARKER_BEGIN];
  if (styleCheck) {
    lines.push(`${bin} diff --fix || exit 1`);
  }
  if (graphCheck) {
    const targets = normalizeGraphPaths(options.graphPath);
    const db = options.dbPath ?? DEFAULT_DB_PATH;
    lines.push(
      `if git diff --cached --name-only | grep -qE '${TS_GLOB}'; then`,
      `  ${bin} graph index ${targets} --db ${db} >/dev/null || exit 1`,
      `  ${bin} graph check --db ${db} --baseline previous || exit 1`,
      "fi",
    );
  }
  lines.push(MARKER_END, "");
  return lines.join("\n");
}

export interface InstallAutoUpdateHookOptions {
  graphPath?: string | string[];
  dbPath?: string;
  configPath?: string;
  bin?: string;
}

/**
 * Install a post-commit hook that runs `graph auto-update`, keeping the snapshot
 * fresh after each commit. The block is harmless until `autoUpdate: true` is set
 * in the check.json config — `graph auto-update` self-gates on it — so the hook
 * can be installed eagerly and toggled purely through config.
 */
export async function installAutoUpdateHook(
  projectDir: string,
  options: InstallAutoUpdateHookOptions = {},
): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "post-commit");
  const stripped = await readWithoutBlock(
    hookPath,
    POST_MARKER_BEGIN,
    POST_MARKER_END,
  );
  const base = stripped ?? "#!/bin/sh\n";
  const block = renderAutoUpdateBlock(options);
  await fs.writeFile(hookPath, base.trimEnd() + "\n" + block);
  await fs.chmod(hookPath, 0o755);
}

export async function removeAutoUpdateHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "post-commit");
  const stripped = await readWithoutBlock(
    hookPath,
    POST_MARKER_BEGIN,
    POST_MARKER_END,
  );
  if (stripped === null) return;
  await fs.writeFile(hookPath, stripped);
}

function renderAutoUpdateBlock(options: InstallAutoUpdateHookOptions): string {
  const bin = options.bin ?? DEFAULT_BIN;
  const targets = normalizeGraphPaths(options.graphPath);
  const db = options.dbPath ?? DEFAULT_DB_PATH;
  const config = options.configPath ?? DEFAULT_CONFIG_PATH;
  // `|| true` so a failed re-index never disrupts a workflow — the commit has
  // already landed by the time post-commit runs.
  return [
    POST_MARKER_BEGIN,
    `${bin} graph auto-update ${targets} --db ${db} --config ${config} >/dev/null 2>&1 || true`,
    POST_MARKER_END,
    "",
  ].join("\n");
}
