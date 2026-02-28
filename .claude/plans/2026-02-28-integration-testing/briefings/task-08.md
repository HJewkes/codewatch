# Task 08: Diagnostic Prompt Suite

## Architectural Context

The code-style project at `/Users/hjewkes/Documents/projects/code-style` generates coding style profiles from GitHub repos and exports them as Claude skills. The diagnostic suite tests whether Claude Code actually follows those profiles when writing code. This is Tier 3 testing — not part of CI, run manually via `scripts/diagnostic/run.sh`.

The system works like the brain project's diagnostic (`~/Documents/projects/brain/scripts/diagnostic/`): markdown prompts with template variables, run headlessly via `claude -p`, producing structured JSON results that an assembler script aggregates into a scorecard.

Each diagnostic prompt asks Claude to perform a coding task while following a style profile exported as a skill. The runner replaces `{{TEMPLATE_VARS}}` before passing prompts to `claude -p`. A separate judge prompt evaluates the generated code for style compliance.

The profile schema has six categories: `naming`, `structure`, `documentation`, `errorHandling`, `formatting`, `patterns`. The skill exporter generates `skill.md` + `references/naming.md`, `references/patterns.md`, and `references/per-language/<lang>.md`.

## File Ownership

**May create:**
- `scripts/diagnostic/prompts/test-bench/D-01.md` through `D-15.md`
- `scripts/diagnostic/prompts/judge.md`

**Must not touch:**
- `packages/**`
- `tests/**`
- `skills/**`

## Steps

### Step 1: Create directory structure

```bash
cd /Users/hjewkes/Documents/projects/code-style
mkdir -p scripts/diagnostic/prompts/test-bench
```

### Step 2: Write D-01.md through D-15.md

Write each file with the exact content specified below.

### Step 3: Write judge.md

Write the judge prompt with the exact content specified below.

### Step 4: Verify

```bash
ls scripts/diagnostic/prompts/test-bench/ | wc -l  # Should be 15
ls scripts/diagnostic/prompts/judge.md               # Should exist
```

### Step 5: Commit

```bash
git add scripts/diagnostic/prompts/
git commit -m "Add diagnostic prompt suite (D-01 through D-15) and judge prompt"
```

---

## Prompt Files

### `scripts/diagnostic/prompts/test-bench/D-01.md`

```markdown
# D-01: String Utility Module

## Task
Write a TypeScript string utility module with functions: capitalize, slugify, truncate, pluralize. Include proper exports. The module should handle edge cases like empty strings and Unicode input.

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-01",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-02.md`

```markdown
# D-02: User Service Class

## Task
Write a TypeScript user service class with methods: findById, create, update, delete. Use async/await and proper error handling. The service should accept a generic repository interface as a constructor dependency.

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-02",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-03.md`

```markdown
# D-03: Blog API Types

## Task
Write TypeScript interfaces and types for a blog API: Post, Author, Comment, PaginatedResponse<T>, ApiError. Include all relevant fields, proper readonly markers where appropriate, and union types for status fields.

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-03",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-04.md`

```markdown
# D-04: Configuration Module

## Task
Write a TypeScript configuration module that reads from environment variables with defaults and validation. It should export a typed config object with sections for database, server, and auth settings. Throw descriptive errors for missing required values.

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-04",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-05.md`

```markdown
# D-05: Discount Calculator Tests

## Task
Write a TypeScript test file for a hypothetical `calculateDiscount(price: number, tier: "bronze" | "silver" | "gold" | "platinum"): number` function. Cover edge cases: zero price, negative price, each tier's discount rate, rounding behavior, and invalid inputs. Use vitest conventions.

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-05",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-06.md`

```markdown
# D-06: Refactor Snake Case Variables

## Task
Refactor the following TypeScript file to match the coding style described in the profile. The file has naming convention violations — fix all variable and function names to comply with the profile's naming rules. Write the corrected file.

### Before Code

```typescript
import { readFileSync } from "node:fs";

interface user_record {
  user_id: string;
  display_name: string;
  email_address: string;
  is_active: boolean;
}

function get_user_by_id(user_id: string): user_record | null {
  const raw_data = readFileSync("users.json", "utf-8");
  const all_users: user_record[] = JSON.parse(raw_data);
  const found_user = all_users.find((u) => u.user_id === user_id);
  return found_user ?? null;
}

function format_user_name(user: user_record): string {
  const name_parts = user.display_name.split(" ");
  const first_name = name_parts[0];
  const last_initial = name_parts.length > 1 ? name_parts[1][0] : "";
  return `${first_name} ${last_initial}.`;
}

export { get_user_by_id, format_user_name };
export type { user_record };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-06",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-07.md`

```markdown
# D-07: Refactor Messy Imports

## Task
Refactor the following TypeScript file to fix the import organization. The imports are unordered and ungrouped — restructure them to match the profile's import ordering conventions. Also fix any other style issues you notice.

### Before Code

```typescript
import { Logger } from "../utils/logger";
import express from "express";
import { join } from "node:path";
import { UserService } from "../services/user";
import cors from "cors";
import { readFileSync } from "node:fs";
import { validateRequest } from "../middleware/validation";
import { z } from "zod";
import { config } from "../config";
import { createServer } from "node:http";

const app = express();
app.use(cors());
app.use(express.json());

const logger = new Logger("server");
const userService = new UserService();
const configPath = join(process.cwd(), "config.json");
const rawConfig = readFileSync(configPath, "utf-8");

const server = createServer(app);
const port = config.port ?? 3000;

server.listen(port, () => {
  logger.info(`Server started on port ${port}`);
});

export { app, server };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-07",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-08.md`

```markdown
# D-08: Refactor Bare Catch Blocks

## Task
Refactor the following TypeScript file to add proper error handling. The file has bare catch blocks that swallow errors silently — replace them with proper typed error handling following the profile's conventions.

### Before Code

```typescript
import { readFileSync, writeFileSync } from "node:fs";

interface AppConfig {
  port: number;
  dbUrl: string;
  apiKey: string;
}

function loadConfig(path: string): AppConfig {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return { port: 3000, dbUrl: "", apiKey: "" };
  }
}

async function fetchData(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (e) {
    return null;
  }
}

function saveResults(path: string, data: unknown): void {
  try {
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) {
    // ignore
  }
}

export { loadConfig, fetchData, saveResults };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-08",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-09.md`

```markdown
# D-09: Fix Pagination Off-by-One

## Task
Fix the off-by-one error in the following pagination function. The bug causes the last page to be missing one item. Fix the bug while following the style profile's conventions for the corrected code.

### Buggy Code

```typescript
interface PaginatedResult<T> {
  items: T[];
  page: number;
  totalPages: number;
  hasNext: boolean;
}

function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
  const totalPages = Math.floor(items.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  const pageItems = items.slice(start, end);

  return {
    items: pageItems,
    page,
    totalPages,
    hasNext: page < totalPages,
  };
}

export { paginate };
export type { PaginatedResult };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-09",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-10.md`

```markdown
# D-10: Fix Missing Null Check

## Task
Fix the null reference crash in the following TypeScript file. The `getUserDisplayName` function crashes when the user has no profile. Fix the bug while following the style profile's conventions.

### Buggy Code

```typescript
interface UserProfile {
  bio: string;
  avatarUrl: string;
  displayName: string;
}

interface User {
  id: string;
  email: string;
  profile?: UserProfile;
}

function getUsers(): User[] {
  return [
    { id: "1", email: "a@test.com", profile: { bio: "Hi", avatarUrl: "/a.png", displayName: "Alice" } },
    { id: "2", email: "b@test.com" },
    { id: "3", email: "c@test.com", profile: { bio: "", avatarUrl: "/c.png", displayName: "Charlie" } },
  ];
}

function getUserDisplayName(user: User): string {
  return user.profile.displayName.toUpperCase();
}

function listActiveUsers(): string[] {
  const users = getUsers();
  return users.map((u) => getUserDisplayName(u));
}

export { getUserDisplayName, listActiveUsers };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-10",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-11.md`

```markdown
# D-11: Fix Missing Await

## Task
Fix the incorrect async/await usage in the following TypeScript file. Several async calls are missing `await`, causing unresolved promises and silent failures. Fix all async bugs while following the style profile's conventions.

### Buggy Code

```typescript
interface CacheEntry {
  key: string;
  value: string;
  expiresAt: number;
}

async function getFromCache(key: string): Promise<CacheEntry | null> {
  const response = fetch(`/api/cache/${key}`);
  if (!response.ok) return null;
  return response.json();
}

