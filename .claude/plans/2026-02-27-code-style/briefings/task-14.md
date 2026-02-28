# Task 14: Checker Orchestration

## Architectural Context

The checker package is the enforcement layer. It takes a style profile and file paths, generates tool-specific configurations (ESLint flat config, ruff.toml), spawns the tools as child processes, parses their JSON output, and normalizes results into a unified format. The orchestrator is consumed by the `check` command (Task 17) and the `diff --fix` flag (Task 13). Config generators are also reused by the ESLint/Ruff exporters in Task 16.

## File Ownership

**May modify:**
- `/packages/checker/src/orchestrator/index.ts`
- `/packages/checker/src/orchestrator/types.ts`
- `/packages/checker/src/generators/eslint.ts`
- `/packages/checker/src/generators/ruff.ts`
- `/packages/checker/src/generators/index.ts`
- `/packages/checker/src/runners/tool-runner.ts`
- `/packages/checker/src/runners/eslint-runner.ts`
- `/packages/checker/src/runners/ruff-runner.ts`
- `/packages/checker/src/formatters/unified.ts`
- `/packages/checker/src/formatters/types.ts`
- `/packages/checker/src/index.ts`
- `/packages/checker/src/__tests__/eslint-generator.test.ts`
- `/packages/checker/src/__tests__/ruff-generator.test.ts`
- `/packages/checker/src/__tests__/unified-formatter.test.ts`
- `/packages/checker/src/__tests__/orchestrator.test.ts`
- `/packages/checker/package.json` (add dependencies)

**Must not touch:**
- `/packages/profile/src/schema/**`
- `/packages/cli/src/**`
- `/packages/analyzer/src/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/schema/profile.ts` (profile types -- rule shapes, extensions, fixability)
- `/docs/plans/2026-02-27-code-style-design.md` (enforcement layer, fixability model, output format)
- `/docs/research/08-tool-pipeline-matrix.md` (tool assignments for enforcement)

## Steps

### Step 1: Define shared types

Create `/packages/checker/src/orchestrator/types.ts`:

```ts
import type { StyleProfile } from "@code-style/profile";

export type Severity = "error" | "warn" | "info";

export interface CheckDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  category: string;
  rule: string;
  fixable: boolean;
  fix?: {
    range: [number, number];
    text: string;
  };
}

export interface CheckResult {
  diagnostics: CheckDiagnostic[];
  tool: "eslint" | "ruff";
  exitCode: number;
}

export interface OrchestratorOptions {
  profile: StyleProfile;
  files: string[];
  fix?: boolean;
  language?: "typescript" | "python";
}

export interface OrchestratorResult {
  diagnostics: CheckDiagnostic[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    fixed: number;
  };
}
```

### Step 2: Write failing tests for ESLint config generator

Create `/packages/checker/src/__tests__/eslint-generator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateEslintConfig } from "../generators/eslint.js";
import type { StyleProfile } from "@code-style/profile";

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {
    variables: {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      fixability: "maybe-incorrect",
      extensions: {
        eslint: {
          rule: "@typescript-eslint/naming-convention",
          options: [{ selector: "variable", format: ["camelCase"] }],
        },
      },
    },
    types: {
      convention: "PascalCase",
      confidence: 0.99,
      stability: "high",
      extensions: {
        eslint: {
          rule: "@typescript-eslint/naming-convention",
          options: [{ selector: "typeLike", format: ["PascalCase"] }],
        },
      },
    },
    files: {
      convention: "kebab-case",
      confidence: 0.88,
      stability: "high",
    },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
      fixability: "safe",
    },
    functionMaxLines: {
      convention: 28,
      confidence: 0.78,
    },
  },
  documentation: {
    functionDocs: {
      convention: "jsdoc-selective",
      confidence: 0.80,
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("generateEslintConfig", () => {
  it("generates a flat config object", () => {
    const config = generateEslintConfig(sampleProfile);
    expect(config).toBeDefined();
    expect(Array.isArray(config)).toBe(true);
  });

  it("maps naming conventions to @typescript-eslint/naming-convention", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) => c.rules?.["@typescript-eslint/naming-convention"]);
    expect(rulesConfig).toBeDefined();
    const rule = rulesConfig!.rules!["@typescript-eslint/naming-convention"];
    expect(rule).toBeDefined();
  });

  it("sets severity based on confidence thresholds", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) => c.rules?.["@typescript-eslint/naming-convention"]);
    const rule = rulesConfig!.rules!["@typescript-eslint/naming-convention"];
    // 0.94/0.99 confidence with 0.85 error threshold = "error"
    expect(rule[0]).toBe("error");
  });

  it("maps import ordering to perfectionist plugin", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) => c.rules?.["perfectionist/sort-imports"]);
    expect(rulesConfig).toBeDefined();
  });

  it("maps function max lines to max-lines-per-function", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) => c.rules?.["max-lines-per-function"]);
    expect(rulesConfig).toBeDefined();
    const rule = rulesConfig!.rules!["max-lines-per-function"];
    expect(rule).toContainEqual(expect.objectContaining({ max: 28 }));
  });

  it("maps file naming to unicorn/filename-case", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) => c.rules?.["unicorn/filename-case"]);
    expect(rulesConfig).toBeDefined();
  });

  it("maps documentation rules to eslint-plugin-jsdoc", () => {
    const config = generateEslintConfig(sampleProfile);
    const rulesConfig = config.find((c) =>
      Object.keys(c.rules ?? {}).some((r) => r.startsWith("jsdoc/")),
    );
    expect(rulesConfig).toBeDefined();
  });

  it("omits rules below info threshold", () => {
    const lowConfProfile = {
      ...sampleProfile,
      naming: {
        variables: {
          convention: "camelCase",
          confidence: 0.30, // below info threshold of 0.40
          stability: "low" as const,
        },
      },
    };
    const config = generateEslintConfig(lowConfProfile);
    const rulesConfig = config.find((c) => c.rules?.["@typescript-eslint/naming-convention"]);
    // Should not generate a rule for sub-threshold confidence
    expect(rulesConfig).toBeUndefined();
  });
});
```

Run: `pnpm --filter @code-style/checker test` -- expect failures.

### Step 3: Implement ESLint config generator

Create `/packages/checker/src/generators/eslint.ts`:

