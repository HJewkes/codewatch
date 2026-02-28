# Task 03: Export Validation Fixtures

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo that generates style profiles from code analysis. Profiles are JSON files conforming to the `ProfileSchema` (defined in `packages/profile/src/schema/profile.ts`). The `checker` package can then validate code against a profile and the system can export profiles as ESLint/Ruff configs.

This task creates three fixture files for testing export validation:
1. A valid Profile JSON that integration tests will export to tool-specific configs
2. A TypeScript file that deliberately VIOLATES the profile (for checker tests)
3. A TypeScript file that perfectly COMPLIES with the profile (for checker tests)

### Profile Schema

A Profile has this shape (from `ProfileSchema` in zod):
- `schemaVersion`: string
- `author`: string
- `generated`: string (ISO date)
- `sources`: string[] (files analyzed)
- Six category records (`naming`, `structure`, `documentation`, `errorHandling`, `formatting`, `patterns`), each a `Record<string, StyleRule>`
- `idioms`: `{ detected: Idiom[] }`
- `antiPatterns`: `{ acknowledged: AntiPattern[] }`
- `overrides`: `Override[]`
- `severityThresholds`: `{ error: number, warn: number, info: number }`

Each `StyleRule` has: `convention` (string|number|boolean|string[]), `confidence` (0-1), and optional `stability`, `fixability`, `description`, `examples`, `extensions`.

## File Ownership

**May create:**
- `tests/integration/fixtures/exports/test-profile.json`
- `tests/integration/fixtures/exports/violation-ts.ts`
- `tests/integration/fixtures/exports/compliant-ts.ts`

**May delete:**
- `tests/integration/fixtures/exports/.gitkeep` (if it exists, after files are created)

**Must not touch:**
- `packages/**`
- `tests/integration/fixtures/corpus/**`
- Any config files

## Steps

### Step 1: Create test-profile.json

Write `tests/integration/fixtures/exports/test-profile.json`:

```json
{
  "schemaVersion": "1.0.0",
  "author": "integration-test",
  "generated": "2026-02-28T00:00:00.000Z",
  "sources": [
    "tests/integration/fixtures/exports/compliant-ts.ts",
    "tests/integration/fixtures/exports/violation-ts.ts"
  ],
  "naming": {
    "variables": {
      "convention": "camelCase",
      "confidence": 0.95,
      "stability": "high",
      "fixability": "safe",
      "description": "Variables use camelCase"
    },
    "functions": {
      "convention": "camelCase",
      "confidence": 0.92,
      "stability": "high",
      "fixability": "safe",
      "description": "Functions use camelCase"
    },
    "types": {
      "convention": "PascalCase",
      "confidence": 0.98,
      "stability": "high",
      "fixability": "safe",
      "description": "Types and interfaces use PascalCase"
    },
    "files": {
      "convention": "kebab-case",
      "confidence": 0.88,
      "stability": "medium",
      "fixability": "maybe-incorrect",
      "description": "Files use kebab-case naming"
    }
  },
  "structure": {
    "importOrder": {
      "convention": ["builtin", "external", "internal", "relative"],
      "confidence": 0.90,
      "stability": "high",
      "fixability": "safe",
      "description": "Imports ordered: builtin, external, internal, relative"
    }
  },
  "documentation": {
    "functionDocs": {
      "convention": "jsdoc-selective",
      "confidence": 0.82,
      "stability": "medium",
      "fixability": "requires-input",
      "description": "JSDoc on exported functions only"
    }
  },
  "errorHandling": {
    "tryCatch": {
      "convention": "typed-errors",
      "confidence": 0.85,
      "stability": "medium",
      "fixability": "requires-input",
      "description": "Catch blocks check error type with instanceof"
    },
    "earlyReturn": {
      "convention": true,
      "confidence": 0.90,
      "stability": "high",
      "fixability": "safe",
      "description": "Use early returns for validation"
    }
  },
  "formatting": {
    "semicolons": {
      "convention": true,
      "confidence": 0.97,
      "stability": "high",
      "fixability": "safe",
      "description": "Always use semicolons"
    },
    "quotes": {
      "convention": "single",
      "confidence": 0.95,
      "stability": "high",
      "fixability": "safe",
      "description": "Use single quotes for strings"
    },
    "indentation": {
      "convention": 2,
      "confidence": 0.99,
      "stability": "high",
      "fixability": "safe",
      "description": "2-space indentation"
    }
  },
  "patterns": {
    "optionalChaining": {
      "convention": true,
      "confidence": 0.88,
      "stability": "medium",
      "fixability": "safe",
      "description": "Prefer optional chaining over manual null checks"
    },
    "guardClauses": {
      "convention": true,
      "confidence": 0.85,
      "stability": "medium",
      "fixability": "maybe-incorrect",
      "description": "Use guard clauses for early exits"
    }
  },
  "idioms": {
    "detected": [
      {
        "name": "guard-clause",
        "description": "Early return pattern for input validation",
        "frequency": 12,
        "confidence": 0.90,
        "example": "if (!input) { return null; }"
      },
      {
        "name": "optional-chaining",
        "description": "Use ?. for safe property access",
        "frequency": 8,
        "confidence": 0.85
      }
    ]
  },
  "antiPatterns": {
    "acknowledged": [
      {
        "pattern": "nested-ternary",
        "reason": "Nested ternaries reduce readability"
      },
      {
        "pattern": "any-type",
        "reason": "Using 'any' bypasses type safety",
        "deprecated": true
      }
    ]
  },
  "overrides": [],
  "severityThresholds": {
    "error": 0.85,
    "warn": 0.60,
    "info": 0.40
  }
}
```

