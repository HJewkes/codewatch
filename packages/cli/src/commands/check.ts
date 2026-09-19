import chalk from "chalk";
import type {
  OrchestratorResult,
  CheckDiagnostic,
  ToolFailure,
  SkippedRule,
} from "@titan-design/style-checker";

export type OutputFormat = "text" | "json" | "reviewdog";

export function resolveFilePaths(paths: string[]): string[] {
  return paths.length > 0 ? paths : ["."];
}

export function determineExitCode(result: OrchestratorResult): number {
  return result.summary.errors > 0 || result.failures.length > 0 ? 1 : 0;
}

function formatDiagnosticText(d: CheckDiagnostic): string {
  const severityStr =
    d.severity === "error"
      ? chalk.red("error")
      : d.severity === "warn"
        ? chalk.yellow("warn")
        : chalk.blue("info");
  const fixableTag = d.fixable ? chalk.dim(" [fixable]") : "";
  return `${chalk.dim(`${d.file}:${d.line}:${d.column}`)} ${severityStr} ${d.message} ${chalk.dim(`[${d.category}.${d.rule}]`)}${fixableTag}`;
}

function formatDiagnosticReviewdog(d: CheckDiagnostic): string {
  const severity =
    d.severity === "error" ? "e" : d.severity === "warn" ? "w" : "i";
  return `${d.file}:${d.line}:${d.column}: ${severity}: ${d.message} [${d.category}.${d.rule}]`;
}

function formatFailure(f: ToolFailure): string {
  const location = f.file ? `${chalk.dim(f.file)} ` : "";
  return `${chalk.red("failed")} ${location}${f.message} ${chalk.dim(`[${f.tool}.${f.kind}]`)}`;
}

function formatSkippedRule(s: SkippedRule): string {
  return `${chalk.yellow("skipped")} ${s.rule}: ${s.reason} ${chalk.dim(`[${s.tool}]`)}`;
}

export function formatToolProblems(result: OrchestratorResult): string[] {
  return [
    ...result.failures.map(formatFailure),
    ...result.skippedRules.map(formatSkippedRule),
  ];
}

function formatSummary(summary: OrchestratorResult["summary"]): string {
  const parts: string[] = [];
  if (summary.errors > 0) {
    parts.push(
      chalk.red(`${summary.errors} error${summary.errors !== 1 ? "s" : ""}`),
    );
  }
  if (summary.warnings > 0) {
    parts.push(
      chalk.yellow(
        `${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""}`,
      ),
    );
  }
  if (summary.infos > 0) {
    parts.push(chalk.blue(`${summary.infos} info`));
  }
  if (summary.fixed > 0) {
    parts.push(chalk.green(`${summary.fixed} fixed`));
  }
  return `\n${parts.join(", ")} (${summary.total} total)`;
}

export function formatCheckOutput(
  result: OrchestratorResult,
  format: OutputFormat,
): string {
  if (format === "json") {
    const { diagnostics, failures, skippedRules, summary } = result;
    return JSON.stringify({ diagnostics, failures, skippedRules, summary }, null, 2);
  }

  if (format === "reviewdog") {
    return result.diagnostics.map(formatDiagnosticReviewdog).join("\n");
  }

  const lines = [
    ...result.diagnostics.map(formatDiagnosticText),
    ...formatToolProblems(result),
  ];
  if (result.diagnostics.length > 0) {
    lines.push(formatSummary(result.summary));
  } else if (result.failures.length === 0) {
    lines.push(chalk.green("No violations found."));
  }
  return lines.join("\n");
}

export interface CheckCommandOptions {
  fix?: boolean;
  format?: OutputFormat;
  profile?: string;
  language?: "typescript" | "python";
}

export async function runCheck(
  paths: string[],
  options: CheckCommandOptions,
): Promise<{ output: string; exitCode: number; stderr: string }> {
  const { readProfile } = await import("@titan-design/style-profile");
  const { orchestrate } = await import("@titan-design/style-checker");
  const { getDefaultProfilePath } = await import("../utils/config.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const profile = await readProfile(profilePath);
  const filePaths = resolveFilePaths(paths);

  const result = await orchestrate({
    profile,
    files: filePaths,
    fix: options.fix,
    language: options.language,
  });

  const format = options.format ?? "text";
  const output = formatCheckOutput(result, format);
  const exitCode = determineExitCode(result);
  // reviewdog parses stdout, so tool problems go where CI logs still show them
  const stderr =
    format === "reviewdog" ? formatToolProblems(result).join("\n") : "";

  return { output, exitCode, stderr };
}