```ts
import type { StyleProfile } from "@code-style/profile";
import type { Severity } from "../orchestrator/types.js";

interface EslintFlatConfigEntry {
  plugins?: Record<string, unknown>;
  rules?: Record<string, unknown>;
  files?: string[];
}

function toEslintSeverity(
  confidence: number,
  thresholds: StyleProfile["severityThresholds"],
): Severity | null {
  if (confidence >= thresholds.error) return "error";
  if (confidence >= thresholds.warn) return "warn";
  if (confidence >= thresholds.info) return "info";
  return null;
}

function buildNamingConventionRule(
  profile: StyleProfile,
): [string, unknown] | null {
  const thresholds = profile.severityThresholds;
  const naming = profile.naming;
  if (!naming) return null;

  const selectors: unknown[] = [];
  let maxSeverity: Severity | null = null;

  const conventionMap: Record<string, { selector: string; format: string[] }> = {
    variables: { selector: "variable", format: [] },
    functions: { selector: "function", format: [] },
    types: { selector: "typeLike", format: [] },
    constants: { selector: "variable", format: [] },
  };

  for (const [key, mapping] of Object.entries(conventionMap)) {
    const rule = naming[key as keyof typeof naming];
    if (!rule || typeof rule !== "object" || !("confidence" in rule)) continue;
    const typed = rule as { convention?: string; confidence: number; extensions?: { eslint?: { options?: unknown[] } } };
    const severity = toEslintSeverity(typed.confidence, thresholds);
    if (!severity) continue;
    if (!maxSeverity || severityRank(severity) > severityRank(maxSeverity)) {
      maxSeverity = severity;
    }

    if (typed.extensions?.eslint?.options) {
      selectors.push(...typed.extensions.eslint.options);
    } else if (typed.convention) {
      selectors.push({
        selector: mapping.selector,
        format: [typed.convention],
      });
    }
  }

  if (selectors.length === 0 || !maxSeverity) return null;
  return ["@typescript-eslint/naming-convention", [maxSeverity, ...selectors]];
}

function severityRank(s: Severity): number {
  return s === "error" ? 3 : s === "warn" ? 2 : 1;
}

function buildImportOrderRule(
  profile: StyleProfile,
): [string, unknown] | null {
  const importOrder = profile.structure?.importOrder;
  if (!importOrder || typeof importOrder !== "object") return null;
  const typed = importOrder as { convention?: string[]; confidence?: number };
  if (!typed.confidence) return null;
  const severity = toEslintSeverity(typed.confidence, profile.severityThresholds);
  if (!severity) return null;

  return [
    "perfectionist/sort-imports",
    [
      severity,
      {
        type: "natural",
        groups: typed.convention ?? ["builtin", "external", "internal", "relative"],
      },
    ],
  ];
}

function buildFunctionLengthRule(
  profile: StyleProfile,
): [string, unknown] | null {
  const maxLines = profile.structure?.functionMaxLines;
  if (!maxLines || typeof maxLines !== "object") return null;
  const typed = maxLines as { convention?: number; confidence?: number };
  if (!typed.confidence || !typed.convention) return null;
  const severity = toEslintSeverity(typed.confidence, profile.severityThresholds);
  if (!severity) return null;

  return ["max-lines-per-function", [severity, { max: typed.convention }]];
}

function buildFileNamingRule(
  profile: StyleProfile,
): [string, unknown] | null {
  const files = profile.naming?.files;
  if (!files || typeof files !== "object") return null;
  const typed = files as { convention?: string; confidence?: number };
  if (!typed.confidence || !typed.convention) return null;
  const severity = toEslintSeverity(typed.confidence, profile.severityThresholds);
  if (!severity) return null;

  const caseMap: Record<string, string> = {
    "kebab-case": "kebabCase",
    camelCase: "camelCase",
    PascalCase: "pascalCase",
    snake_case: "snakeCase",
  };

  return [
    "unicorn/filename-case",
    [severity, { case: { [caseMap[typed.convention] ?? "kebabCase"]: true } }],
  ];
}

function buildJsdocRules(
  profile: StyleProfile,
): Array<[string, unknown]> {
  const rules: Array<[string, unknown]> = [];
  const docs = profile.documentation;
  if (!docs) return rules;

  const functionDocs = docs.functionDocs;
  if (functionDocs && typeof functionDocs === "object") {
    const typed = functionDocs as { convention?: string; confidence?: number };
    if (typed.confidence) {
      const severity = toEslintSeverity(typed.confidence, profile.severityThresholds);
      if (severity) {
        if (typed.convention === "jsdoc-selective") {
          rules.push(["jsdoc/require-jsdoc", [severity, { publicOnly: true }]]);
        } else if (typed.convention === "jsdoc-all") {
          rules.push(["jsdoc/require-jsdoc", [severity]]);
        }
      }
    }
  }

  return rules;
}

export function generateEslintConfig(profile: StyleProfile): EslintFlatConfigEntry[] {
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
```

Run: `pnpm --filter @code-style/checker test` -- eslint generator tests should pass.

### Step 4: Write failing tests for Ruff config generator

