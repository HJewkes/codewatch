# Task 02: Golden Corpus Fixtures

## Architectural Context

The project at `/Users/hjewkes/Documents/projects/code-style` is a pnpm monorepo that analyzes TypeScript code to detect coding style patterns. Extractors use web-tree-sitter to parse TypeScript ASTs and produce `Observation` objects. This task creates 10 synthetic TypeScript fixture files that form a "golden corpus" — a set of files with deliberate, consistent style patterns that integration tests can analyze and validate against expected observations.

All 10 files use the SAME style conventions so that a profile built from this corpus should have high-confidence, uniform rules. The extractors detect: naming conventions, import order, JSDoc presence, error handling patterns, formatting (semicolons/quotes), control flow patterns, and function length.

Files must be valid TypeScript syntax parseable by tree-sitter. They do NOT need to compile (fake imports/types are fine) but must NOT use `// @ts-nocheck`.

### Style Conventions (all files)

- **Variables**: camelCase
- **Functions**: camelCase
- **Types/interfaces**: PascalCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Imports**: builtin -> external -> internal -> relative (comment-separated groups, fake packages OK)
- **Documentation**: JSDoc on exported functions only (selective)
- **Error handling**: try/catch with typed errors, early returns for validation
- **Formatting**: no semicolons, single quotes (template literals OK)
- **Control flow**: prefer early returns/guard clauses, use optional chaining
- **Functions**: keep under 25 lines

## File Ownership

**May create:**
- `tests/integration/fixtures/corpus/typescript/service-user.ts`
- `tests/integration/fixtures/corpus/typescript/utils-string.ts`
- `tests/integration/fixtures/corpus/typescript/controller-auth.ts`
- `tests/integration/fixtures/corpus/typescript/model-payment.ts`
- `tests/integration/fixtures/corpus/typescript/config-app.ts`
- `tests/integration/fixtures/corpus/typescript/handler-webhook.ts`
- `tests/integration/fixtures/corpus/typescript/types-api.ts`
- `tests/integration/fixtures/corpus/typescript/middleware-logging.ts`
- `tests/integration/fixtures/corpus/typescript/repository-user.ts`
- `tests/integration/fixtures/corpus/typescript/routes-index.ts`

**May delete:**
- `tests/integration/fixtures/corpus/typescript/.gitkeep` (if it exists, after files are created)

**Must not touch:**
- `packages/**`
- `tests/integration/fixtures/exports/**`
- Any config files

## Steps

### Step 1: Create all 10 fixture files

Write each file to `tests/integration/fixtures/corpus/typescript/`. The complete contents of each file are below.

#### File 1: `service-user.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Errors: typed catch | Flow: early returns
import * as crypto from 'node:crypto'

import { z } from 'zod'

import { db } from '@app/database'
import type { Logger } from '@app/logging'

import { hashPassword } from './auth-utils'
import type { UserRow } from './types'

const MAX_LOGIN_ATTEMPTS = 5
const SESSION_TTL_MS = 3_600_000

interface UserCreateInput {
  name: string
  email: string
  password: string
}

interface UserResponse {
  id: string
  name: string
  email: string
}

/** Creates a new user and returns the sanitized response. */
export async function createUser(input: UserCreateInput): Promise<UserResponse> {
  if (!input.email?.includes('@')) {
    throw new ValidationError('email', 'Invalid email format')
  }

  const hashedPassword = await hashPassword(input.password)
  const userId = crypto.randomUUID()

  const row = await db.insert('users', {
    id: userId,
    name: input.name,
    email: input.email,
    password: hashedPassword,
  })

  return toUserResponse(row)
}

/** Finds a user by ID, returning null if not found. */
export async function findUserById(id: string): Promise<UserResponse | null> {
  if (!id) {
    return null
  }

  try {
    const row = await db.findOne('users', { id })
    return row ? toUserResponse(row) : null
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw new ServiceError('user_lookup_failed', error.message)
    }
    throw error
  }
}

function toUserResponse(row: UserRow): UserResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  }
}
```

#### File 2: `utils-string.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Flow: early returns, guard clauses

const DEFAULT_SEPARATOR = '-'
const MAX_SLUG_LENGTH = 80

interface TruncateOptions {
  maxLength: number
  suffix?: string
}

/** Converts a string to a URL-friendly slug. */
export function toSlug(input: string): string {
  if (!input) {
    return ''
  }

  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, DEFAULT_SEPARATOR)
    .replace(/^-|-$/g, '')

  return slug.slice(0, MAX_SLUG_LENGTH)
}

/** Truncates a string to the specified length with an optional suffix. */
export function truncate(text: string, options: TruncateOptions): string {
  const suffix = options.suffix ?? '...'

  if (text.length <= options.maxLength) {
    return text
  }

  return text.slice(0, options.maxLength - suffix.length) + suffix
}

