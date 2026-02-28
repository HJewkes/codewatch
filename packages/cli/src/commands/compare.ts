import chalk from "chalk";
import type { Profile, StyleRule } from "@code-style/profile";

export interface ProfileDiff {
  type: "added" | "removed" | "changed";
  path: string;
  left: string;
  right: string;
}

const COMPARABLE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
] as const;

function ruleToString(rule: StyleRule): string {
  const convention =
    typeof rule.convention === "string"
      ? rule.convention
      : JSON.stringify(rule.convention);
  return `${convention} (${Math.round(rule.confidence * 100)}%)`;
}

export function compareProfiles(left: Profile, right: Profile): ProfileDiff[] {
  const diffs: ProfileDiff[] = [];

  for (const category of COMPARABLE_CATEGORIES) {
    const leftSection = (left[category] ?? {}) as Record<string, StyleRule>;
    const rightSection = (right[category] ?? {}) as Record<string, StyleRule>;

    const allKeys = new Set([
      ...Object.keys(leftSection),
      ...Object.keys(rightSection),
    ]);

    for (const key of allKeys) {
      const leftRule = leftSection[key];
      const rightRule = rightSection[key];
      const path = `${category}.${key}`;

      if (!leftRule && rightRule) {
        diffs.push({
          type: "added",
          path,
          left: "",
          right: ruleToString(rightRule),
        });
      } else if (leftRule && !rightRule) {
        diffs.push({
          type: "removed",
          path,
          left: ruleToString(leftRule),
          right: "",
        });
      } else if (leftRule && rightRule) {
        const leftStr = ruleToString(leftRule);
        const rightStr = ruleToString(rightRule);
        if (leftStr !== rightStr) {
          diffs.push({
            type: "changed",
            path,
            left: leftStr,
            right: rightStr,
          });
        }
      }
    }
  }

  return diffs;
}

export function formatComparison(diffs: ProfileDiff[]): string {
  if (diffs.length === 0) {
    return chalk.green("Profiles are identical. No differences found.");
  }

  const lines: string[] = [];
  lines.push(chalk.bold.underline("Profile Comparison"));
  lines.push("");

  for (const diff of diffs) {
    switch (diff.type) {
      case "added":
        lines.push(
          chalk.green(`  + ${diff.path}: ${diff.right}`),
        );
        break;
      case "removed":
        lines.push(
          chalk.red(`  - ${diff.path}: ${diff.left}`),
        );
        break;
      case "changed":
        lines.push(
          chalk.yellow(`  ~ ${diff.path}`),
        );
        lines.push(
          chalk.red(`    - ${diff.left}`),
        );
        lines.push(
          chalk.green(`    + ${diff.right}`),
        );
        break;
    }
  }

  const added = diffs.filter((d) => d.type === "added").length;
  const removed = diffs.filter((d) => d.type === "removed").length;
  const changed = diffs.filter((d) => d.type === "changed").length;
  lines.push("");
  lines.push(
    chalk.dim(
      `${added} added, ${removed} removed, ${changed} changed`,
    ),
  );

  return lines.join("\n");
}
