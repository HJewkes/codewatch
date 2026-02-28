# Task 07: Prompt Refinement

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` includes a diagnostic test bench in `scripts/diagnostic/prompts/test-bench/`. These prompts are sent to an AI agent along with skill files, and the agent's output is judged by `scripts/diagnostic/prompts/judge.md`. Several prompts are too vague (leading to excess tool calls and ambiguous output), analysis prompts lack output schemas, and the judge has no visibility into the original task.

## File Ownership

**May modify:**
- `scripts/diagnostic/prompts/test-bench/D-01.md`
- `scripts/diagnostic/prompts/test-bench/D-04.md`
- `scripts/diagnostic/prompts/test-bench/D-05.md`
- `scripts/diagnostic/prompts/test-bench/D-12.md`
- `scripts/diagnostic/prompts/test-bench/D-13.md`
- `scripts/diagnostic/prompts/judge.md`

**Must not touch:**
- Any other prompt files in `scripts/diagnostic/prompts/test-bench/`
- Any source code files
- Any template or test files

## Steps

### Step 1: Tighten D-01.md (string utility)

In `scripts/diagnostic/prompts/test-bench/D-01.md`, in the `## Task` section, replace the sentence:

```
The module should handle edge cases like empty strings and Unicode input.
```

With:

```
Edge cases to handle: (1) empty string input returns empty string, (2) null/undefined input throws TypeError, (3) single-word input for pluralize adds "s", (4) truncate with maxLength < 3 returns "...".
```

Leave all other content unchanged.

### Step 2: Tighten D-04.md (configuration module)

In `scripts/diagnostic/prompts/test-bench/D-04.md`, in the `## Task` section, replace the phrase:

```
with sections for database, server, and auth settings
```

With:

```
with the following config shape: database: { url: string, maxConnections: number, timeoutMs: number }, server: { port: number, host: string }, auth: { jwtSecret: string, tokenExpirySeconds: number }. All fields required. Throw if any environment variable is missing
```

Leave all other content unchanged.

### Step 3: Tighten D-05.md (discount calculator tests)

In `scripts/diagnostic/prompts/test-bench/D-05.md`, in the `## Task` section, after the first sentence (`Write a TypeScript test file for a hypothetical...`), that sentence already contains the function signature. Add the discount rates after "and invalid inputs":

Replace:

```
Cover edge cases: zero price, negative price, each tier's discount rate, rounding behavior, and invalid inputs. Use vitest conventions.
```

With:

```
Discount rates: bronze=10%, silver=15%, gold=20%, platinum=25%. Cover edge cases: zero price, negative price, each tier's discount rate, rounding behavior, and invalid inputs. Use vitest conventions.
```

### Step 4: Add output schema to D-12.md (code review)

In `scripts/diagnostic/prompts/test-bench/D-12.md`, in the `## Task` section, after the line "List every deviation from the profile's conventions. Do NOT fix the code — only identify violations.", add:

```

Write the review JSON file with this structure:
```json
{
  "violations": [
    { "line": 9, "category": "naming", "rule": "variables", "issue": "snake_case variable", "suggestion": "use camelCase" }
  ],
  "summary": { "total": 12, "byCategory": { "naming": 5, "structure": 3, "formatting": 4 } }
}
```
```

### Step 5: Add output schema to D-13.md (suggest fixes)

In `scripts/diagnostic/prompts/test-bench/D-13.md`, in the `## Task` section, after the line "For each issue, provide the line number, what is wrong, and what it should be changed to.", add:

```

Write the fixes JSON file with this structure:
```json
{
  "fixes": [
    { "line": 9, "before": "let user_name = ...", "after": "let userName = ...", "category": "naming" }
  ]
}
```
```

### Step 6: Add task context to judge.md

In `scripts/diagnostic/prompts/judge.md`, add a new section BEFORE the `## Evaluation Criteria` section:

```markdown
## Original Task
{{TASK_DESCRIPTION}}

Use this to verify the agent completed the task, not just followed style rules.
```

This `{{TASK_DESCRIPTION}}` variable will be populated by the runner (Task 4 in Fix 4) by extracting the `## Task` section from each test-bench prompt.

### Step 7: Commit

```bash
git add scripts/diagnostic/prompts/test-bench/D-01.md scripts/diagnostic/prompts/test-bench/D-04.md scripts/diagnostic/prompts/test-bench/D-05.md scripts/diagnostic/prompts/test-bench/D-12.md scripts/diagnostic/prompts/test-bench/D-13.md scripts/diagnostic/prompts/judge.md
git commit -m "Tighten diagnostic prompts with specific requirements and output schemas"
```

## Success Criteria

- [ ] D-01.md specifies four concrete edge cases instead of vague "empty strings and Unicode"
- [ ] D-04.md specifies the exact config shape with types instead of vague "sections for database, server, and auth"
- [ ] D-05.md includes discount rate percentages for each tier
- [ ] D-12.md includes a JSON schema for the violations output with `line`, `category`, `rule`, `issue`, `suggestion` fields and a `summary` object
- [ ] D-13.md includes a JSON schema for the fixes output with `line`, `before`, `after`, `category` fields
- [ ] judge.md includes `{{TASK_DESCRIPTION}}` section before evaluation criteria
- [ ] No other prompt files were modified
- [ ] No source code files were modified

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not change the `## Output` JSON response format in any prompt -- only modify the `## Task` section content
5. Do not change the `## Rules`, `## Profile`, or `## Skill` sections in any prompt
6. Do not modify the judge's scoring rubric or output format -- only add the task context section