/** Capitalizes the first letter of each word. */
export function titleCase(input: string): string {
  if (!input) {
    return ''
  }

  return input
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
```

#### File 3: `controller-auth.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Errors: typed catch | Flow: early returns
import * as crypto from 'node:crypto'

import { jwt } from 'jsonwebtoken'

import type { Request, Response } from '@app/http'
import { userService } from '@app/services'

import { validateCredentials } from './validation'

const TOKEN_EXPIRY_SECONDS = 3600
const REFRESH_TOKEN_BYTES = 32

interface AuthPayload {
  userId: string
  email: string
  role: string
}

interface LoginResult {
  accessToken: string
  refreshToken: string
}

/** Authenticates a user and returns JWT tokens. */
export async function login(req: Request): Promise<LoginResult> {
  const { email, password } = req.body

  if (!email || !password) {
    throw new AuthError('missing_credentials', 'Email and password required')
  }

  const user = await userService.verifyPassword(email, password)

  if (!user) {
    throw new AuthError('invalid_credentials', 'Wrong email or password')
  }

  const payload: AuthPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  }

  const accessToken = jwt.sign(payload, { expiresIn: TOKEN_EXPIRY_SECONDS })
  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex')

  return { accessToken, refreshToken }
}

/** Validates a refresh token and issues a new access token. */
export async function refresh(req: Request): Promise<{ accessToken: string }> {
  const tokenValue = req.headers?.authorization?.replace('Bearer ', '')

  if (!tokenValue) {
    throw new AuthError('missing_token', 'No refresh token provided')
  }

  try {
    const session = await userService.findSession(tokenValue)
    const accessToken = jwt.sign(session.payload, { expiresIn: TOKEN_EXPIRY_SECONDS })
    return { accessToken }
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new AuthError('token_expired', 'Refresh token has expired')
    }
    throw error
  }
}
```

#### File 4: `model-payment.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Flow: early returns

const MIN_AMOUNT_CENTS = 50
const MAX_AMOUNT_CENTS = 999_999_99

enum PaymentStatus {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed',
  Refunded = 'refunded',
}

enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

interface PaymentIntent {
  id: string
  amount: number
  currency: Currency
  status: PaymentStatus
  createdAt: Date
}

interface RefundRequest {
  paymentId: string
  reason: string
  amount?: number
}

/** Creates a validated payment intent from raw input. */
export function createPaymentIntent(
  amount: number,
  currency: Currency
): PaymentIntent {
  if (amount < MIN_AMOUNT_CENTS) {
    throw new PaymentError('amount_too_low', `Minimum is ${MIN_AMOUNT_CENTS} cents`)
  }

  if (amount > MAX_AMOUNT_CENTS) {
    throw new PaymentError('amount_too_high', `Maximum is ${MAX_AMOUNT_CENTS} cents`)
  }

  return {
    id: generatePaymentId(),
    amount,
    currency,
    status: PaymentStatus.Pending,
    createdAt: new Date(),
  }
}

/** Checks whether a payment can be refunded. */
export function isRefundable(payment: PaymentIntent): boolean {
  if (payment.status !== PaymentStatus.Completed) {
    return false
  }

  const ageMs = Date.now() - payment.createdAt.getTime()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return ageMs < thirtyDaysMs
}

function generatePaymentId(): string {
  return `pay_${Date.now().toString(36)}`
}
```

#### File 5: `config-app.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Flow: early returns
import * as path from 'node:path'
import * as fs from 'node:fs'

import { z } from 'zod'

import { logger } from '@app/logging'

const DEFAULT_PORT = 3000
const DEFAULT_LOG_LEVEL = 'info'
const CONFIG_FILE_NAME = 'app.config.json'

interface AppConfig {
  port: number
  logLevel: string
  databaseUrl: string
  corsOrigins: string[]
  enableMetrics: boolean
}

const ConfigSchema = z.object({
  port: z.number().default(DEFAULT_PORT),
  logLevel: z.string().default(DEFAULT_LOG_LEVEL),
  databaseUrl: z.string(),
  corsOrigins: z.array(z.string()).default([]),
  enableMetrics: z.boolean().default(false),
})

/** Loads application config from file with environment overrides. */
export function loadConfig(configDir: string): AppConfig {
  const filePath = path.join(configDir, CONFIG_FILE_NAME)

  if (!fs.existsSync(filePath)) {
    throw new ConfigError('file_not_found', `Config not found: ${filePath}`)
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)

  return applyEnvOverrides(ConfigSchema.parse(parsed))
}