Create `/packages/checker/src/__tests__/ruff-generator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateRuffConfig } from "../generators/ruff.js";
import type { StyleProfile } from "@code-style/profile";

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {
    variables: {
      convention: "snake_case",
      confidence: 0.92,
      stability: "high",
      extensions: { ruff: { codes: ["N806"] } },
    },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
      fixability: "safe",
    },
    functionMaxLines: {
      convention: 30,
      confidence: 0.78,
    },
  },
  documentation: {
    functionDocs: {
      convention: "google",
      confidence: 0.85,
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("generateRuffConfig", () => {
  it("returns a ruff config object", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });

  it("includes N rules for naming conventions", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.select).toContain("N");
  });

  it("includes I rules for import ordering", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.select).toContain("I");
  });

  it("includes D rules for docstring conventions", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.select).toContain("D");
  });

  it("includes C90 for complexity when functionMaxLines is set", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.select).toContain("C90");
  });

  it("sets max-complexity from functionMaxLines convention", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.["mccabe"]?.["max-complexity"]).toBeDefined();
  });

  it("sets docstring convention", () => {
    const config = generateRuffConfig(sampleProfile);
    expect(config.lint?.pydocstyle?.convention).toBe("google");
  });

  it("serializes to valid TOML structure", () => {
    const config = generateRuffConfig(sampleProfile);
    // Verify nested structure matches ruff.toml expectations
    expect(config.lint).toBeDefined();
    expect(Array.isArray(config.lint?.select)).toBe(true);
  });
});
```

### Step 5: Implement Ruff config generator

Create `/packages/checker/src/generators/ruff.ts`:

```ts
import type { StyleProfile } from "@code-style/profile";

export interface RuffConfig {
  lint?: {
    select?: string[];
    ignore?: string[];
    fixable?: string[];
    "per-file-ignores"?: Record<string, string[]>;
    mccabe?: { "max-complexity"?: number };
    pydocstyle?: { convention?: string };
    isort?: {
      "known-first-party"?: string[];
      "section-order"?: string[];
    };
  };
  "line-length"?: number;
}

export function generateRuffConfig(profile: StyleProfile): RuffConfig {
  const select: string[] = [];
  const config: RuffConfig = { lint: { select } };

  // Naming conventions -> N rules
  if (profile.naming) {
    const hasNamingRules = Object.values(profile.naming).some((rule) => {
      if (!rule || typeof rule !== "object" || !("confidence" in rule)) return false;
      return (rule as { confidence: number }).confidence >= profile.severityThresholds.info;
    });
    if (hasNamingRules) select.push("N");
  }

  // Import ordering -> I rules
  const importOrder = profile.structure?.importOrder;
  if (importOrder && typeof importOrder === "object") {
    const typed = importOrder as { confidence?: number; convention?: string[] };
    if (typed.confidence && typed.confidence >= profile.severityThresholds.info) {
      select.push("I");
      if (typed.convention) {
        config.lint!.isort = {
          "section-order": typed.convention,
        };
      }
    }
  }

  // Documentation -> D rules
  const functionDocs = profile.documentation?.functionDocs;
  if (functionDocs && typeof functionDocs === "object") {
    const typed = functionDocs as { confidence?: number; convention?: string };
    if (typed.confidence && typed.confidence >= profile.severityThresholds.info) {
      select.push("D");
      if (typed.convention && typed.convention !== "jsdoc-selective" && typed.convention !== "jsdoc-all") {
        config.lint!.pydocstyle = { convention: typed.convention };
      }
    }
  }

  // Complexity -> C90 rules
  const maxLines = profile.structure?.functionMaxLines;
  if (maxLines && typeof maxLines === "object") {
    const typed = maxLines as { confidence?: number; convention?: number };
    if (typed.confidence && typed.confidence >= profile.severityThresholds.info && typed.convention) {
      select.push("C90");
      config.lint!.mccabe = { "max-complexity": typed.convention };
    }
  }

  // Formatting line length
  const lineLength = profile.formatting?.lineLength;
  if (lineLength && typeof lineLength === "object") {
    const typed = lineLength as { convention?: number };
    if (typed.convention) {
      config["line-length"] = typed.convention;
    }
  }

  return config;
}
```

Run: `pnpm --filter @code-style/checker test` -- ruff generator tests should pass.

### Step 6: Write failing tests for unified output formatter

