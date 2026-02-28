import { execSync } from "node:child_process";
import type { Profile } from "@code-style/profile";
import type { Observation } from "@code-style/analyzer";

export interface Deviation {
  file: string;
  line: number;
  rule: string;
  expected: string;
  found: string;
  severity: "error" | "warn" | "info";
}

export interface DiffResult {
  deviations: Deviation[];
  summary: {
    total: number;
    matching: number;
    deviating: number;
  };
}

function getSeverity(
  confidence: number,
  thresholds: Profile["severityThresholds"],
): "error" | "warn" | "info" {
  if (confidence >= thresholds.error) return "error";
  if (confidence >= thresholds.warn) return "warn";
  return "info";
}

function resolveProfileRule(
  profile: Profile,
  observationType: string,
): { convention: unknown; confidence: number } | undefined {
  const [category, rule] = observationType.split(".");
  const section = profile[category as keyof Profile];
  if (!section || typeof section !== "object") return undefined;
  const ruleObj = (section as Record<string, unknown>)[rule];
  if (!ruleObj || typeof ruleObj !== "object") return undefined;
  const typed = ruleObj as { convention?: unknown; confidence?: number };
  if (typed.convention === undefined || typed.confidence === undefined) {
    return undefined;
  }
  return { convention: typed.convention, confidence: typed.confidence };
}

export function diffAgainstProfile(
  profile: Profile,
  observations: Observation[],
): DiffResult {
  const deviations: Deviation[] = [];
  let matching = 0;

  for (const obs of observations) {
    const profileRule = resolveProfileRule(profile, obs.type);
    if (!profileRule) continue;

    const expected = String(profileRule.convention);
    const found = String(obs.value);

    if (found === expected) {
      matching++;
    } else {
      deviations.push({
        file: obs.file,
        line: obs.line,
        rule: obs.type,
        expected,
        found,
        severity: getSeverity(
          profileRule.confidence,
          profile.severityThresholds,
        ),
      });
    }
  }

  return {
    deviations,
    summary: {
      total: observations.length,
      matching,
      deviating: deviations.length,
    },
  };
}

export function getStagedFiles(): string[] {
  try {
    const output = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      { encoding: "utf-8" },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
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
  } catch {
    return [];
  }
}
