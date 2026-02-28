# Task 01: Project Scaffolding

## Architectural Context

This task creates the monorepo foundation that all subsequent tasks build on. The project is a pnpm workspace with four packages (`profile`, `analyzer`, `checker`, `cli`) that mirror the pipeline stages from the design doc. Every downstream task assumes working TypeScript compilation, test runner, and build tooling.

## File Ownership

**May modify:**
- `/package.json` (workspace root)
- `/pnpm-workspace.yaml`
- `/tsconfig.base.json`
- `/vitest.config.ts`
- `/.gitignore`
- `/packages/profile/package.json`
- `/packages/profile/tsconfig.json`
- `/packages/profile/tsup.config.ts`
- `/packages/profile/src/index.ts`
- `/packages/analyzer/package.json`
- `/packages/analyzer/tsconfig.json`
- `/packages/analyzer/tsup.config.ts`
- `/packages/analyzer/src/index.ts`
- `/packages/checker/package.json`
- `/packages/checker/tsconfig.json`
- `/packages/checker/tsup.config.ts`
- `/packages/checker/src/index.ts`
- `/packages/cli/package.json`
- `/packages/cli/tsconfig.json`
- `/packages/cli/tsup.config.ts`
- `/packages/cli/src/index.ts`

**Must not touch:**
- `/docs/**` (existing design docs and research)
- `/.claude/**` (plan files)

**Read for context (do not modify):**
- `/docs/plans/2026-02-27-code-style-design.md` (project structure, dependencies)

## Steps

### Step 1: Initialize git repo

```bash
cd /Users/hjewkes/Documents/projects/code-style
git init
```

### Step 2: Write `.gitignore`

```gitignore
node_modules/
dist/
.code-style/cache/
*.tsbuildinfo
.turbo/
coverage/
```

### Step 3: Write root `package.json`

```json
{
  "name": "code-style",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "pnpm -r run lint"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsup": "^8.0.0",
    "@vitest/coverage-v8": "^3.0.0"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.0"
}
```

### Step 4: Write `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### Step 5: Write `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

### Step 6: Write `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    workspace: ["packages/*"],
  },
});
```

### Step 7: Create each package

For each of `profile`, `analyzer`, `checker`, `cli`:

**`packages/{pkg}/package.json`** (example for profile):

```json
{
  "name": "@code-style/profile",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'lint not configured yet'"
  },
  "files": ["dist"]
}
```

**`packages/{pkg}/tsconfig.json`**:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**`packages/{pkg}/tsup.config.ts`**:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

**`packages/{pkg}/src/index.ts`**:

```ts
// Package entry point
export {};
```

**`packages/{pkg}/vitest.config.ts`**:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

### Step 8: Set up inter-package dependencies

The `analyzer` depends on `profile`, `checker` depends on `profile`, and `cli` depends on all three. Add workspace protocol references:

**`packages/analyzer/package.json`** (add to dependencies):
```json
{
  "dependencies": {
    "@code-style/profile": "workspace:*"
  }
}
```

**`packages/checker/package.json`** (add to dependencies):
```json
{
  "dependencies": {
    "@code-style/profile": "workspace:*"
  }
}
```

**`packages/cli/package.json`** (add to dependencies):
```json
{
  "dependencies": {
    "@code-style/profile": "workspace:*",
    "@code-style/analyzer": "workspace:*",
    "@code-style/checker": "workspace:*"
  }
}
```

### Step 9: Install and verify

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

All four commands must exit 0.

### Step 10: Commit

```bash
git add -A
git commit -m "Scaffold pnpm monorepo with profile, analyzer, checker, cli packages"
```

## Success Criteria

- [ ] `pnpm install` exits 0 with no unresolved peer warnings
- [ ] `pnpm typecheck` exits 0 across all 4 packages
- [ ] `pnpm test` exits 0 (no tests yet, but runner initializes)
- [ ] `pnpm build` produces `dist/` in each package with `.js` and `.d.ts` files
- [ ] `git status` is clean after commit
- [ ] Each package's `tsconfig.json` extends `tsconfig.base.json`
- [ ] Workspace protocol (`workspace:*`) links are resolvable

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use CommonJS** -- the project is ESM-only (`"type": "module"` everywhere)
5. **Do not use `paths` aliases in tsconfig** -- use NodeNext resolution with workspace protocol
6. **Do not add runtime dependencies yet** -- this task is scaffolding only; zod, tree-sitter, etc. come in later tasks
7. **Do not use `tsc` for building** -- use `tsup` for builds, `tsc --noEmit` for type checking only