### Step 2: Create violation-ts.ts

This file deliberately violates the profile. It uses snake_case variables, wrong import order, no JSDoc on exports, and mixed semicolons. It must be syntactically valid TypeScript (no `// @ts-nocheck`).

Write `tests/integration/fixtures/exports/violation-ts.ts`:

```typescript
// VIOLATIONS: snake_case vars, wrong import order, no JSDoc on exports, mixed semicolons

// Relative imports FIRST (violates: should be last)
import { helper_fn } from './utils'
import { local_config } from '../config'

// Builtin imports SECOND (violates: should be first)
import * as path from 'node:path'
import * as fs from 'node:fs'

// External imports LAST (violates: should be second)
import { z } from 'zod'

const max_retries = 3
const user_name = 'alice';
let is_active = true
let account_balance = 100;

interface user_profile {
  first_name: string
  last_name: string;
  email_address: string
}

type api_response = {
  status_code: number;
  response_body: unknown
}

export function fetch_user_data(user_id: string): Promise<user_profile> {
  if (!user_id) {
    return Promise.reject('missing id')
  }

  return helper_fn(`/users/${user_id}`)
}

export async function update_user(user_id: string, data: user_profile) {
  const file_path = path.join('/tmp', user_id);
  fs.writeFileSync(file_path, JSON.stringify(data))

  try {
    const result = await helper_fn(`/users/${user_id}`)
    return result;
  } catch (e) {
    console.error(e)
    throw e
  }
}

function process_items(item_list: string[]) {
  const result_list: string[] = []
  for (const item of item_list) {
    if (item !== null && item !== undefined) {
      result_list.push(item.toUpperCase());
    }
  }
  return result_list
}

export const get_config = () => {
  const config_data = local_config
  return config_data
}
```

### Step 3: Create compliant-ts.ts

This file perfectly follows the profile. camelCase vars, PascalCase types, correct import order, JSDoc on exports, consistent semicolons, single quotes.

Write `tests/integration/fixtures/exports/compliant-ts.ts`:

```typescript
// COMPLIANT: camelCase vars, PascalCase types, correct import order, JSDoc on exports, semicolons
import * as path from 'node:path';
import * as fs from 'node:fs';

import { z } from 'zod';

import { appConfig } from '@app/config';
import type { Logger } from '@app/logging';

import { formatOutput } from './utils';
import type { DataRow } from './types';

const MAX_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 5000;

interface ProcessingResult {
  totalRecords: number;
  successCount: number;
  failureCount: number;
}

interface BatchOptions {
  batchSize?: number;
  timeoutMs?: number;
}

type StatusCode = 'ok' | 'error' | 'partial';

/** Processes a batch of data rows and returns aggregated results. */
export function processBatch(
  rows: DataRow[],
  options: BatchOptions = {}
): ProcessingResult {
  if (!rows?.length) {
    return { totalRecords: 0, successCount: 0, failureCount: 0 };
  }

  const batchSize = options.batchSize ?? MAX_BATCH_SIZE;
  let successCount = 0;
  let failureCount = 0;

  for (const row of rows.slice(0, batchSize)) {
    const isValid = validateRow(row);
    if (isValid) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  return { totalRecords: rows.length, successCount, failureCount };
}

/** Reads a data file and parses its contents into rows. */
export function loadDataFile(filePath: string): DataRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Determines the status code based on processing results. */
export function getStatusCode(result: ProcessingResult): StatusCode {
  if (result.failureCount === 0) {
    return 'ok';
  }

  if (result.successCount === 0) {
    return 'error';
  }

  return 'partial';
}

function validateRow(row: DataRow): boolean {
  return row?.id !== undefined && row?.value !== undefined;
}
```

### Step 4: Remove .gitkeep if present

```bash
rm -f tests/integration/fixtures/exports/.gitkeep
```

### Step 5: Verify

Verify the profile JSON is valid:

```bash
cd /Users/hjewkes/Documents/projects/code-style
node -e "const p = require('./tests/integration/fixtures/exports/test-profile.json'); console.log('Profile keys:', Object.keys(p).join(', ')); console.log('Schema version:', p.schemaVersion)"
```

Verify TypeScript files are syntactically valid (type errors are expected and OK):

```bash
for f in tests/integration/fixtures/exports/*.ts; do
  echo "Checking $f..."
done
```

### Step 6: Commit

```bash
git add tests/integration/fixtures/exports/
git commit -m "Add export validation fixtures with profile, compliant, and violation files"
```

## Success Criteria

- [ ] `test-profile.json` is valid JSON and contains all required Profile fields
- [ ] `test-profile.json` has all 6 categories: naming, structure, documentation, errorHandling, formatting, patterns
- [ ] `test-profile.json` includes idioms, antiPatterns, overrides, and severityThresholds
- [ ] `test-profile.json` confidence values match those specified (variables: 0.95, functions: 0.92, types: 0.98, files: 0.88, importOrder: 0.90, functionDocs: 0.82, semicolons: 0.97)
- [ ] `violation-ts.ts` uses snake_case variables and types (violates camelCase/PascalCase)
- [ ] `violation-ts.ts` has relative imports first, builtin second (violates import order)
- [ ] `violation-ts.ts` has no JSDoc on exported functions
- [ ] `violation-ts.ts` mixes semicolons inconsistently
- [ ] `compliant-ts.ts` uses camelCase variables, PascalCase types
- [ ] `compliant-ts.ts` has correct import order: builtin -> external -> internal -> relative
- [ ] `compliant-ts.ts` has JSDoc on all exported functions
- [ ] `compliant-ts.ts` uses consistent semicolons
- [ ] No `// @ts-nocheck` in any TypeScript file
- [ ] All TypeScript files are syntactically valid (parseable by tree-sitter)

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not use `// @ts-nocheck` — files must be syntactically valid
5. Do not modify the Profile schema or any package code
6. Do not create additional fixture files beyond the three specified
7. Do not change the confidence values — they must match the specification exactly
