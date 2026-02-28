# Task 01: Integration Test Scaffold

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo with 4 packages (`profile`, `analyzer`, `checker`, `cli`). All existing tests are unit tests within each package. This task creates the directory structure for cross-package integration tests at the workspace root.

## File Ownership

**May modify:**
- `tests/integration/pipeline/.gitkeep`
- `tests/integration/exports/.gitkeep`
- `tests/integration/roundtrip/.gitkeep`
- `tests/integration/fixtures/corpus/typescript/.gitkeep`
- `tests/integration/fixtures/exports/.gitkeep`

**Must not touch:**
- `packages/**` (existing package code)
- `vitest.config.ts` (another task handles this)

## Steps

### Step 1: Create directory structure

```bash
cd /Users/hjewkes/Documents/projects/code-style
mkdir -p tests/integration/pipeline
mkdir -p tests/integration/exports
mkdir -p tests/integration/roundtrip
mkdir -p tests/integration/fixtures/corpus/typescript
mkdir -p tests/integration/fixtures/exports
```

### Step 2: Add .gitkeep files

```bash
touch tests/integration/pipeline/.gitkeep
touch tests/integration/exports/.gitkeep
touch tests/integration/roundtrip/.gitkeep
touch tests/integration/fixtures/corpus/typescript/.gitkeep
touch tests/integration/fixtures/exports/.gitkeep
```

### Step 3: Commit

```bash
git add tests/integration/
git commit -m "Scaffold integration test directory structure"
```

## Success Criteria

- [ ] All directories exist under `tests/integration/`
- [ ] `git status` is clean after commit

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps
