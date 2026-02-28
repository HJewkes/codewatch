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
