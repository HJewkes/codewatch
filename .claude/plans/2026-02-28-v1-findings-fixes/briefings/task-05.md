# Task 05: Skill Export Idioms/Fixability/Examples

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. The `packages/profile` package exports skill files via Handlebars templates. The `Profile` type includes `idioms: { detected: Array<{ name, description, frequency, confidence, example? }> }` and `antiPatterns: { acknowledged: Array<{ pattern, reason, deprecated? }> }`. The `StyleRule` schema includes an optional `fixability` field (values: `"safe"`, `"maybe-incorrect"`, `"requires-input"`). Currently, idioms, anti-patterns, and fixability are not surfaced in any skill template.

Task 4 runs before this task and modifies `skill.ts` (replaces `buildTopRulesContext` with `buildTieredRulesContext`) and `skill.md.hbs` (adds tiered rule sections). This task adds NEW sections and functions on top of Task 4's changes. Read the files as modified by Task 4 before editing.

## File Ownership

**May modify:**
- `skills/code-style-personal/templates/naming.md.hbs`
- `skills/code-style-personal/templates/patterns.md.hbs`
- `tests/integration/exports/skill-export.test.ts`

**Also modifies (shared with Task 4, add-only):**
- `packages/profile/src/exporters/skill.ts` -- add new context builder functions, do not change Task 4's tiered logic
- `skills/code-style-personal/templates/skill.md.hbs` -- add new sections AFTER the references links, do not change Task 4's tiered sections

**Must not touch:**
- `packages/profile/src/exporters/template-helpers.ts` (Task 4 owns this)
- `skills/code-style-personal/templates/per-language.md.hbs` (Task 4 owns this)
- `packages/profile/src/__tests__/skill-exporter.test.ts` (Task 4 owns this)
- Any files outside the ownership list

## Steps

### Step 1: Add idiom and anti-pattern context builders in `skill.ts`