Create `/packages/checker/src/__tests__/unified-formatter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseEslintJsonOutput,
  parseRuffJsonOutput,
  formatDiagnostic,
} from "../formatters/unified.js";
import type { CheckDiagnostic } from "../orchestrator/types.js";

describe("parseEslintJsonOutput", () => {
  it("normalizes ESLint JSON output to CheckDiagnostic[]", () => {
    const eslintOutput = [
      {
        filePath: "/src/app.ts",
        messages: [
          {
            ruleId: "@typescript-eslint/naming-convention",
            severity: 2,
            message: "Variable name 'my_var' must match camelCase format.",
            line: 10,
            column: 7,
            fix: null,
          },
          {
            ruleId: "max-lines-per-function",
            severity: 1,
            message: "Function has too many lines (45). Maximum allowed is 28.",
            line: 20,
            column: 1,
            fix: null,
          },
        ],
      },
    ];

    const diagnostics = parseEslintJsonOutput(JSON.stringify(eslintOutput));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].file).toBe("/src/app.ts");
    expect(diagnostics[0].line).toBe(10);
    expect(diagnostics[0].column).toBe(7);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].rule).toBe("@typescript-eslint/naming-convention");
    expect(diagnostics[0].category).toBe("naming");
    expect(diagnostics[1].severity).toBe("warn");
  });
});

describe("parseRuffJsonOutput", () => {
  it("normalizes Ruff JSON output to CheckDiagnostic[]", () => {
    const ruffOutput = [
      {
        code: "N806",
        message: "Variable in function should be lowercase",
        filename: "/src/app.py",
        location: { row: 5, column: 4 },
        end_location: { row: 5, column: 12 },
        fix: null,
      },
    ];

    const diagnostics = parseRuffJsonOutput(JSON.stringify(ruffOutput));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toBe("/src/app.py");
    expect(diagnostics[0].line).toBe(5);
    expect(diagnostics[0].column).toBe(4);
    expect(diagnostics[0].rule).toBe("N806");
    expect(diagnostics[0].category).toBe("naming");
  });
});

describe("formatDiagnostic", () => {
  it("formats as {file}:{line}:{col} {severity} {message} [{category}.{rule}]", () => {
    const d: CheckDiagnostic = {
      file: "src/app.ts",
      line: 10,
      column: 7,
      severity: "error",
      message: "Variable must be camelCase",
      category: "naming",
      rule: "naming-convention",
      fixable: false,
    };
    const output = formatDiagnostic(d);
    expect(output).toBe(
      "src/app.ts:10:7 error Variable must be camelCase [naming.naming-convention]",
    );
  });
});
```

### Step 7: Implement unified output formatter

Create `/packages/checker/src/formatters/unified.ts`:

