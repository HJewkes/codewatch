import chalk from "chalk";

export function formatSuccess(message: string): string {
  return chalk.green(`✔ ${message}`);
}

export function formatError(message: string): string {
  return chalk.red(`✖ ${message}`);
}

export function formatWarning(message: string): string {
  return chalk.yellow(`⚠ ${message}`);
}

export function formatStep(
  current: number,
  total: number,
  description: string,
): string {
  return chalk.cyan(`[${current}/${total}]`) + ` ${description}`;
}

export function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 85) return chalk.green(`${pct}%`);
  if (pct >= 60) return chalk.yellow(`${pct}%`);
  if (pct >= 40) return chalk.blue(`${pct}%`);
  return chalk.dim(`${pct}%`);
}

export function formatSeverity(severity: "error" | "warn" | "info"): string {
  switch (severity) {
    case "error":
      return chalk.red("error");
    case "warn":
      return chalk.yellow("warn");
    case "info":
      return chalk.blue("info");
  }
}

export function formatHeader(text: string): string {
  return chalk.bold.underline(text);
}

export function formatDim(text: string): string {
  return chalk.dim(text);
}

/**
 * Returns a warning string when two snapshots were produced by different
 * indexer versions, since cross-version comparisons can be misleading (node
 * IDs, metric definitions, or scoring may have shifted). Returns null when
 * the versions match. Callers route the result to console.warn / stderr.
 */
export function snapshotVersionMismatchWarning(
  currentVersion: string,
  baselineVersion: string,
  context: string,
): string | null {
  if (currentVersion === baselineVersion) return null;
  return formatWarning(
    `${context}: indexer version mismatch ` +
      `(current ${currentVersion} vs baseline ${baselineVersion}). ` +
      "Node IDs or metric definitions may have changed between versions — " +
      "re-index the baseline if the comparison looks off.",
  );
}
