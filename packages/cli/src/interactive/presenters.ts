import chalk from "chalk";
import type { StyleRule } from "@codewatch/profile";

export function presentRule(
  category: string,
  ruleName: string,
  rule: StyleRule,
): string {
  const lines: string[] = [];
  const pct = Math.round(rule.confidence * 100);
  const confidenceColor =
    pct >= 85 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.blue;

  lines.push("");
  lines.push(
    chalk.bold.cyan(`[${category}]`) +
      " " +
      chalk.bold(ruleName) +
      "  " +
      confidenceColor(`${pct}%`) +
      (rule.stability ? chalk.dim(` (${rule.stability} stability)`) : ""),
  );

  const conventionStr =
    typeof rule.convention === "object"
      ? JSON.stringify(rule.convention)
      : String(rule.convention);
  lines.push(`  Convention: ${chalk.white.bold(conventionStr)}`);

  if (rule.fixability) {
    lines.push(`  Fixability: ${chalk.dim(rule.fixability)}`);
  }

  if (rule.description) {
    lines.push(`  ${chalk.italic(rule.description)}`);
  }

  if (rule.examples && rule.examples.length > 0) {
    lines.push("  Examples:");
    for (const ex of rule.examples) {
      if (ex.good) {
        lines.push(chalk.green(`    + ${ex.good}`));
        if (ex.source) {
          lines.push(chalk.dim(`      from ${ex.source}`));
        }
      }
      if (ex.bad) {
        lines.push(chalk.red(`    - ${ex.bad}`));
      }
    }
  }

  return lines.join("\n");
}

export function presentCategoryHeader(
  category: string,
  ruleCount: number,
): string {
  return (
    "\n" +
    chalk.bold.underline(`Category: ${category}`) +
    chalk.dim(` (${ruleCount} rule${ruleCount !== 1 ? "s" : ""})`) +
    "\n"
  );
}

export function presentAutoConfirm(
  category: string,
  ruleName: string,
  confidence: number,
): string {
  const pct = Math.round(confidence * 100);
  return chalk.dim(
    `  Auto-confirmed ${category}.${ruleName} (${pct}% confidence)`,
  );
}
