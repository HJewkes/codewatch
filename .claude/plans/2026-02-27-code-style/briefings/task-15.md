# Task 15: Skill + Claude Rules + Hooks Export

## Architectural Context

This task implements three Claude Code integration exporters in the `profile` package. The skill exporter generates `skill.md` and reference docs from a profile using Handlebars templates stored in `skills/code-style-personal/`. The Claude rules exporter generates `.claude/rules/{language}.md` files with path-scoped frontmatter. The hooks exporter generates `.claude/settings.json` entries for PostToolUse hooks that run `code-style diff` on written files. These exporters are consumed by the `export` command in Task 18.

## File Ownership

**May modify:**
- `/packages/profile/src/exporters/skill.ts`
- `/packages/profile/src/exporters/claude-rules.ts`
- `/packages/profile/src/exporters/hooks.ts`
- `/packages/profile/src/exporters/index.ts`
- `/packages/profile/src/exporters/template-helpers.ts`
- `/packages/profile/src/__tests__/skill-exporter.test.ts`
- `/packages/profile/src/__tests__/claude-rules-exporter.test.ts`
- `/packages/profile/src/__tests__/hooks-exporter.test.ts`
- `/packages/profile/package.json` (add handlebars dependency)
- `/skills/code-style-personal/templates/skill.md.hbs`
- `/skills/code-style-personal/templates/naming.md.hbs`
- `/skills/code-style-personal/templates/patterns.md.hbs`
- `/skills/code-style-personal/templates/per-language.md.hbs`

**Must not touch:**
- `/packages/cli/src/**`
- `/packages/checker/src/**`
- `/packages/analyzer/src/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/profile/src/schema/profile.ts` (profile types)
- `/docs/plans/2026-02-27-code-style-design.md` (skill structure, Claude rules, hooks sections)

## Steps

### Step 1: Add handlebars dependency

```bash
pnpm --filter @code-style/profile add handlebars
```

### Step 2: Write failing tests for skill exporter

Create `/packages/profile/src/__tests__/skill-exporter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateSkillFiles } from "../exporters/skill.js";
import type { StyleProfile } from "../schema/profile.js";

const sampleProfile: StyleProfile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: ["testuser/repo-a"],
  naming: {
    variables: {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      description: "Use camelCase for all local variables and parameters.",
      examples: [
        { good: "const userProfile = await fetchUser(id);" },
      ],
    },
    functions: { convention: "camelCase", confidence: 0.97, stability: "high" },
    types: { convention: "PascalCase", confidence: 0.99, stability: "high" },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
      fixability: "safe",
      description: "Group imports: Node builtins, then external packages, then internal aliases, then relative paths.",
    },
    preferredPatterns: {
      convention: ["guard-clauses", "early-return", "composition"],
      confidence: 0.82,
    },
  },
  documentation: {
    functionDocs: {
      convention: "jsdoc-selective",
      confidence: 0.80,
      description: "Add JSDoc to exported functions only. Rely on TypeScript types instead of @param tags.",
    },
  },
  patterns: {
    preferPureFunctions: { strength: "strong", confidence: 0.82, stability: "medium" },
    avoidClassInheritance: { strength: "moderate", confidence: 0.68, stability: "medium" },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("generateSkillFiles", () => {
  it("returns a skill.md file", () => {
    const files = generateSkillFiles(sampleProfile);
    const skillMd = files.find((f) => f.path.endsWith("skill.md"));
    expect(skillMd).toBeDefined();
  });

  it("skill.md contains top 5-8 high-confidence rules", () => {
    const files = generateSkillFiles(sampleProfile);
    const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
    // Should include rules with confidence >= error threshold
    expect(skillMd.content).toContain("camelCase");
    expect(skillMd.content).toContain("PascalCase");
  });

  it("skill.md references detail docs", () => {
    const files = generateSkillFiles(sampleProfile);
    const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
    expect(skillMd.content).toContain("references/");
  });

  it("generates naming.md reference doc", () => {
    const files = generateSkillFiles(sampleProfile);
    const namingMd = files.find((f) => f.path.endsWith("naming.md"));
    expect(namingMd).toBeDefined();
    expect(namingMd!.content).toContain("camelCase");
  });

  it("generates patterns.md reference doc", () => {
    const files = generateSkillFiles(sampleProfile);
    const patternsMd = files.find((f) => f.path.endsWith("patterns.md"));
    expect(patternsMd).toBeDefined();
    expect(patternsMd!.content).toContain("guard-clauses");
  });

  it("includes examples when available", () => {
    const files = generateSkillFiles(sampleProfile);
    const namingMd = files.find((f) => f.path.endsWith("naming.md"))!;
    expect(namingMd.content).toContain("userProfile");
  });

  it("skill.md is concise (under 2000 chars)", () => {
    const files = generateSkillFiles(sampleProfile);
    const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
    expect(skillMd.content.length).toBeLessThan(2000);
  });
});
```

