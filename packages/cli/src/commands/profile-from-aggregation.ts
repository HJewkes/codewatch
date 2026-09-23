import type {
  AggregatedFeature,
  AggregatorResult,
} from "@titan-design/style-analyzer";
import {
  DEFAULT_SEVERITY_THRESHOLDS,
  SCHEMA_VERSION,
  type Profile,
  type StyleRule,
} from "@titan-design/style-profile";

type RuleSection =
  | "naming"
  | "structure"
  | "documentation"
  | "errorHandling"
  | "formatting"
  | "patterns";

// reviewVoice describes review-comment tone, not a code convention, so it has no section.
const SECTION_BY_CATEGORY: Record<string, RuleSection> = {
  naming: "naming",
  structure: "structure",
  documentation: "documentation",
  "error-handling": "errorHandling",
  formatting: "formatting",
  "control-flow": "patterns",
  complexity: "patterns",
  idioms: "patterns",
};

const MAX_EXAMPLES = 3;

export interface ProfileMeta {
  author: string;
  sources: string[];
  generated?: string;
}

export function profileFromAggregation(
  result: AggregatorResult,
  meta: ProfileMeta,
): Profile {
  const profile = emptyProfile(meta);
  for (const feature of result.features.values()) {
    const section = SECTION_BY_CATEGORY[feature.category];
    if (!section) continue;
    profile[section][ruleName(feature)] = toStyleRule(feature);
  }
  return profile;
}

function emptyProfile(meta: ProfileMeta): Profile {
  return {
    schemaVersion: SCHEMA_VERSION,
    author: meta.author,
    generated: meta.generated ?? new Date().toISOString().split("T")[0],
    sources: [...meta.sources],
    naming: {},
    structure: {},
    documentation: {},
    errorHandling: {},
    formatting: {},
    patterns: {},
    idioms: { detected: [] },
    antiPatterns: { acknowledged: [] },
    overrides: [],
    severityThresholds: { ...DEFAULT_SEVERITY_THRESHOLDS },
  };
}

function ruleName(feature: AggregatedFeature): string {
  const dot = feature.type.indexOf(".");
  return dot === -1 ? feature.type : feature.type.slice(dot + 1);
}

function toStyleRule(feature: AggregatedFeature): StyleRule {
  const examples = feature.examples.slice(0, MAX_EXAMPLES).map((obs) => ({
    good: String(obs.value),
    source: `${obs.file}:${obs.line}`,
  }));
  return {
    convention: feature.convention,
    confidence: feature.confidence,
    stability: feature.stability,
    ...(examples.length > 0 ? { examples } : {}),
  };
}