/** Returns the default configuration values. */
export function getDefaults(): AppConfig {
  return {
    port: DEFAULT_PORT,
    logLevel: DEFAULT_LOG_LEVEL,
    databaseUrl: '',
    corsOrigins: [],
    enableMetrics: false,
  }
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const portOverride = process.env['PORT']
  const dbOverride = process.env['DATABASE_URL']

  return {
    ...config,
    port: portOverride ? parseInt(portOverride, 10) : config.port,
    databaseUrl: dbOverride ?? config.databaseUrl,
  }
}
```

#### File 6: `handler-webhook.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Errors: typed catch | Flow: early returns
import * as crypto from 'node:crypto'

import type { IncomingMessage } from '@app/http'
import { eventBus } from '@app/events'
import { logger } from '@app/logging'

import type { WebhookPayload } from './types'

const SIGNATURE_HEADER = 'x-webhook-signature'
const MAX_PAYLOAD_BYTES = 1_048_576

interface WebhookResult {
  accepted: boolean
  eventId: string | null
}

/** Processes an incoming webhook request with signature verification. */
export async function handleWebhook(
  message: IncomingMessage,
  secret: string
): Promise<WebhookResult> {
  const signature = message.headers?.[SIGNATURE_HEADER]

  if (!signature) {
    return { accepted: false, eventId: null }
  }

  const body = await readBody(message)

  if (!verifySignature(body, signature, secret)) {
    return { accepted: false, eventId: null }
  }

  try {
    const payload: WebhookPayload = JSON.parse(body)
    await eventBus.emit(payload.event, payload.data)
    return { accepted: true, eventId: payload.id }
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn('Invalid webhook JSON payload')
      return { accepted: false, eventId: null }
    }
    throw error
  }
}

/** Verifies an HMAC-SHA256 webhook signature. */
export function verifySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

async function readBody(message: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of message.stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}
```

#### File 7: `types-api.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only

const API_VERSION = 'v1'
const DEFAULT_PAGE_SIZE = 20

interface PaginationParams {
  page: number
  pageSize: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: ApiError
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface RouteDefinition {
  method: HttpMethod
  path: string
  auth: boolean
  rateLimit?: number
}

interface UserDto {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

interface CreateUserDto {
  name: string
  email: string
  password: string
  role?: string
}

/** Builds a success API response wrapper. */
export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data }
}

/** Builds an error API response wrapper. */
export function errorResponse(code: string, message: string): ApiResponse<never> {
  return { success: false, error: { code, message } }
}

/** Creates default pagination params from query values. */
export function defaultPagination(
  page?: number,
  pageSize?: number
): PaginationParams {
  return {
    page: page ?? 1,
    pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
  }
}
```

#### File 8: `middleware-logging.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Flow: early returns
import { performance } from 'node:perf_hooks'

import { logger } from '@app/logging'

import type { Middleware, RequestContext, NextFunction } from './types'

const SLOW_REQUEST_THRESHOLD_MS = 2000
const HEALTH_CHECK_PATH = '/health'

interface RequestLogEntry {
  method: string
  path: string
  statusCode: number
  durationMs: number
}

/** Creates a logging middleware that records request timing. */
export function createLoggingMiddleware(): Middleware {
  return async (ctx: RequestContext, next: NextFunction) => {
    if (ctx.path === HEALTH_CHECK_PATH) {
      return next()
    }

    const startTime = performance.now()

    await next()

    const durationMs = Math.round(performance.now() - startTime)
    const entry = buildLogEntry(ctx, durationMs)

    if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn('Slow request detected', entry)
    } else {
      logger.info('Request completed', entry)
    }
  }
}

/** Creates a middleware that adds a request ID header. */
export function createRequestIdMiddleware(): Middleware {
  return async (ctx: RequestContext, next: NextFunction) => {
    const requestId = ctx.headers?.['x-request-id'] ?? generateId()
    ctx.state = { ...ctx.state, requestId }
    return next()
  }
}