async function setInCache(key: string, value: string, ttl: number): Promise<void> {
  const entry: CacheEntry = { key, value, expiresAt: Date.now() + ttl };
  fetch("/api/cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

async function refreshCache(keys: string[]): Promise<CacheEntry[]> {
  const results: CacheEntry[] = [];
  for (const key of keys) {
    const entry = getFromCache(key);
    if (entry) results.push(entry);
  }
  return results;
}

export { getFromCache, setInCache, refreshCache };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-11",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-12.md`

```markdown
# D-12: Code Review for Style Compliance

## Task
Review the following TypeScript module against the style profile. List every deviation from the profile's conventions. Do NOT fix the code — only identify violations.

### Code to Review

```typescript
import axios from "axios"
import {join} from "path"
import { EventEmitter } from "events"

// API client class
class APIClient extends EventEmitter {
    private BASE_URL: string
    private API_KEY: string

    constructor(base_url: string, api_key: string) {
        super()
        this.BASE_URL = base_url
        this.API_KEY = api_key
    }

    // Get data from endpoint
    async GetData(endpoint: string) {
        try {
            const URL = join(this.BASE_URL, endpoint)
            const Result = await axios.get(URL, { headers: { "x-api-key": this.API_KEY } })
            this.emit("success", Result.data)
            return Result.data
        } catch(err) {
            this.emit("error", err)
            throw err
        }
    }

    async PostData(endpoint: string, Body: any) {
        const URL = join(this.BASE_URL, endpoint)
        const Result = await axios.post(URL, Body, { headers: { "x-api-key": this.API_KEY } })
        return Result.data
    }
}

export default APIClient
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write the review as a JSON file, not a code fix

## Output
Return a single JSON object (no other text):
{
  "id": "D-12",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.json"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-13.md`

```markdown
# D-13: Suggest Style Fixes

## Task
Review the following TypeScript file and suggest specific, actionable fixes to make it comply with the style profile. For each issue, provide the line number, what is wrong, and what it should be changed to.

### Code to Review

```typescript
import * as fs from "fs";
import * as path from "path";

type resultStatus = "OK" | "FAIL" | "PENDING";

interface result_item {
  Name: string;
  Status: resultStatus;
  error_message?: string;
  Timestamp: number;
}

const MAXRETRIES = 3;

async function Process_Items(item_list: result_item[]) {
  let processed_count = 0;
  for (let i = 0; i < item_list.length; i++) {
    const Item = item_list[i];
    try {
      const data = fs.readFileSync(path.join("data", Item.Name), "utf-8");
      Item.Status = "OK";
      processed_count++;
    } catch (e) {
      Item.Status = "FAIL";
      Item.error_message = String(e);
    }
  }
  return { total: item_list.length, processed: processed_count };
}

export { Process_Items, MAXRETRIES };
export type { result_item, resultStatus };
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write the suggestions as a JSON file with an array of fixes

## Output
Return a single JSON object (no other text):
{
  "id": "D-13",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.json"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-14.md`

```markdown
# D-14: Add Documentation to Module

## Task
Add documentation to the following well-structured TypeScript module following the profile's documentation style. Add JSDoc comments, module-level documentation, and inline comments where the profile's conventions call for them. Write the fully documented version.

### Code to Document

```typescript
import { createHash, randomBytes } from "node:crypto";

export interface TokenOptions {
  expiresIn: number;
  prefix: string;
  algorithm: "sha256" | "sha512";
}

const DEFAULT_OPTIONS: TokenOptions = {
  expiresIn: 3600,
  prefix: "tok",
  algorithm: "sha256",
};

export function generateToken(
  payload: string,
  options: Partial<TokenOptions> = {},
): string {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const salt = randomBytes(16).toString("hex");
  const hash = createHash(resolved.algorithm)
    .update(`${payload}:${salt}`)
    .digest("hex");
  const expiry = Math.floor(Date.now() / 1000) + resolved.expiresIn;
  return `${resolved.prefix}_${hash}_${expiry}`;
}

export function validateToken(token: string): boolean {
  const parts = token.split("_");
  if (parts.length !== 3) return false;
  const expiry = parseInt(parts[2], 10);
  if (isNaN(expiry)) return false;
  return Math.floor(Date.now() / 1000) < expiry;
}

export function parseToken(token: string): {
  prefix: string;
  hash: string;
  expiry: number;
} | null {
  const parts = token.split("_");
  if (parts.length !== 3) return null;
  const expiry = parseInt(parts[2], 10);
  if (isNaN(expiry)) return null;
  return { prefix: parts[0], hash: parts[1], expiry };
}
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-14",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

### `scripts/diagnostic/prompts/test-bench/D-15.md`

```markdown
# D-15: Add JSDoc to API Types

## Task
Add JSDoc comments to the following API type definitions following the profile's documentation conventions. Document each interface, type, and property. Write the fully documented version.

### Code to Document

```typescript
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type StatusCode = 200 | 201 | 204 | 400 | 401 | 403 | 404 | 500;

export interface RequestConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  headers: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T;
  status: StatusCode;
  headers: Record<string, string>;
  requestId: string;
  duration: number;
}

export interface ApiError {
  code: string;
  message: string;
  status: StatusCode;
  details?: Record<string, unknown>;
  requestId: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>>;
  post<T>(path: string, body: unknown): Promise<ApiResponse<T>>;
  put<T>(path: string, body: unknown): Promise<ApiResponse<T>>;
  delete(path: string): Promise<ApiResponse<void>>;
}
```

## Profile
The style profile is at `{{PROFILE_PATH}}`.

## Skill
Read the code-style skill at `{{SKILL_DIR}}/skill.md` and its references in `{{SKILL_DIR}}/references/` before writing any code.

## Rules
- Read the skill files FIRST before writing any code
- Follow the coding style described in the skill
- Use ONLY the Write tool to create files in `{{OUTPUT_DIR}}`
- Do NOT install dependencies or run commands
- Write production-quality code, not stubs

## Output
Return a single JSON object (no other text):
{
  "id": "D-15",
  "version": "{{VERSION}}",
  "files_written": ["relative/path.ts"],
  "tool_calls": <number of tool invocations>,
  "skill_referenced": <true if you read skill files>,
  "self_assessment": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  }
}
```

---

## Judge Prompt

### `scripts/diagnostic/prompts/judge.md`

```markdown
# Style Judge

You are evaluating code written by another agent for compliance with a coding style profile.

## Profile
{{PROFILE_JSON}}

## Code Under Review
{{CODE_CONTENT}}

## Evaluation Criteria

Rate each dimension 1-5 (1=poor, 5=perfect):

1. **Naming**: Do variables, functions, types, constants follow the profile's conventions?
2. **Structure**: Are imports ordered correctly? Are functions appropriately sized? Module organization?
3. **Documentation**: Does the doc style match? JSDoc where expected? Comments appropriate?
4. **Error Handling**: Error patterns match profile? Proper try/catch, typed errors, early returns?
5. **Overall Feel**: Does the code "feel" like it was written by someone with this style?

## Rules
- Be strict. A score of 5 means zero deviations.
- A score of 3 means functional but with several style violations.
- A score of 1 means the profile was clearly not followed.
- List every specific violation you find, not just general impressions.

## Output
Return a single JSON object (no other text):
{
  "scores": {
    "naming": <1-5>,
    "structure": <1-5>,
    "documentation": <1-5>,
    "error_handling": <1-5>,
    "overall": <1-5>
  },
  "violations": [
    { "line": <n>, "category": "<naming|structure|documentation|error_handling>", "description": "<what's wrong>" }
  ],
  "strengths": ["<what was done well>"],
  "summary": "<1-2 sentence overall assessment>"
}
```

---

## Success Criteria

- [ ] 15 prompt files exist in `scripts/diagnostic/prompts/test-bench/` (D-01.md through D-15.md)
- [ ] `scripts/diagnostic/prompts/judge.md` exists
- [ ] Each prompt contains all template variables: `{{VERSION}}`, `{{PROFILE_PATH}}`, `{{SKILL_DIR}}`, `{{OUTPUT_DIR}}`
- [ ] Each prompt's Output section has valid JSON structure with `id`, `version`, `files_written`, `tool_calls`, `skill_referenced`, `self_assessment`
- [ ] D-06 through D-08 contain inline "before" code (20-30 lines each)
- [ ] D-09 through D-11 contain inline buggy code (15-25 lines each)
- [ ] D-12 through D-13 contain inline code for review
- [ ] D-14 through D-15 contain inline code to document
- [ ] Judge prompt expects `{{PROFILE_JSON}}` and `{{CODE_CONTENT}}` template variables

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not create the runner or assembler — Task 09 handles those
5. Do not create fixture files — Task 09 handles the test profile
6. Do not add `--max-budget-usd` to prompt files — the runner handles budget constraints