Run: `pnpm --filter @code-style/profile test` -- expect failures.

### Step 3: Create Handlebars templates

Create `/skills/code-style-personal/templates/skill.md.hbs`:

```handlebars
---
description: "Personal coding style for {{author}} — enforces naming, structure, documentation, and pattern preferences detected from real code."
triggers:
  - writing new code
  - reviewing code
  - refactoring
---

# {{author}}'s Code Style

{{#each topRules}}
- **{{name}}**: {{description}}
{{/each}}

For full details see:
- [references/naming.md](references/naming.md) — naming conventions
- [references/patterns.md](references/patterns.md) — structural patterns and preferences
{{#each languages}}
- [references/per-language/{{this}}.md](references/per-language/{{this}}.md) — {{this}}-specific rules
{{/each}}
```

Create `/skills/code-style-personal/templates/naming.md.hbs`:

```handlebars
# Naming Conventions

{{#each rules}}
## {{label}}

**Convention**: `{{convention}}`
**Confidence**: {{confidencePercent}}%{{#if stability}} | **Stability**: {{stability}}{{/if}}

{{#if description}}
{{description}}
{{/if}}

{{#if examples}}
### Examples
{{#each examples}}
{{#if good}}
```typescript
// Good
{{good}}
```
{{/if}}
{{#if bad}}
```typescript
// Avoid
{{bad}}
```
{{/if}}
{{/each}}
{{/if}}

{{/each}}
```

Create `/skills/code-style-personal/templates/patterns.md.hbs`:

```handlebars
# Structural Patterns & Preferences

{{#each patterns}}
## {{name}}

**Strength**: {{strength}} | **Confidence**: {{confidencePercent}}%

{{#if description}}
{{description}}
{{/if}}

{{/each}}

{{#if preferredPatterns}}
## Preferred Code Patterns

{{#each preferredPatterns}}
- {{this}}
{{/each}}
{{/if}}
```

Create `/skills/code-style-personal/templates/per-language.md.hbs`:

```handlebars
# {{language}} Style Rules

{{#each rules}}
## {{category}}: {{name}}

**Convention**: `{{convention}}`
**Confidence**: {{confidencePercent}}%

{{#if description}}
{{description}}
{{/if}}

{{/each}}
```

### Step 4: Implement template helpers

Create `/packages/profile/src/exporters/template-helpers.ts`:

```ts
import type { StyleProfile } from "../schema/profile.js";

interface RuleEntry {
  category: string;
  name: string;
  convention: unknown;
  confidence: number;
  stability?: string;
  description?: string;
  examples?: Array<{ good?: string; bad?: string; source?: string }>;
}

export function extractAllRules(profile: StyleProfile): RuleEntry[] {
  const rules: RuleEntry[] = [];
  const categories = [
    "naming", "structure", "documentation", "errorHandling",
    "formatting", "patterns",
  ] as const;

  for (const category of categories) {
    const section = profile[category];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;

    for (const [name, rule] of Object.entries(section as Record<string, unknown>)) {
      if (!rule || typeof rule !== "object" || !("confidence" in (rule as Record<string, unknown>))) continue;
      const typed = rule as {
        convention?: unknown;
        confidence: number;
        stability?: string;
        description?: string;
        examples?: Array<{ good?: string; bad?: string; source?: string }>;
        strength?: string;
      };
      rules.push({
        category,
        name,
        convention: typed.convention ?? typed.strength ?? "unknown",
        confidence: typed.confidence,
        stability: typed.stability,
        description: typed.description,
        examples: typed.examples,
      });
    }
  }

  return rules;
}

export function getTopRules(profile: StyleProfile, count: number = 8): RuleEntry[] {
  return extractAllRules(profile)
    .filter((r) => r.confidence >= (profile.severityThresholds?.error ?? 0.85))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, count);
}

export function getRulesByCategory(profile: StyleProfile, category: string): RuleEntry[] {
  return extractAllRules(profile).filter((r) => r.category === category);
}

export function detectLanguages(profile: StyleProfile): string[] {
  const langs: string[] = [];
  if (profile.naming?.types || profile.naming?.variables) langs.push("typescript");
  // Python detection heuristic: check sources or explicit language-specific sections
  return langs.length > 0 ? langs : ["typescript"];
}
```

### Step 5: Implement skill exporter

Create `/packages/profile/src/exporters/skill.ts`:

```ts
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StyleProfile } from "../schema/profile.js";
import {
  getTopRules,
  getRulesByCategory,
  detectLanguages,
  extractAllRules,
} from "./template-helpers.js";

export interface GeneratedFile {
  path: string;
  content: string;
}

const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/code-style-personal/templates",
);

function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const templatePath = join(TEMPLATES_DIR, name);
  const source = readFileSync(templatePath, "utf-8");
  return Handlebars.compile(source);
}

function buildTopRulesContext(profile: StyleProfile) {
  return getTopRules(profile).map((r) => ({
    name: `${r.category}.${r.name}`,
    description:
      r.description ??
      `Use ${typeof r.convention === "string" ? r.convention : JSON.stringify(r.convention)} (${(r.confidence * 100).toFixed(0)}% confidence)`,
  }));
}

function buildNamingContext(profile: StyleProfile) {
  return getRulesByCategory(profile, "naming").map((r) => ({
    label: r.name.charAt(0).toUpperCase() + r.name.slice(1),
    convention: typeof r.convention === "string" ? r.convention : JSON.stringify(r.convention),
    confidencePercent: (r.confidence * 100).toFixed(0),
    stability: r.stability,
    description: r.description,
    examples: r.examples,
  }));
}

function buildPatternsContext(profile: StyleProfile) {
  const patternRules = getRulesByCategory(profile, "patterns").map((r) => ({
    name: r.name,
    strength: typeof r.convention === "string" ? r.convention : "detected",
    confidencePercent: (r.confidence * 100).toFixed(0),
    description: r.description,
  }));

  const preferredPatterns = profile.structure?.preferredPatterns;
  let preferredList: string[] | undefined;
  if (preferredPatterns && typeof preferredPatterns === "object") {
    const typed = preferredPatterns as { convention?: string[] };
    preferredList = typed.convention;
  }

  return { patterns: patternRules, preferredPatterns: preferredList };
}

export function generateSkillFiles(profile: StyleProfile): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const languages = detectLanguages(profile);

  // skill.md
  const skillTemplate = loadTemplate("skill.md.hbs");
  files.push({
    path: "skill.md",
    content: skillTemplate({
      author: profile.author,
      topRules: buildTopRulesContext(profile),
      languages,
    }),
  });

  // references/naming.md
  const namingTemplate = loadTemplate("naming.md.hbs");
  files.push({
    path: "references/naming.md",
    content: namingTemplate({ rules: buildNamingContext(profile) }),
  });

  // references/patterns.md
  const patternsTemplate = loadTemplate("patterns.md.hbs");
  files.push({
    path: "references/patterns.md",
    content: patternsTemplate(buildPatternsContext(profile)),
  });

  // references/per-language/*.md
  const langTemplate = loadTemplate("per-language.md.hbs");
  for (const lang of languages) {
    const allRules = extractAllRules(profile).map((r) => ({
      category: r.category,
      name: r.name,
      convention: typeof r.convention === "string" ? r.convention : JSON.stringify(r.convention),
      confidencePercent: (r.confidence * 100).toFixed(0),
      description: r.description,
    }));

    files.push({
      path: `references/per-language/${lang}.md`,
      content: langTemplate({ language: lang.charAt(0).toUpperCase() + lang.slice(1), rules: allRules }),
    });
  }

  return files;
}
```

Run: `pnpm --filter @code-style/profile test` -- skill exporter tests should pass.

### Step 6: Write failing tests for Claude rules exporter