```ts
import type { CheckDiagnostic, Severity } from "../orchestrator/types.js";

const RUFF_CODE_CATEGORY: Record<string, string> = {
  N: "naming",
  I: "imports",
  D: "documentation",
  C: "complexity",
  E: "formatting",
  W: "formatting",
  F: "errors",
};

const ESLINT_RULE_CATEGORY: Record<string, string> = {
  "@typescript-eslint/naming-convention": "naming",
  "unicorn/filename-case": "naming",
  "perfectionist/sort-imports": "imports",
  "import/order": "imports",
  "max-lines-per-function": "structure",
  "max-depth": "structure",
  "jsdoc/require-jsdoc": "documentation",
};

function eslintSeverityToSeverity(eslintSeverity: number): Severity {
  return eslintSeverity === 2 ? "error" : "warn";
}

function categorizeEslintRule(ruleId: string): string {
  if (ESLINT_RULE_CATEGORY[ruleId]) return ESLINT_RULE_CATEGORY[ruleId];
  if (ruleId.startsWith("@typescript-eslint/")) return "typescript";
  if (ruleId.startsWith("jsdoc/")) return "documentation";
  if (ruleId.startsWith("unicorn/")) return "style";
  if (ruleId.startsWith("import/")) return "imports";
  return "other";
}

function categorizeRuffCode(code: string): string {
  const prefix = code.replace(/[0-9]/g, "");
  return RUFF_CODE_CATEGORY[prefix] ?? "other";
}

interface EslintJsonEntry {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
    fix?: { range: [number, number]; text: string } | null;
  }>;
}

interface RuffJsonEntry {
  code: string;
  message: string;
  filename: string;
  location: { row: number; column: number };
  end_location: { row: number; column: number };
  fix?: { edits: Array<{ content: string; location: { row: number; column: number }; end_location: { row: number; column: number } }> } | null;
}

export function parseEslintJsonOutput(jsonStr: string): CheckDiagnostic[] {
  const entries: EslintJsonEntry[] = JSON.parse(jsonStr);
  const diagnostics: CheckDiagnostic[] = [];

  for (const entry of entries) {
    for (const msg of entry.messages) {
      if (!msg.ruleId) continue;
      diagnostics.push({
        file: entry.filePath,
        line: msg.line,
        column: msg.column,
        severity: eslintSeverityToSeverity(msg.severity),
        message: msg.message,
        category: categorizeEslintRule(msg.ruleId),
        rule: msg.ruleId,
        fixable: msg.fix != null,
        fix: msg.fix ?? undefined,
      });
    }
  }

  return diagnostics;
}

export function parseRuffJsonOutput(jsonStr: string): CheckDiagnostic[] {
  const entries: RuffJsonEntry[] = JSON.parse(jsonStr);
  return entries.map((entry) => ({
    file: entry.filename,
    line: entry.location.row,
    column: entry.location.column,
    severity: "warn" as Severity,
    message: entry.message,
    category: categorizeRuffCode(entry.code),
    rule: entry.code,
    fixable: entry.fix != null,
  }));
}

export function formatDiagnostic(d: CheckDiagnostic): string {
  return `${d.file}:${d.line}:${d.column} ${d.severity} ${d.message} [${d.category}.${d.rule}]`;
}
```

### Step 8: Implement tool runner

Create `/packages/checker/src/runners/tool-runner.ts`:

```ts
import { spawn } from "node:child_process";

export interface ToolRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runTool(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<ToolRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errChunks.push(chunk));

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(chunks).toString("utf-8"),
        stderr: Buffer.concat(errChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });
  });
}
```

Create `/packages/checker/src/runners/eslint-runner.ts`:

```ts
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTool } from "./tool-runner.js";
import { parseEslintJsonOutput } from "../formatters/unified.js";
import type { CheckDiagnostic } from "../orchestrator/types.js";

interface EslintFlatConfigEntry {
  rules?: Record<string, unknown>;
  files?: string[];
  plugins?: Record<string, unknown>;
}

export async function runEslint(
  config: EslintFlatConfigEntry[],
  files: string[],
  options?: { fix?: boolean },
): Promise<{ diagnostics: CheckDiagnostic[]; exitCode: number }> {
  const tempDir = mkdtempSync(join(tmpdir(), "code-style-eslint-"));
  const configPath = join(tempDir, "eslint.config.js");

  try {
    const configContent = `export default ${JSON.stringify(config, null, 2)};`;
    writeFileSync(configPath, configContent, "utf-8");

    const args = [
      "--config",
      configPath,
      "--format",
      "json",
      ...(options?.fix ? ["--fix"] : []),
      ...files,
    ];

    const result = await runTool("npx", ["eslint", ...args]);
    const diagnostics =
      result.stdout.trim() ? parseEslintJsonOutput(result.stdout) : [];

    return { diagnostics, exitCode: result.exitCode };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
```

Create `/packages/checker/src/runners/ruff-runner.ts`:

