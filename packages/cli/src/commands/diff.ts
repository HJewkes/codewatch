import { execSync } from "node:child_process";

export function getStagedFiles(): string[] {
  try {
    const output = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      { encoding: "utf-8" },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch (error: unknown) {
    // Not a git repository — return empty
    if (error instanceof Error && "status" in error && (error as { status: number }).status === 128) {
      return [];
    }
    throw error;
  }
}

export function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only --diff-filter=ACM", {
      encoding: "utf-8",
    });
    const staged = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      { encoding: "utf-8" },
    );
    const all = new Set([
      ...output.trim().split("\n"),
      ...staged.trim().split("\n"),
    ]);
    all.delete("");
    return [...all];
  } catch (error: unknown) {
    if (error instanceof Error && "status" in error && (error as { status: number }).status === 128) {
      return [];
    }
    throw error;
  }
}
