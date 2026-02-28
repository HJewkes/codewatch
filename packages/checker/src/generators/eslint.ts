import type { Profile, StyleRule, SeverityThresholds, Severity } from "@code-style/profile";

export interface EslintFlatConfigEntry {
  plugins?: Record<string, unknown>;
  rules?: Record<string, unknown>;
  files?: string[];
}

function toEslintSeverity(
  confidence: number,
  thresholds: SeverityThresholds,
): Severity | null {
  if (confidence >= thresholds.error) return "error";
  if (confidence >= thresholds.warn) return "warn";
  if (confidence >= thresholds.info) return "info";
  return null;
}

function severityRank(s: Severity): number {
  return s === "error" ? 3 : s === "warn" ? 2 : 1;
}

function buildNamingConventionRule(
  profile: Profile,
): [string, unknown] | null {
  const thresholds = profile.severityThresholds;
  const naming = profile.naming;
  if (!naming) return null;

  const selectors: unknown[] = [];
  let maxSeverity: Severity | null = null;

  const selectorMap: Record<string, string> = {
    variables: "variable",
    functions: "function",
    types: "typeLike",
    constants: "variable",
  };

  for (const [key, rule] of Object.entries(naming)) {
    if (key === "files") continue;
    const selectorName = selectorMap[key];
    if (!selectorName) continue;

    const severity = toEslintSeverity(rule.confidence, thresholds);
    if (!severity) continue;
    if (!maxSeverity || severityRank(severity) > severityRank(maxSeverity)) {
      maxSeverity = severity;
    }

    const extensions = rule.extensions as
      | { eslint?: { rule?: string; options?: unknown[] } }
      | undefined;

    if (extensions?.eslint?.options) {
      selectors.push(...extensions.eslint.options);
    } else if (typeof rule.convention === "string") {
      selectors.push({
        selector: selectorName,
        format: [rule.convention],
      });
    }
  }

  if (selectors.length === 0 || !maxSeverity) return null;
  return ["@typescript-eslint/naming-convention", [maxSeverity, ...selectors]];
}

function buildImportOrderRule(
  profile: Profile,
): [string, unknown] | null {
  const importOrder = profile.structure?.importOrder;
  if (!importOrder) return null;
  const severity = toEslintSeverity(importOrder.confidence, profile.severityThresholds);
  if (!severity) return null;

  const convention = Array.isArray(importOrder.convention)
    ? importOrder.convention
    : ["builtin", "external", "internal", "relative"];

  return [
    "perfectionist/sort-imports",
    [
      severity,
      {
        type: "natural",
        groups: convention,
      },
    ],
  ];
}

function buildFunctionLengthRule(
  profile: Profile,
): [string, unknown] | null {
  const maxLines = profile.structure?.functionMaxLines;
  if (!maxLines) return null;
  const severity = toEslintSeverity(maxLines.confidence, profile.severityThresholds);
  if (!severity) return null;
  if (typeof maxLines.convention !== "number") return null;

  return ["max-lines-per-function", [severity, { max: maxLines.convention }]];
}

function buildFileNamingRule(
  profile: Profile,
): [string, unknown] | null {
  const files = profile.naming?.files;
  if (!files) return null;
  const severity = toEslintSeverity(files.confidence, profile.severityThresholds);
  if (!severity) return null;
  if (typeof files.convention !== "string") return null;

  const caseMap: Record<string, string> = {
    "kebab-case": "kebabCase",
    camelCase: "camelCase",
    PascalCase: "pascalCase",
    snake_case: "snakeCase",
  };

  return [
    "unicorn/filename-case",
    [severity, { case: { [caseMap[files.convention] ?? "kebabCase"]: true } }],
  ];
}

function buildJsdocRules(
  profile: Profile,
): Array<[string, unknown]> {
  const rules: Array<[string, unknown]> = [];
  const docs = profile.documentation;
  if (!docs) return rules;

  const functionDocs = docs.functionDocs;
  if (!functionDocs) return rules;

  const severity = toEslintSeverity(functionDocs.confidence, profile.severityThresholds);
  if (!severity) return rules;

  if (functionDocs.convention === "jsdoc-selective") {
    rules.push(["jsdoc/require-jsdoc", [severity, { publicOnly: true }]]);
  } else if (functionDocs.convention === "jsdoc-all") {
    rules.push(["jsdoc/require-jsdoc", [severity]]);
  }

  return rules;
}

export function generateEslintConfig(profile: Profile): EslintFlatConfigEntry[] {
  const entries: EslintFlatConfigEntry[] = [];
  const rules: Record<string, unknown> = {};

  const namingRule = buildNamingConventionRule(profile);
  if (namingRule) rules[namingRule[0]] = namingRule[1];

  const importRule = buildImportOrderRule(profile);
  if (importRule) rules[importRule[0]] = importRule[1];

  const fnLengthRule = buildFunctionLengthRule(profile);
  if (fnLengthRule) rules[fnLengthRule[0]] = fnLengthRule[1];

  const fileNamingRule = buildFileNamingRule(profile);
  if (fileNamingRule) rules[fileNamingRule[0]] = fileNamingRule[1];

  const jsdocRules = buildJsdocRules(profile);
  for (const [name, value] of jsdocRules) {
    rules[name] = value;
  }

  if (Object.keys(rules).length > 0) {
    entries.push({
      files: ["**/*.ts", "**/*.tsx"],
      rules,
    });
  }

  return entries;
}