```ts
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTool } from "./tool-runner.js";
import { parseRuffJsonOutput } from "../formatters/unified.js";
import type { CheckDiagnostic } from "../orchestrator/types.js";
import type { RuffConfig } from "../generators/ruff.js";

function toToml(config: RuffConfig): string {
  const lines: string[] = [];

  if (config["line-length"]) {
    lines.push(`line-length = ${config["line-length"]}`);
  }

  if (config.lint) {
    lines.push("[lint]");
    if (config.lint.select) {
      lines.push(`select = [${config.lint.select.map((s) => `"${s}"`).join(", ")}]`);
    }
    if (config.lint.ignore) {
      lines.push(`ignore = [${config.lint.ignore.map((s) => `"${s}"`).join(", ")}]`);
    }
    if (config.lint.mccabe) {
      lines.push("[lint.mccabe]");
      if (config.lint.mccabe["max-complexity"]) {
        lines.push(`max-complexity = ${config.lint.mccabe["max-complexity"]}`);
      }
    }
    if (config.lint.pydocstyle) {
      lines.push("[lint.pydocstyle]");
      if (config.lint.pydocstyle.convention) {
        lines.push(`convention = "${config.lint.pydocstyle.convention}"`);
      }
    }
    if (config.lint.isort) {
      lines.push("[lint.isort]");
      if (config.lint.isort["section-order"]) {
        lines.push(`section-order = [${config.lint.isort["section-order"].map((s) => `"${s}"`).join(", ")}]`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

export async function runRuff(
  config: RuffConfig,
  files: string[],
  options?: { fix?: boolean },
): Promise<{ diagnostics: CheckDiagnostic[]; exitCode: number }> {
  const tempDir = mkdtempSync(join(tmpdir(), "code-style-ruff-"));
  const configPath = join(tempDir, "ruff.toml");

  try {
    writeFileSync(configPath, toToml(config), "utf-8");

    const args = [
      "check",
      "--config",
      configPath,
      "--output-format",
      "json",
      ...(options?.fix ? ["--fix"] : []),
      ...files,
    ];

    const result = await runTool("ruff", args);
    const diagnostics =
      result.stdout.trim() ? parseRuffJsonOutput(result.stdout) : [];

    return { diagnostics, exitCode: result.exitCode };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
```

### Step 9: Write failing tests for orchestrator and implement

Create `/packages/checker/src/__tests__/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { orchestrate } from "../orchestrator/index.js";
import type { StyleProfile } from "@code-style/profile";

vi.mock("../runners/eslint-runner.js", () => ({
  runEslint: vi.fn().mockResolvedValue({
    diagnostics: [
      {
        file: "src/app.ts",
        line: 10,
        column: 7,
        severity: "error",
        message: "Naming violation",
        category: "naming",
        rule: "@typescript-eslint/naming-convention",
        fixable: false,
      },
    ],
    exitCode: 1,
  }),
}));

vi.mock("../runners/ruff-runner.js", () => ({
  runRuff: vi.fn().mockResolvedValue({
    diagnostics: [],
    exitCode: 0,
  }),
}));

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {
    variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("orchestrate", () => {
  it("runs ESLint for TypeScript files and returns unified diagnostics", async () => {
    const result = await orchestrate({
      profile: sampleProfile,
      files: ["src/app.ts"],
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].rule).toBe("@typescript-eslint/naming-convention");
    expect(result.summary.errors).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  it("runs Ruff for Python files", async () => {
    const result = await orchestrate({
      profile: sampleProfile,
      files: ["src/app.py"],
      language: "python",
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it("computes summary counts correctly", async () => {
    const result = await orchestrate({
      profile: sampleProfile,
      files: ["src/app.ts"],
    });

    expect(result.summary.total).toBe(1);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(0);
    expect(result.summary.infos).toBe(0);
  });
});
```

Implement `/packages/checker/src/orchestrator/index.ts`:

