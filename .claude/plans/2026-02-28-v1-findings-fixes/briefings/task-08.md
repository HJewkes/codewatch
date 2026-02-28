# Task 08: Runner Rewrite in TypeScript

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo. The diagnostic runner at `scripts/diagnostic/run.sh` has critical bugs: bash string substitution breaks on JSON with `/` characters, no subprocess timeouts, silent error suppression via `2>/dev/null`, and no budget tracking. This task rewrites the runner in TypeScript for proper JSON handling, error types, and concurrency control.

This task depends on Task 7 (prompts have been refined, judge.md has `{{TASK_DESCRIPTION}}`).

## File Ownership

**May modify:**
- `scripts/diagnostic/run.ts` (new file)
- `scripts/diagnostic/run.sh` (delete)
- `package.json` (root — add tsx dev dependency)

**Must not touch:**
- `scripts/diagnostic/assemble.ts` (Task 9 owns this)
- Any prompts under `scripts/diagnostic/prompts/`
- Any source code under `packages/`
- Any test files

## Steps

### Step 1: Add tsx as root dev dependency

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm add -D tsx -w
```

This adds `tsx` to the root `package.json` devDependencies for running TypeScript scripts directly.

### Step 2: Create scripts/diagnostic/run.ts

Create `scripts/diagnostic/run.ts` with the following structure:

```typescript
import { execFile } from "node:child_process"
import { readFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { parseArgs } from "node:util"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(__dirname, "../..")
```

**CLI parsing** — use `node:util` `parseArgs`:
- Positional: `version` (required, e.g. "v1")
- `--profile <path>` (default: `scripts/diagnostic/fixtures/test-profile.json`)
- `--concurrency <n>` (default: 3)
- `--budget <usd>` (default: 0.50)
- `--skip-check` (boolean flag)
- `--skip-judge` (boolean flag)
- `--dry-run` (boolean flag)

**Interface definitions:**

```typescript
interface RunConfig {
  version: string
  profilePath: string
  concurrency: number
  budget: number
  skipCheck: boolean
  skipJudge: boolean
  dryRun: boolean
}
```

**Phase 1 (setup):** Export skill files to a temp directory:
- Create temp dir via `mkdtemp(join(tmpdir(), "code-style-diag-"))`
- Run `npx code-style export --format skill --profile <profilePath> --output <tempDir>` via `execFileAsync`
- Verify `skill.md` exists in the temp dir
- Return the skill directory path

**Phase 2 (test bench):** Run prompts with hand-rolled concurrency limiter:
- Read all `D-XX.md` files from `scripts/diagnostic/prompts/test-bench/`
- For each prompt file:
  - Read the `.md` content
  - Replace template variables using `String.replaceAll()`: `{{VERSION}}`, `{{PROFILE_PATH}}`, `{{SKILL_DIR}}`, `{{OUTPUT_DIR}}`
  - Extract `{{TASK_DESCRIPTION}}` from the prompt's `## Task` section (everything between `## Task` and the next `##` heading or end of file)
  - Spawn `claude -p` with `AbortSignal.timeout(120_000)` via `execFileAsync` options
  - Pass `--model sonnet --output-format json --max-budget-usd <budget> --permission-mode bypassPermissions --no-session-persistence`
  - Write output to `<benchDir>/D-XX.json`
  - Track per-prompt budget from claude output if available
- Concurrency limiter: maintain a counter of active promises, queue new work when a slot opens. No external dependencies — use a simple async semaphore pattern:

```typescript
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = []
  const executing: Set<Promise<void>> = new Set()

  for (const task of tasks) {
    const p = task().then((result) => { results.push(result) })
    const tracked = p.finally(() => executing.delete(tracked))
    executing.add(tracked)
    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}
```

**Phase 3 (check):** Run `code-style check` against output files:
- For each completed prompt, extract `files_written` from the JSON result
- Run `npx code-style check --format json --profile <profilePath> <files...>`
- Write output to `<benchDir>/D-XX-check.json`
- Log errors with context instead of suppressing

**Phase 4 (judge):** For each prompt result:
- Read `scripts/diagnostic/prompts/judge.md`
- Collect all code files from the prompt's output directory
- Substitute `{{PROFILE_JSON}}`, `{{CODE_CONTENT}}`, `{{TASK_DESCRIPTION}}` using `String.replaceAll()`
- Spawn `claude -p` with timeout
- Write output to `<benchDir>/D-XX-judge.json`

**Phase 5 (assemble):** Call the assembler:
```typescript
await execFileAsync("npx", ["tsx", "scripts/diagnostic/assemble.ts", version], {
  cwd: PROJECT_DIR,
  timeout: 30_000,
})
```

**Error handling:**
- Each phase wraps its work in try/catch
- Log errors with context: phase name, prompt ID, file path, error message
- Never suppress errors with `2>/dev/null` — log them
- A single prompt failure should not abort the entire run

**Dry run mode:**
- When `--dry-run` is set, print each phase and what it would do without executing any subprocesses
- Print prompt list, template variable values, command that would be run

**Cleanup:**
- Use a try/finally to remove the temp skill directory on exit

### Step 3: Delete run.sh

```bash
rm scripts/diagnostic/run.sh
```

### Step 4: Verify dry-run works

```bash
npx tsx scripts/diagnostic/run.ts v1 --dry-run
```

This should print the phases and planned actions without executing any subprocesses, and exit cleanly.

### Step 5: Commit

```bash
git add scripts/diagnostic/run.ts package.json pnpm-lock.yaml
git rm scripts/diagnostic/run.sh
git commit -m "Rewrite diagnostic runner in TypeScript with proper error handling"
```

## Success Criteria

- [ ] `tsx` is listed in root `package.json` devDependencies
- [ ] `scripts/diagnostic/run.ts` exists and compiles without type errors
- [ ] `scripts/diagnostic/run.sh` is deleted
- [ ] `npx tsx scripts/diagnostic/run.ts v1 --dry-run` runs and prints phase plan without errors
- [ ] All subprocess calls use `AbortSignal.timeout(120_000)` or equivalent timeout
- [ ] Template variables are substituted via `String.replaceAll()`, not bash string replacement
- [ ] `{{TASK_DESCRIPTION}}` is extracted from each prompt and passed to the judge
- [ ] Errors are logged with context (phase, prompt ID, path)
- [ ] Concurrency limiter uses hand-rolled implementation (no `p-limit` dependency)
- [ ] `git status` is clean after commit

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
4. Do not add external dependencies besides `tsx` — use hand-rolled concurrency limiter
5. Do not modify `assemble.ts` — Task 9 owns that file
6. Do not modify any prompt files — Task 7 owns those