In `packages/profile/src/exporters/skill.ts`, add two new functions after the existing context builders (which will include Task 4's `buildTieredRulesContext` at this point):

```typescript
function buildIdiomsContext(profile: Profile) {
  return profile.idioms.detected.map((idiom) => ({
    name: idiom.name,
    description: idiom.description,
    example: idiom.example,
  }));
}

function buildAntiPatternsContext(profile: Profile) {
  return profile.antiPatterns.acknowledged.map((ap) => ({
    pattern: ap.pattern,
    reason: ap.reason,
  }));
}
```

Then update the `generateSkillFiles` function's `skillTemplate` call to include idioms and anti-patterns in the context. The call will already have `author`, tiered rules (from Task 4), and `languages`. Add:

```typescript
const idioms = buildIdiomsContext(profile);
const antiPatterns = buildAntiPatternsContext(profile);

// In the skillTemplate call, add:
idioms: idioms.length > 0 ? idioms : undefined,
antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
```

### Step 2: Add idiom and anti-pattern sections to `skill.md.hbs`

In `skills/code-style-personal/templates/skill.md.hbs`, add the following AFTER the references links section (after the `{{#each languages}}` block). Do not modify the frontmatter, tiered rule sections (Task 4's work), or the references links:

```handlebars
{{#if idioms}}

## Common Patterns
{{#each idioms}}
- **{{name}}**: {{description}}{{#if example}} — `{{example}}`{{/if}}
{{/each}}
{{/if}}

{{#if antiPatterns}}

## Avoid
{{#each antiPatterns}}
- **{{pattern}}**: {{reason}}
{{/each}}
{{/if}}
```

### Step 3: Add fixability to `naming.md.hbs`

In `skills/code-style-personal/templates/naming.md.hbs`, on the line with `**Confidence**: {{confidencePercent}}%{{#if stability}} | **Stability**: {{stability}}{{/if}}`, append fixability:

Change:
```handlebars
**Confidence**: {{confidencePercent}}%{{#if stability}} | **Stability**: {{stability}}{{/if}}
```

To:
```handlebars
**Confidence**: {{confidencePercent}}%{{#if stability}} | **Stability**: {{stability}}{{/if}}{{#if fixability}} | **Fixability**: {{fixability}}{{/if}}
```

Then update the naming context builder in `skill.ts`. In the `buildNamingContext` function, add `fixability: r.fixability` to the mapped object (alongside the existing `stability`, `description`, `examples` fields). The `RuleEntry` type in `template-helpers.ts` does not have `fixability`, but the raw profile rule does. Access it via `r.extensions?.fixability` or cast appropriately. The simplest approach: in `template-helpers.ts`'s `extractAllRules`, the rule object from the profile includes `fixability`. Since `RuleEntry` uses `extensions` for extra fields, pass it through there:

Actually, look at the `extractAllRules` function -- it stores `extensions: rule.extensions` but `fixability` is a top-level field on the `StyleRule` schema. The cleanest approach is to read `fixability` directly from the raw profile rule in the context builder:

```typescript
function buildNamingContext(profile: Profile) {
  const section = profile.naming;
  return Object.entries(section).map(([name, rule]) => ({
    label: name.charAt(0).toUpperCase() + name.slice(1),
    convention:
      typeof rule.convention === "string"
        ? rule.convention
        : JSON.stringify(rule.convention),
    confidencePercent: (rule.confidence * 100).toFixed(0),
    stability: rule.stability,
    fixability: rule.fixability,
    description: rule.description,
    examples: rule.examples,
  }));
}
```

This replaces the current implementation that uses `getRulesForCategory` (which loses the `fixability` field). Alternatively, add `fixability` to `RuleEntry` in `template-helpers.ts` -- but that file is owned by Task 4. The safest approach is to read directly from the profile section as shown above.

### Step 4: Add fixability and examples to `patterns.md.hbs`

In `skills/code-style-personal/templates/patterns.md.hbs`, update the template to include fixability and examples:

```handlebars
# Structural Patterns & Preferences

{{#each patterns}}
## {{name}}

**Strength**: {{strength}} | **Confidence**: {{confidencePercent}}%{{#if fixability}} | **Fixability**: {{fixability}}{{/if}}

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

{{#if preferredPatterns}}
## Preferred Code Patterns

{{#each preferredPatterns}}
- {{this}}
{{/each}}
{{/if}}
```

Then update `buildPatternsContext` in `skill.ts` to pass `fixability` and `examples`:

```typescript
function buildPatternsContext(profile: Profile) {
  const section = profile.patterns;
  const patternRules = Object.entries(section).map(([name, rule]) => ({
    name,
    strength:
      typeof rule.convention === "string" ? rule.convention : "detected",
    confidencePercent: (rule.confidence * 100).toFixed(0),
    description: rule.description,
    fixability: rule.fixability,
    examples: rule.examples,
  }));

  const preferredPatterns = profile.structure?.preferredPatterns;
  let preferredList: string[] | undefined;
  if (preferredPatterns && Array.isArray(preferredPatterns.convention)) {
    preferredList = preferredPatterns.convention as string[];
  }

  return { patterns: patternRules, preferredPatterns: preferredList };
}
```

### Step 5: Update integration test `skill-export.test.ts`

In `tests/integration/exports/skill-export.test.ts`, add three new tests inside the existing `describe("Skill file generation", ...)` block:

```typescript
it("renders idioms section when profile has idioms", () => {
  const skillFile = files.find((f) => f.path === "skill.md");
  expect(skillFile).toBeDefined();
  expect(skillFile!.content).toContain("## Common Patterns");
  expect(skillFile!.content).toContain("guard-clause");
});

it("renders anti-patterns section when profile has anti-patterns", () => {
  const skillFile = files.find((f) => f.path === "skill.md");
  expect(skillFile).toBeDefined();
  expect(skillFile!.content).toContain("## Avoid");
  expect(skillFile!.content).toContain("nested-ternary");
});

it("renders fixability in naming reference when present", () => {
  const namingFile = files.find((f) => f.path === "references/naming.md");
  expect(namingFile).toBeDefined();
  expect(namingFile!.content).toContain("Fixability");
});
```

The test fixture at `tests/integration/fixtures/exports/test-profile.json` already has `idioms.detected` with two entries (including `guard-clause` with an example), `antiPatterns.acknowledged` with two entries (including `nested-ternary`), and `fixability` fields on naming rules. These assertions should pass with the template changes.

The existing "contains no unrendered Handlebars artifacts" test stays unchanged and continues to verify no `{{` or `}}` remain in output.

### Step 6: Run tests and commit

```bash
cd /Users/hjewkes/Documents/projects/code-style && pnpm test
```

All tests must pass. Then commit:

```bash
git add packages/profile/src/exporters/skill.ts skills/code-style-personal/templates/skill.md.hbs skills/code-style-personal/templates/naming.md.hbs skills/code-style-personal/templates/patterns.md.hbs tests/integration/exports/skill-export.test.ts
git commit -m "Add idioms, anti-patterns, and fixability to skill export"
```

## Success Criteria

- [ ] `buildIdiomsContext` maps `profile.idioms.detected` to template-ready objects with `name`, `description`, `example`
- [ ] `buildAntiPatternsContext` maps `profile.antiPatterns.acknowledged` to template-ready objects with `pattern`, `reason`
- [ ] `skill.md` renders "Common Patterns" section with idiom names and examples when present
- [ ] `skill.md` renders "Avoid" section with anti-pattern names and reasons when present
- [ ] `naming.md` renders fixability after confidence when the field is present
- [ ] `patterns.md` renders fixability and examples when present
- [ ] Integration test verifies idioms, anti-patterns, and fixability sections appear
- [ ] No unrendered Handlebars artifacts in any output file
- [ ] All existing tests continue to pass
- [ ] `pnpm test` exits cleanly

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not touch `template-helpers.ts` or `per-language.md.hbs` -- Task 4 owns those
5. Do not touch `skill-exporter.test.ts` (unit test) -- Task 4 owns that
6. Do not change Task 4's tiered rule sections in `skill.md.hbs` -- only ADD new sections after the references links
7. Do not change Task 4's `buildTieredRulesContext` or `readableConvention` functions in `skill.ts` -- only ADD new functions