```ts
import { generateEslintConfig } from "../generators/eslint.js";
import { generateRuffConfig } from "../generators/ruff.js";
import { runEslint } from "../runners/eslint-runner.js";
import { runRuff } from "../runners/ruff-runner.js";
import type {
  OrchestratorOptions,
  OrchestratorResult,
  CheckDiagnostic,
} from "./types.js";

function detectLanguage(files: string[]): "typescript" | "python" | "mixed" {
  const tsFiles = files.filter((f) => /\.[tj]sx?$/.test(f));
  const pyFiles = files.filter((f) => /\.py$/.test(f));
  if (tsFiles.length > 0 && pyFiles.length === 0) return "typescript";
  if (pyFiles.length > 0 && tsFiles.length === 0) return "python";
  return "mixed";
}

function buildSummary(diagnostics: CheckDiagnostic[]): OrchestratorResult["summary"] {
  return {
    total: diagnostics.length,
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warn").length,
    infos: diagnostics.filter((d) => d.severity === "info").length,
    fixed: 0,
  };
}

export async function orchestrate(
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { profile, files, fix } = options;
  const language = options.language ?? detectLanguage(files);
  const allDiagnostics: CheckDiagnostic[] = [];

  const tsFiles = files.filter((f) => /\.[tj]sx?$/.test(f));
  const pyFiles = files.filter((f) => /\.py$/.test(f));

  if ((language === "typescript" || language === "mixed") && tsFiles.length > 0) {
    const eslintConfig = generateEslintConfig(profile);
    if (eslintConfig.length > 0) {
      const result = await runEslint(eslintConfig, tsFiles, { fix });
      allDiagnostics.push(...result.diagnostics);
    }
  }

  if ((language === "python" || language === "mixed") && pyFiles.length > 0) {
    const ruffConfig = generateRuffConfig(profile);
    if (ruffConfig.lint?.select && ruffConfig.lint.select.length > 0) {
      const result = await runRuff(ruffConfig, pyFiles, { fix });
      allDiagnostics.push(...result.diagnostics);
    }
  }

  return {
    diagnostics: allDiagnostics,
    summary: buildSummary(allDiagnostics),
  };
}
```

### Step 10: Wire up package exports and verify

Update `/packages/checker/src/index.ts`:

```ts
export { orchestrate } from "./orchestrator/index.js";
export { generateEslintConfig } from "./generators/eslint.js";
export { generateRuffConfig } from "./generators/ruff.js";
export { formatDiagnostic, parseEslintJsonOutput, parseRuffJsonOutput } from "./formatters/unified.js";
export type {
  CheckDiagnostic,
  CheckResult,
  OrchestratorOptions,
  OrchestratorResult,
  Severity,
} from "./orchestrator/types.js";
export type { RuffConfig } from "./generators/ruff.js";
```

```bash
pnpm --filter @code-style/checker test
pnpm --filter @code-style/checker typecheck
```

### Step 11: Commit

```bash
git add packages/checker/src/
git commit -m "Add checker orchestration with ESLint and Ruff config generators and unified output"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/checker test` passes all tests (eslint generator, ruff generator, unified formatter, orchestrator)
- [ ] `pnpm --filter @code-style/checker typecheck` exits 0
- [ ] `generateEslintConfig` produces a flat config array with correct rules for naming, imports, file naming, function length, and jsdoc
- [ ] `generateRuffConfig` produces a config with N, I, D, C90 rule selectors as appropriate
- [ ] `parseEslintJsonOutput` and `parseRuffJsonOutput` both normalize to `CheckDiagnostic[]`
- [ ] `formatDiagnostic` produces `{file}:{line}:{col} {severity} {message} [{category}.{rule}]` format
- [ ] Orchestrator correctly routes TypeScript files to ESLint and Python files to Ruff
- [ ] Rules below the `info` confidence threshold are omitted from generated configs

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not build a custom lint engine** -- delegate to ESLint and Ruff; only generate configs and parse output
5. **Do not write temp config files in the project directory** -- use `os.tmpdir()` and clean up in a `finally` block
6. **Do not hardcode severity levels** -- always derive from profile `severityThresholds` and rule confidence
7. **Do not require ESLint/Ruff as direct dependencies** -- they are peer dependencies; the runner should handle "tool not found" gracefully with a clear error message
8. **Do not parse tool output with regex** -- ESLint and Ruff both support `--format json` / `--output-format json`; always use structured output
