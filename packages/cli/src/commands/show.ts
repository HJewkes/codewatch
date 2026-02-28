import chalk from "chalk";
import type { Profile } from "@code-style/profile";

const PROFILE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
] as const;

type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

function severityLabel(
  confidence: number,
  thresholds: Profile["severityThresholds"],
): string {
  if (confidence >= thresholds.error) return chalk.red("error");
  if (confidence >= thresholds.warn) return chalk.yellow("warn");
  if (confidence >= thresholds.info) return chalk.blue("info");
  return chalk.dim("skip");
}

function formatRule(
  name: string,
  rule: { convention?: unknown; confidence?: number; stability?: string },
  thresholds: Profile["severityThresholds"],
): string {
  const conf = rule.confidence ?? 0;
  const severity = severityLabel(conf, thresholds);
  const stability = rule.stability ? chalk.dim(`[${rule.stability}]`) : "";
  const value =
    typeof rule.convention === "object"
      ? JSON.stringify(rule.convention)
      : String(rule.convention);
  return `  ${severity} ${chalk.bold(name)}: ${value}  ${chalk.dim(`(${(conf * 100).toFixed(0)}%)`)} ${stability}`;
}

function validateCategory(
  category: string,
): asserts category is ProfileCategory {
  if (
    !PROFILE_CATEGORIES.includes(category as ProfileCategory)
  ) {
    throw new Error(
      `Unknown category: "${category}". Valid categories: ${PROFILE_CATEGORIES.join(", ")}`,
    );
  }
}

export function formatProfileText(
  profile: Profile,
  category?: string,
): string {
  if (category) {
    validateCategory(category);
  }

  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Style Profile: ${profile.author}`));
  lines.push(
    chalk.dim(
      `Generated: ${profile.generated}  Sources: ${profile.sources.join(", ")}`,
    ),
  );
  lines.push("");

  const thresholds = profile.severityThresholds;
  const categoriesToShow = category
    ? [category as ProfileCategory]
    : PROFILE_CATEGORIES;

  for (const cat of categoriesToShow) {
    const section = profile[cat];
    if (!section || typeof section !== "object") continue;

    const entries = Object.entries(
      section as Record<string, unknown>,
    );
    if (entries.length === 0) continue;

    lines.push(chalk.bold.cyan(`[${cat}]`));

    for (const [name, rule] of entries) {
      if (
        rule &&
        typeof rule === "object" &&
        "confidence" in (rule as Record<string, unknown>)
      ) {
        lines.push(
          formatRule(
            name,
            rule as {
              convention?: unknown;
              confidence?: number;
              stability?: string;
            },
            thresholds,
          ),
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatProfileJson(
  profile: Profile,
  category?: string,
): string {
  if (category) {
    validateCategory(category);
    const section = profile[category as ProfileCategory];
    return JSON.stringify(section, null, 2);
  }
  return JSON.stringify(profile, null, 2);
}
