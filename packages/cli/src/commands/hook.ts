import * as fs from "node:fs/promises";
import * as path from "node:path";

const HOOK_LINE = "code-style diff --fix";
const HOOK_MARKER = "# code-style pre-commit hook";
const HOOK_BLOCK = `\n${HOOK_MARKER}\n${HOOK_LINE}\n`;

export async function installHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");

  let existing = "";
  try {
    existing = await fs.readFile(hookPath, "utf-8");
  } catch {
    existing = "#!/bin/sh\n";
  }

  if (existing.includes("code-style")) {
    return;
  }

  const content = existing.trimEnd() + HOOK_BLOCK;
  await fs.writeFile(hookPath, content);
  await fs.chmod(hookPath, 0o755);
}

export async function removeHook(projectDir: string): Promise<void> {
  const hookPath = path.join(projectDir, ".git", "hooks", "pre-commit");

  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n").filter(
    (line) => !line.includes("code-style") && line !== HOOK_MARKER.trim(),
  );

  await fs.writeFile(hookPath, lines.join("\n"));
}
