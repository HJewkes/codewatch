import type { Profile } from "../schema/profile.js";

export interface RuleEntry {
  category: string;
  name: string;
  convention: unknown;
  confidence: number;
  stability?: string;
  description?: string;
  examples?: Array<{ good?: string; bad?: string; source?: string }>;
  extensions?: Record<string, unknown>;
}

export type ExtractedRule = RuleEntry;

export function extractAllRules(profile: Profile): RuleEntry[] {
  const rules: RuleEntry[] = [];
  const categories = [
    "naming",
    "structure",
    "documentation",
    "errorHandling",
    "formatting",
    "patterns",
  ] as const;

  for (const category of categories) {
    const section = profile[category];
    if (!section || typeof section !== "object") continue;

    for (const [name, rule] of Object.entries(section)) {
      if (!rule || typeof rule !== "object") continue;
      rules.push({
        category,
        name,
        convention: rule.convention,
        confidence: rule.confidence,
        stability: rule.stability,
        description: rule.description,
        examples: rule.examples,
        extensions: rule.extensions,
      });
    }
  }

  return rules;
}

export function getTopRules(
  profile: Profile,
  count: number = 8,
): RuleEntry[] {
  const errorThreshold = profile.severityThresholds?.error ?? 0.85;
  return extractAllRules(profile)
    .filter((r) => r.confidence >= errorThreshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, count);
}

export function getRulesForCategory(
  profile: Profile,
  category: string,
): RuleEntry[] {
  return extractAllRules(profile).filter((r) => r.category === category);
}

export function getRulesByCategory(
  profile: Profile,
): Map<string, RuleEntry[]> {
  const grouped = new Map<string, RuleEntry[]>();
  for (const rule of extractAllRules(profile)) {
    const existing = grouped.get(rule.category) ?? [];
    existing.push(rule);
    grouped.set(rule.category, existing);
  }
  return grouped;
}

export function detectLanguages(profile: Profile): string[] {
  const langs: string[] = [];
  const hasTypescriptSignals =
    Object.keys(profile.naming).length > 0 ||
    Object.keys(profile.structure).length > 0;
  if (hasTypescriptSignals) langs.push("typescript");
  return langs.length > 0 ? langs : ["typescript"];
}