Create `/packages/profile/src/__tests__/claude-rules-exporter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateClaudeRules } from "../exporters/claude-rules.js";
import type { StyleProfile } from "../schema/profile.js";

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
      description: "Use camelCase for all local variables.",
    },
    types: {
      convention: "PascalCase",
      confidence: 0.99,
      stability: "high",
    },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("generateClaudeRules", () => {
  it("generates a typescript.md rules file", () => {
    const files = generateClaudeRules(sampleProfile);
    const tsRules = files.find((f) => f.path.endsWith("typescript.md"));
    expect(tsRules).toBeDefined();
  });

  it("includes path-scoped frontmatter with globs", () => {
    const files = generateClaudeRules(sampleProfile);
    const tsRules = files.find((f) => f.path.endsWith("typescript.md"))!;
    expect(tsRules.content).toContain("---");
    expect(tsRules.content).toMatch(/globs:.*\*\.ts/);
  });

  it("includes naming convention rules in body", () => {
    const files = generateClaudeRules(sampleProfile);
    const tsRules = files.find((f) => f.path.endsWith("typescript.md"))!;
    expect(tsRules.content).toContain("camelCase");
    expect(tsRules.content).toContain("PascalCase");
  });

  it("includes import ordering rules", () => {
    const files = generateClaudeRules(sampleProfile);
    const tsRules = files.find((f) => f.path.endsWith("typescript.md"))!;
    expect(tsRules.content).toContain("import");
  });

  it("only includes rules above info threshold", () => {
    const lowConfProfile = {
      ...sampleProfile,
      naming: {
        variables: {
          convention: "camelCase",
          confidence: 0.30,
          stability: "low" as const,
        },
      },
    };
    const files = generateClaudeRules(lowConfProfile);
    const tsRules = files.find((f) => f.path.endsWith("typescript.md"))!;
    expect(tsRules.content).not.toContain("camelCase");
  });
});
```

### Step 7: Implement Claude rules exporter

Create `/packages/profile/src/exporters/claude-rules.ts`:

```ts
import type { StyleProfile } from "../schema/profile.js";
import { extractAllRules } from "./template-helpers.js";
import type { GeneratedFile } from "./skill.js";

function formatFrontmatter(globs: string[], description: string): string {
  return [
    "---",
    `description: "${description}"`,
    `globs: "${globs.join(", ")}"`,
    "alwaysApply: false",
    "---",
    "",
  ].join("\n");
}

function formatRuleLine(
  category: string,
  name: string,
  convention: unknown,
  description?: string,
): string {
  const value =
    typeof convention === "string"
      ? convention
      : JSON.stringify(convention);
  const desc = description ? ` -- ${description}` : "";
  return `- **${category}.${name}**: \`${value}\`${desc}`;
}

export function generateClaudeRules(profile: StyleProfile): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const allRules = extractAllRules(profile);
  const infoThreshold = profile.severityThresholds?.info ?? 0.40;

  const eligibleRules = allRules.filter((r) => r.confidence >= infoThreshold);

  // TypeScript rules
  const tsRules = eligibleRules.filter(
    (r) =>
      r.category === "naming" ||
      r.category === "structure" ||
      r.category === "documentation" ||
      r.category === "errorHandling" ||
      r.category === "formatting" ||
      r.category === "patterns",
  );

  if (tsRules.length > 0) {
    const frontmatter = formatFrontmatter(
      ["**/*.ts", "**/*.tsx"],
      `${profile.author}'s TypeScript coding style preferences`,
    );

    const body = [
      `# ${profile.author}'s TypeScript Style`,
      "",
      ...tsRules
        .sort((a, b) => b.confidence - a.confidence)
        .map((r) =>
          formatRuleLine(r.category, r.name, r.convention, r.description),
        ),
    ].join("\n");

    files.push({
      path: ".claude/rules/typescript.md",
      content: frontmatter + body + "\n",
    });
  }

  // Python rules (subset that applies to Python)
  const pyCategories = ["naming", "structure", "documentation", "formatting"];
  const pyRules = eligibleRules.filter((r) => pyCategories.includes(r.category));

  if (pyRules.length > 0) {
    const frontmatter = formatFrontmatter(
      ["**/*.py"],
      `${profile.author}'s Python coding style preferences`,
    );

    const body = [
      `# ${profile.author}'s Python Style`,
      "",
      ...pyRules
        .sort((a, b) => b.confidence - a.confidence)
        .map((r) =>
          formatRuleLine(r.category, r.name, r.convention, r.description),
        ),
    ].join("\n");

    files.push({
      path: ".claude/rules/python.md",
      content: frontmatter + body + "\n",
    });
  }

  return files;
}
```

### Step 8: Write failing tests for hooks exporter

Create `/packages/profile/src/__tests__/hooks-exporter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateHooksConfig } from "../exporters/hooks.js";
import type { StyleProfile } from "../schema/profile.js";

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
    },
  },
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("generateHooksConfig", () => {
  it("returns a settings object with hooks array", () => {
    const config = generateHooksConfig(sampleProfile);
    expect(config.hooks).toBeDefined();
    expect(Array.isArray(config.hooks)).toBe(true);
  });

  it("includes a PostToolUse hook for file_write", () => {
    const config = generateHooksConfig(sampleProfile);
    const writeHook = config.hooks.find(
      (h) => h.event === "PostToolUse" && h.matcher === "Write",
    );
    expect(writeHook).toBeDefined();
  });

  it("hook command runs code-style diff on the written file", () => {
    const config = generateHooksConfig(sampleProfile);
    const writeHook = config.hooks.find((h) => h.event === "PostToolUse")!;
    expect(writeHook.command).toContain("code-style");
    expect(writeHook.command).toContain("diff");
  });

  it("includes a PostToolUse hook for Edit tool", () => {
    const config = generateHooksConfig(sampleProfile);
    const editHook = config.hooks.find(
      (h) => h.event === "PostToolUse" && h.matcher === "Edit",
    );
    expect(editHook).toBeDefined();
  });
});
```

### Step 9: Implement hooks exporter

Create `/packages/profile/src/exporters/hooks.ts`:

```ts
import type { StyleProfile } from "../schema/profile.js";

