# Task 04: Vitest Workspace Config for Integration Tests

## Architectural Context

The project uses vitest with workspace projects configured in the root `vitest.config.ts`. Currently it only includes `packages/*`. We need to add `tests/integration` as a vitest project so integration tests run alongside unit tests with `pnpm test`. The integration tests import from `@code-style/profile`, `@code-style/analyzer`, and `@code-style/checker` — they need a tsconfig that resolves these workspace packages.

## File Ownership

**May modify:**
- `tests/integration/vitest.config.ts`
- `tests/integration/tsconfig.json`
- `vitest.config.ts` (root — add integration project)

**Must not touch:**
- `packages/*/vitest.config.ts` (existing package configs)

**Read for context (do not modify):**
- `vitest.config.ts` — current root config uses `projects: ["packages/*"]`
- `tsconfig.base.json` — base TypeScript config all packages extend

## Steps

### Step 1: Create integration vitest config

Write `tests/integration/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    include: ["**/*.test.ts"],
  },
});
```

The `testTimeout` is 30s because integration tests parse files with web-tree-sitter WASM which is slower than unit tests.

### Step 2: Create integration tsconfig

Write `tests/integration/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"]
}
```

### Step 3: Update root vitest config

Edit `vitest.config.ts` to add the integration test project:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    projects: ["packages/*", "tests/integration"],
    passWithNoTests: true,
  },
});
```

### Step 4: Verify

```bash
pnpm test
```

Expected: All existing 344 tests still pass, integration project discovered (0 tests, passes due to `passWithNoTests`).

### Step 5: Commit

```bash
git add vitest.config.ts tests/integration/vitest.config.ts tests/integration/tsconfig.json
git commit -m "Add integration test vitest project to workspace"
```

## Success Criteria

- [ ] `pnpm test` passes (all existing tests + integration project discovered)
- [ ] `pnpm typecheck` still passes
- [ ] Integration tests have 30s timeout for WASM parsing

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not change existing package vitest configs
5. Do not add integration test files yet — other tasks handle that
