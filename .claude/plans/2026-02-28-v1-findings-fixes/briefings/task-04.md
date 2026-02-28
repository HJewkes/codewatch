# Task 04: Skill Export Tiering + Humanization

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. The `packages/profile` package contains exporters that generate Handlebars-templated skill files from a `Profile` object. The current skill exporter (`packages/profile/src/exporters/skill.ts`) produces a flat list of top-8 rules filtered by the error threshold. The templates live in `skills/code-style-personal/templates/`. This task replaces the flat list with confidence-tiered sections (critical/strong/preferred) and makes boolean/number conventions human-readable using the rule's `description` field.

The `Profile` type has `severityThresholds: { error: number, warn: number, info: number }` with defaults 0.85/0.60/0.40. The `RuleEntry` type in `template-helpers.ts` has `convention: unknown`, `confidence: number`, `description?: string`, and `examples?`.

## File Ownership

**May modify:**
- `packages/profile/src/exporters/template-helpers.ts`
- `packages/profile/src/exporters/skill.ts`
- `skills/code-style-personal/templates/skill.md.hbs`
- `skills/code-style-personal/templates/per-language.md.hbs`
- `packages/profile/src/__tests__/skill-exporter.test.ts`

**Must not touch:**
- `skills/code-style-personal/templates/naming.md.hbs` (Task 5 owns this)
- `skills/code-style-personal/templates/patterns.md.hbs` (Task 5 owns this)
- `tests/integration/exports/skill-export.test.ts` (Task 5 owns this)
- Any files outside the ownership list

## Steps

### Step 1: Add `getRulesByTier` and `readableConvention` to `template-helpers.ts`

In `packages/profile/src/exporters/template-helpers.ts`, add two new exported functions:

```typescript
export function getRulesByTier(profile: Profile): {
  critical: RuleEntry[];
  strong: RuleEntry[];
  preferred: RuleEntry[];
} {
  const allRules = extractAllRules(profile);
  const errorThreshold = profile.severityThresholds?.error ?? 0.85;
  const warnThreshold = profile.severityThresholds?.warn ?? 0.60;
  const infoThreshold = profile.severityThresholds?.info ?? 0.40;

  const critical: RuleEntry[] = [];
  const strong: RuleEntry[] = [];
  const preferred: RuleEntry[] = [];

  for (const rule of allRules) {
    if (rule.confidence >= errorThreshold) {
      critical.push(rule);
    } else if (rule.confidence >= warnThreshold) {
      strong.push(rule);
    } else if (rule.confidence >= infoThreshold) {
      preferred.push(rule);
    }
  }

  const byConfidence = (a: RuleEntry, b: RuleEntry) =>
    b.confidence - a.confidence;
  critical.sort(byConfidence);
  strong.sort(byConfidence);
  preferred.sort(byConfidence);

  return { critical, strong, preferred };
}

export function readableConvention(rule: RuleEntry): string {
  if (
    typeof rule.convention === "boolean" ||
    typeof rule.convention === "number"
  ) {
    return rule.description ?? JSON.stringify(rule.convention);
  }
  if (Array.isArray(rule.convention)) {
    return rule.convention.join(" → ");
  }
  return String(rule.convention);
}
```

Also add the `getRulesByTier` and `readableConvention` exports to the import list in `skill.ts` (Step 2).

### Step 2: Update `buildTopRulesContext` in `skill.ts` to use tiered rules

In `packages/profile/src/exporters/skill.ts`:

1. Add `getRulesByTier` and `readableConvention` to the imports from `./template-helpers.js`.
2. Replace the existing `buildTopRulesContext` function with a new `buildTieredRulesContext` function:

```typescript
function buildTieredRulesContext(profile: Profile) {
  const tiers = getRulesByTier(profile);

  const mapRule = (r: RuleEntry) => ({
    name: `${r.category}.${r.name}`,
    readableConvention: readableConvention(r),
    confidencePercent: (r.confidence * 100).toFixed(0),
  });

  return {
    criticalRules: tiers.critical.map(mapRule),
    strongRules: tiers.strong.map(mapRule),
    preferredRules: tiers.preferred.map(mapRule),
  };
}
```

3. In `generateSkillFiles`, update the `skillTemplate` call to spread the tiered context instead of passing `topRules`:

```typescript
const skillTemplate = loadTemplate("skill.md.hbs");
files.push({
  path: "skill.md",
  content: skillTemplate({
    author: profile.author,
    ...buildTieredRulesContext(profile),
    languages,
  }),
});
```

4. In the per-language template section, update the `allRules` mapping to include `readableConvention` and `confidencePercent`, and group by tier. Use `getRulesByTier` to build tiered arrays for the language template:

```typescript
const langTemplate = loadTemplate("per-language.md.hbs");
for (const lang of languages) {
  const tiers = getRulesByTier(profile);
  const mapRule = (r: RuleEntry) => ({
    category: r.category,
    name: r.name,
    convention:
      typeof r.convention === "string"
        ? r.convention
        : JSON.stringify(r.convention),
    confidencePercent: (r.confidence * 100).toFixed(0),
    readableConvention: readableConvention(r),
    description: r.description,
  });

  files.push({
    path: `references/per-language/${lang}.md`,
    content: langTemplate({
      language: lang.charAt(0).toUpperCase() + lang.slice(1),
      criticalRules: tiers.critical.map(mapRule),
      strongRules: tiers.strong.map(mapRule),
      preferredRules: tiers.preferred.map(mapRule),
    }),
  });
}
```

5. The `getTopRules` import can be removed if no longer used elsewhere. Keep `extractAllRules` since it is still used by other context builders.

### Step 3: Update `skill.md.hbs` to render tiered sections