interface ClaudeHook {
  event: "PreToolUse" | "PostToolUse";
  matcher: string;
  command: string;
}

interface ClaudeSettingsHooks {
  hooks: ClaudeHook[];
}

export function generateHooksConfig(
  _profile: StyleProfile,
): ClaudeSettingsHooks {
  return {
    hooks: [
      {
        event: "PostToolUse",
        matcher: "Write",
        command: "code-style diff --fix $TOOL_INPUT_FILE_PATH",
      },
      {
        event: "PostToolUse",
        matcher: "Edit",
        command: "code-style diff --fix $TOOL_INPUT_FILE_PATH",
      },
    ],
  };
}
```

### Step 10: Wire up exporter index and verify

Update `/packages/profile/src/exporters/index.ts`:

```ts
export { generateSkillFiles } from "./skill.js";
export type { GeneratedFile } from "./skill.js";
export { generateClaudeRules } from "./claude-rules.js";
export { generateHooksConfig } from "./hooks.js";
export { extractAllRules, getTopRules, getRulesByCategory, detectLanguages } from "./template-helpers.js";
```

Update `/packages/profile/src/index.ts` to re-export:

```ts
export * from "./exporters/index.js";
// ... existing exports
```

```bash
pnpm --filter @code-style/profile test
pnpm --filter @code-style/profile typecheck
```

### Step 11: Commit

```bash
git add packages/profile/src/exporters/ packages/profile/src/__tests__/ \
       packages/profile/src/index.ts packages/profile/package.json \
       skills/code-style-personal/templates/
git commit -m "Add skill, Claude rules, and hooks exporters with Handlebars templates"
```

## Success Criteria

- [ ] `pnpm --filter @code-style/profile test` passes all exporter tests
- [ ] `pnpm --filter @code-style/profile typecheck` exits 0
- [ ] `generateSkillFiles` produces `skill.md` under 2000 characters with top 5-8 rules and reference links
- [ ] `generateSkillFiles` produces `references/naming.md`, `references/patterns.md`, and per-language files
- [ ] `generateClaudeRules` produces `typescript.md` with YAML frontmatter including `globs` and `description`
- [ ] `generateClaudeRules` excludes rules below the info confidence threshold
- [ ] `generateHooksConfig` returns PostToolUse hooks for both Write and Edit tools
- [ ] Handlebars templates in `/skills/code-style-personal/templates/` render without errors

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not inline template strings in TypeScript** -- use Handlebars `.hbs` files in `/skills/code-style-personal/templates/` so templates are editable without recompilation
5. **Do not dump the entire profile into skill.md** -- the skill file must be concise (under 2000 chars); use reference docs for details to keep context window usage low
6. **Do not generate Claude rules without frontmatter** -- every `.claude/rules/*.md` file must have YAML frontmatter with `description`, `globs`, and `alwaysApply` fields for Claude Code to recognize it
7. **Do not hardcode file extension patterns** -- derive language-to-glob mappings from the profile's detected languages; TypeScript = `**/*.ts,**/*.tsx`, Python = `**/*.py`
