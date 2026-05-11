import * as fs from "node:fs/promises";
import * as path from "node:path";

const MARKER_BEGIN = "# code-style pre-commit hook (begin)";
const MARKER_END = "# code-style pre-commit hook (end)";
const TS_GLOB = "\\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$";

export interface InstallHookOptions {
  withGraphCheck?: boolean;
  withStyleCheck?: boolean;
  graphPath?: string;
  bin?: string;
}

const DEFAULT_BIN = "code-style";

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

async function readWithoutBlock(hookPath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf-8");
  } catch {
    return null;
  }
  return stripBlock(content);
}

export function stripBlock(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inside && trimmed === MARKER_BEGIN) {
      inside = true;
      continue;
    }
    if (inside && trimmed === MARKER_END) {
      inside = false;
      continue;
    }
    if (inside) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n*$/, "\n");
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
    const target = options.graphPath ?? ".";
    lines.push(
      `if git diff --cached --name-only | grep -qE '${TS_GLOB}'; then`,
      `  ${bin} graph index ${target} >/dev/null || exit 1`,
      `  ${bin} graph check || exit 1`,
      "fi",
    );
  }
  lines.push(MARKER_END, "");
  return lines.join("\n");
}