function buildLogEntry(ctx: RequestContext, durationMs: number): RequestLogEntry {
  return {
    method: ctx.method,
    path: ctx.path,
    statusCode: ctx.status ?? 200,
    durationMs,
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}
```

#### File 9: `repository-user.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Errors: typed catch | Flow: early returns

import type { DatabaseClient, QueryResult } from '@app/database'
import { logger } from '@app/logging'

import type { UserRow } from './types'

const USERS_TABLE = 'users'
const DEFAULT_LIMIT = 50

interface FindOptions {
  limit?: number
  offset?: number
  orderBy?: string
}

export class UserRepository {
  private client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  /** Finds a user by primary key. */
  async findById(id: string): Promise<UserRow | null> {
    if (!id) {
      return null
    }

    try {
      const result = await this.client.query(
        `SELECT * FROM ${USERS_TABLE} WHERE id = $1`,
        [id]
      )
      return result.rows[0] ?? null
    } catch (error) {
      if (error instanceof ConnectionError) {
        logger.error('Database connection failed during user lookup')
      }
      throw error
    }
  }

  /** Lists users with pagination support. */
  async findMany(options: FindOptions = {}): Promise<UserRow[]> {
    const limit = options.limit ?? DEFAULT_LIMIT
    const offset = options.offset ?? 0
    const orderBy = options.orderBy ?? 'created_at'

    const result = await this.client.query(
      `SELECT * FROM ${USERS_TABLE} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    return result.rows
  }

  /** Inserts a new user row and returns it. */
  async insert(row: Omit<UserRow, 'id'>): Promise<UserRow> {
    const result = await this.client.query(
      `INSERT INTO ${USERS_TABLE} (name, email, password) VALUES ($1, $2, $3) RETURNING *`,
      [row.name, row.email, row.password]
    )

    return result.rows[0]
  }

  /** Deletes a user by ID, returning true if a row was removed. */
  async deleteById(id: string): Promise<boolean> {
    if (!id) {
      return false
    }

    const result = await this.client.query(
      `DELETE FROM ${USERS_TABLE} WHERE id = $1`,
      [id]
    )

    return result.rowCount > 0
  }
}
```

#### File 10: `routes-index.ts`

```typescript
// Style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
// Formatting: no semicolons, single quotes
// Docs: JSDoc on exports only | Flow: early returns

import type { Router, RouteHandler } from '@app/http'
import { logger } from '@app/logging'

import { login, refresh } from './controller-auth'
import { handleWebhook } from './handler-webhook'
import { createLoggingMiddleware } from './middleware-logging'

const API_PREFIX = '/api/v1'
const WEBHOOK_PATH = '/webhooks'

interface RouteConfig {
  method: string
  path: string
  handler: RouteHandler
  auth: boolean
}

/** Registers all application routes on the given router. */
export function registerRoutes(router: Router): void {
  const routes = buildRouteTable()

  for (const route of routes) {
    const fullPath = `${API_PREFIX}${route.path}`
    router.register(route.method, fullPath, route.handler)
    logger.info(`Registered route: ${route.method} ${fullPath}`)
  }

  router.use(createLoggingMiddleware())
}

/** Returns the number of registered route definitions. */
export function getRouteCount(): number {
  return buildRouteTable().length
}

function buildRouteTable(): RouteConfig[] {
  return [
    { method: 'POST', path: '/auth/login', handler: login, auth: false },
    { method: 'POST', path: '/auth/refresh', handler: refresh, auth: true },
    { method: 'POST', path: WEBHOOK_PATH, handler: handleWebhook, auth: false },
  ]
}
```

### Step 2: Remove .gitkeep if present

```bash
rm -f tests/integration/fixtures/corpus/typescript/.gitkeep
```

### Step 3: Verify syntax

Verify all files are parseable by running a quick check (not a compilation, just syntax validation):

```bash
cd /Users/hjewkes/Documents/projects/code-style
for f in tests/integration/fixtures/corpus/typescript/*.ts; do
  echo "Checking $f..."
  npx tsc --noEmit --allowJs --checkJs false --strict false "$f" 2>&1 | head -5 || true
done
```

Note: Files may show type errors for undefined types (DatabaseError, ValidationError, etc.) — this is expected and acceptable. The key requirement is that tree-sitter can parse the syntax.

### Step 4: Commit

```bash
git add tests/integration/fixtures/corpus/typescript/
git commit -m "Add golden corpus TypeScript fixtures for integration tests"
```

## Success Criteria

- [ ] All 10 `.ts` files exist in `tests/integration/fixtures/corpus/typescript/`
- [ ] Every file uses consistent style: camelCase vars/fns, PascalCase types, SCREAMING_SNAKE constants
- [ ] Every file uses no semicolons and single quotes
- [ ] Every exported function has a JSDoc comment; no private/internal functions have JSDoc
- [ ] Import order in files with imports: builtin -> external -> internal -> relative
- [ ] Files are 30-60 lines each
- [ ] Files are syntactically valid TypeScript (parseable by tree-sitter)
- [ ] No `// @ts-nocheck` directives

## Anti-patterns

### Universal
1. Do not modify files outside the ownership list above
2. Do not modify CLAUDE.md or any persistent configuration files
3. Do not add features beyond what is specified in the steps

### Task-specific
4. Do not use `// @ts-nocheck` — files must be syntactically valid
5. Do not use double quotes (except in template literals) — the corpus uses single quotes
6. Do not add semicolons — the corpus uses no-semicolons style
7. Do not add JSDoc to private/internal functions — only exported functions get JSDoc
8. Do not create an `expected-profile.json` — that is derived by the test itself