Replace the flat list in `skills/code-style-personal/templates/skill.md.hbs`. Keep the YAML frontmatter and references section unchanged. Replace the `{{#each topRules}}` block with tiered sections:

```handlebars
---
description: "Personal coding style for {{author}} -- enforces naming, structure, documentation, and pattern preferences detected from real code."
triggers:
  - writing new code
  - reviewing code
  - refactoring
---

# {{author}}'s Code Style

{{#if criticalRules}}
## Critical Rules (always follow)
{{#each criticalRules}}
- **{{name}}**: {{readableConvention}} ({{confidencePercent}}%)
{{/each}}
{{/if}}

{{#if strongRules}}
## Strong Conventions (follow when possible)
{{#each strongRules}}
- **{{name}}**: {{readableConvention}} ({{confidencePercent}}%)
{{/each}}
{{/if}}

{{#if preferredRules}}
## Preferred Style (when it fits)
{{#each preferredRules}}
- **{{name}}**: {{readableConvention}} ({{confidencePercent}}%)
{{/each}}
{{/if}}

For full details see:
- [references/naming.md](references/naming.md) -- naming conventions
- [references/patterns.md](references/patterns.md) -- structural patterns and preferences
{{#each languages}}
- [references/per-language/{{this}}.md](references/per-language/{{this}}.md) -- {{this}}-specific rules
{{/each}}
```

### Step 4: Update `per-language.md.hbs` to group by confidence tier

Replace the flat list in `skills/code-style-personal/templates/per-language.md.hbs` with tiered sections:

```handlebars
# {{language}} Style Rules

{{#if criticalRules}}
## Critical Rules
{{#each criticalRules}}
### {{category}}: {{name}}

**Convention**: `{{convention}}`
**Confidence**: {{confidencePercent}}%

{{#if description}}
{{description}}
{{/if}}

{{/each}}
{{/if}}

{{#if strongRules}}
## Strong Conventions
{{#each strongRules}}
### {{category}}: {{name}}

**Convention**: `{{convention}}`
**Confidence**: {{confidencePercent}}%

{{#if description}}
{{description}}
{{/if}}

{{/each}}
{{/if}}

{{#if preferredRules}}
## Preferred Style
{{#each preferredRules}}
### {{category}}: {{name}}

**Convention**: `{{convention}}`
**Confidence**: {{confidencePercent}}%

{{#if description}}
{{description}}
{{/if}}

{{/each}}
{{/if}}
```

### Step 5: Update `skill-exporter.test.ts` to verify tiered output

In `packages/profile/src/__tests__/skill-exporter.test.ts`:

1. Update the "skill.md contains high-confidence rules" test to check for the "Critical Rules" heading:

```typescript
it("skill.md contains tiered rule sections", () => {
  const files = generateSkillFiles(sampleProfile);
  const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
  expect(skillMd.content).toContain("## Critical Rules (always follow)");
  expect(skillMd.content).toContain("camelCase");
  expect(skillMd.content).toContain("PascalCase");
});
```

2. Add a new test for readable convention rendering:

```typescript
it("renders readable descriptions for boolean conventions", () => {
  const profileWithBool: Profile = {
    ...sampleProfile,
    formatting: {
      semicolons: {
        convention: true,
        confidence: 0.97,
        stability: "high",
        description: "Always use semicolons",
      },
    },
  };
  const files = generateSkillFiles(profileWithBool);
  const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
  expect(skillMd.content).toContain("Always use semicolons");
  expect(skillMd.content).not.toContain(": true (");
});
```

3. Add a test for strong conventions tier:

```typescript
it("skill.md includes strong conventions tier", () => {
  const files = generateSkillFiles(sampleProfile);
  const skillMd = files.find((f) => f.path.endsWith("skill.md"))!;
  expect(skillMd.content).toContain("## Strong Conventions");
});
```

4. Update the conciseness test threshold if needed (the tiered output may be slightly longer, adjust from 2000 to 3000 if necessary).

5. Add a test for per-language tiered output:

```typescript
it("per-language template groups rules by tier", () => {
  const files = generateSkillFiles(sampleProfile);
  const langMd = files.find((f) =>
    f.path.includes("per-language/typescript.md"),
  )!;
  expect(langMd.content).toContain("## Critical Rules");
});
```

### Step 6: Run tests and commit

```bash
cd /Users/hjewkes/Documents/projects/code-style && pnpm test
```

All tests must pass. Then commit:

```bash
git add packages/profile/src/exporters/template-helpers.ts packages/profile/src/exporters/skill.ts skills/code-style-personal/templates/skill.md.hbs skills/code-style-personal/templates/per-language.md.hbs packages/profile/src/__tests__/skill-exporter.test.ts
git commit -m "Add confidence-tiered skill export with readable conventions"
```

## Success Criteria

- [ ] `getRulesByTier` correctly buckets rules into critical (>= 0.85), strong (>= 0.60), preferred (>= 0.40)
- [ ] `readableConvention` returns `description` for booleans/numbers, joins arrays with " → ", passes strings through
- [ ] `skill.md` renders "Critical Rules (always follow)" and "Strong Conventions (follow when possible)" headings
- [ ] `per-language.md` groups rules by confidence tier instead of a flat list
- [ ] Boolean conventions render as human-readable descriptions, not raw `true`/`false`
- [ ] Unit tests verify tiered headings and readable convention rendering
- [ ] All existing tests continue to pass
- [ ] `pnpm test` exits cleanly

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not touch `naming.md.hbs`, `patterns.md.hbs`, or `skill-export.test.ts` -- Task 5 owns those
5. Do not remove the YAML frontmatter or references section from `skill.md.hbs`
6. Do not change the `RuleEntry` type definition -- only add new functions that consume it
