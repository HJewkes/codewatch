import { execSync } from "node:child_process";
import * as path from "node:path";

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

// Source files codewatch recognises but has no grammar for; other unparsed files (docs, config) are not reported.
const NO_PARSER_EXTENSIONS = [".js", ".jsx"];

export interface ChangedFileSelection {
  parseable: { path: string; language: string }[];
  skippedNoParser: string[];
}

export function selectParseableFiles(
  files: readonly string[],
  languageOf: (filePath: string) => string | null,
): ChangedFileSelection {
  const selection: ChangedFileSelection = { parseable: [], skippedNoParser: [] };
  for (const filePath of files) {
    const language = languageOf(filePath);
    if (language) {
      selection.parseable.push({ path: filePath, language });
    } else if (NO_PARSER_EXTENSIONS.includes(path.extname(filePath))) {
      selection.skippedNoParser.push(filePath);
    }
  }
  return selection;
}

export function formatSkippedNoParser(skipped: readonly string[]): string {
  return `Skipped ${skipped.length} file(s) with no parser: ${skipped.join(", ")}`;
}
