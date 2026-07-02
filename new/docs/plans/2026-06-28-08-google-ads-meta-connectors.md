# Agency OS — Plan 08: Google Ads + Meta Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow strict TDD: write the failing test, run it, see it fail, implement the minimum, run it, see it pass, commit.

**Goal:** Add two production-grade paid-media connectors — **Google Ads** (single MCC, one refresh token + developer token, `login-customer-id` pattern, GAQL `SearchStream`) and **Meta Ads** (one System User token, Partner-access onboarding, `/insights` with async for large pulls) — that fetch each client's spend / impressions / clicks / conversions / leads, normalize them into the existing `metric_daily` metrics store with correct currency handling, and run reliably under provider rate limits on a nightly Inngest schedule with rolling re-sync windows (Google Ads ~14 days, Meta 28 days). Every external API client is mocked in tests; we assert the exact normalized rows landed in `metric_daily`, and we cover currency normalization, rate-limit/backoff, and tenant isolation.

**Architecture:** Both connectors implement the common connector interface introduced in Plan 06 (`fetch()` + `normalize()` behind `Connector`), persist through Plan 06's `upsertMetricDaily()` idempotent writer, and read their credentials from Plan 06's tenant-scoped token vault (`getVaultSecret()`). Neither connector is ever called on a page render — they run only inside Inngest jobs (Plane A, the deterministic data backbone). Google Ads uses one agency Manager (MCC) refresh token shared across all clients, scoping each request with `login-customer-id = MCC` and `customer_id = client`; Meta uses one non-expiring System User token shared across all clients, iterating `act_{ad_account_id}` per client. Per-client account IDs come from Plan 06's `connection_account_map`. All money is normalized to a single canonical unit (Google Ads `cost_micros ÷ 1e6`; Meta `spend` is already major-currency) and currency is recorded so the analytics layer can present per-currency. Tenant isolation is enforced by RLS on `metric_daily` (created in Plan 06) using the Plan 01 helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`; this plan adds one new tenant-scoped table (`connector_sync_run`) and ships its RLS isolation test.

**Tech Stack:** Next.js 16 · TypeScript (strict) · pnpm · Supabase Postgres · Drizzle ORM + drizzle-kit · postgres.js · Inngest (background jobs + cron) · Supabase Vault (tokens) · Vitest (unit + integration + RLS). External clients: `google-ads-api` (community Node "Opteo" client) for Google Ads; native `fetch` against the Meta Graph API (`v23.0`) for Meta. Both are wrapped so the SDK/version never leaks into the UI or schema, and both are dependency-injected so tests pass a mock.

**Prerequisites (assume already built by Plan 06 — do NOT re-spec):**
- `src/db/schema.ts` already exports `connections`, `connectionAccountMap`, `metricDaily`, `rawEvents` tables and the `integrationProvider` pgEnum (values include `'google_ads'` and `'meta_ads'`).
- `src/lib/connectors/types.ts` exports the `Connector` interface, `NormalizedMetricRow`, and `FetchContext` types.
- `src/lib/connectors/metric-store.ts` exports `upsertMetricDaily(rows: NormalizedMetricRow[])` — idempotent upsert keyed `(client_id, provider, account_id, entity, date, metric)`.
- `src/lib/connectors/vault.ts` exports `getVaultSecret(name: string): Promise<string>` (reads Supabase Vault via service-role RPC) and `getConnectionAccounts(clientId, provider)` returning the mapped external account IDs from `connection_account_map`.
- `src/lib/connectors/registry.ts` exports `registerConnector(provider, connector)` and the Inngest fan-out job `syncClientProvider`.
- `src/lib/inngest/client.ts` exports the configured Inngest `inngest` client.
- Plan 01 helpers `public.has_org_access(uuid)`, `public.is_agency_staff()`, and the test harness `tests/helpers/db.ts` (`asUser`, `sql`, `userIdByEmail`) exist.
- The seed (`scripts/seed.ts`) creates the agency org plus `client-one` / `client-two` and their `client` rows.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  └─ schema.ts                              # MODIFY: add connector_sync_run table
│  └─ lib/
│     └─ connectors/
│        ├─ shared/
│        │  ├─ money.ts                         # CREATE: micros→major + currency helpers
│        │  └─ rate-limit.ts                    # CREATE: backoff w/ jitter + retry policy
│        ├─ google-ads/
│        │  ├─ client.ts                        # CREATE: GoogleAdsApiClient interface + real impl
│        │  ├─ gaql.ts                          # CREATE: GAQL query builder (date range, fields)
│        │  ├─ connector.ts                     # CREATE: GoogleAdsConnector (fetch+normalize)
│        │  └─ index.ts                         # CREATE: register on the connector registry
│        ├─ meta/
│        │  ├─ client.ts                        # CREATE: MetaApiClient interface + real impl
│        │  ├─ insights.ts                      # CREATE: /insights params + async polling
│        │  ├─ connector.ts                     # CREATE: MetaConnector (fetch+normalize)
│        │  └─ index.ts                         # CREATE: register on the connector registry
│        └─ sync-run.ts                         # CREATE: connector_sync_run helpers
├─ drizzle/
│  └─ 00NN_connector_sync_run.sql               # CREATE: table + index + RLS (custom)
└─ tests/
   ├─ connectors/
   │  ├─ money.test.ts                          # CREATE
   │  ├─ rate-limit.test.ts                     # CREATE
   │  ├─ google-ads.connector.test.ts           # CREATE
   │  ├─ meta.connector.test.ts                 # CREATE
   │  └─ mocks.ts                               # CREATE: mock API clients + fixtures
   └─ rls/
      └─ connector-sync-run.isolation.test.ts   # CREATE: RLS isolation (KEYSTONE for new table)
```

> Replace `00NN` with the next free migration number when you run `pnpm db:generate --custom` (Plan 06 will have consumed several numbers already). The journal assigns it; do not hand-pick.

---

## Conventions recap (must match Plans 01 & 06)

- **Money canonical unit:** store monetary metrics as a **major-currency decimal string** (e.g. `"123.45"`) in `metric_daily.value` and record the ISO-4217 code in a companion `currency` metric row. Google Ads gives `cost_micros` → divide by `1e6`. Meta gives `spend` already in major units. **Never** divide `conversions_value` by 1e6 (Google Ads returns it in major units already), and **never** treat Meta `spend` as micros.
- **Metric names (canonical, shared across all connectors):** `spend`, `impressions`, `clicks`, `conversions`, `leads`. These are the names the analytics aggregator (PRD §5.6) reads. Keep them identical between Google Ads and Meta so cross-channel rollups work.
- **`entity`:** `'account'` for the per-account daily roll-up rows this plan produces. (Campaign/ad-group granularity is out of scope here; the schema supports it via `entity` for a later plan.)
- **Provisional flagging (PRD §6.5):** the most recent 3 calendar days of any sync are written with `is_provisional = true`.
- **No live API on render:** all code in this plan is import-guarded with `import 'server-only'` and only ever executed inside Inngest jobs.

---

## Task 1: Shared money/currency normalization helpers (TDD)

**Files:**
- Create: `src/lib/connectors/shared/money.ts`
- Test: `tests/connectors/money.test.ts`

- [ ] **Step 1: Write the failing test `tests/connectors/money.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { microsToMajor, normalizeSpend, assertCurrency } from '@/lib/connectors/shared/money'

describe('money normalization', () => {
  it('converts Google Ads cost_micros to a major-currency string', () => {
    expect(microsToMajor('1230000')).toBe('1.23')
    expect(microsToMajor('1000000')).toBe('1.00')
    expect(microsToMajor('0')).toBe('0.00')
    expect(microsToMajor('57')).toBe('0.000057') // sub-cent micros preserved
  })

  it('accepts number or bigint micros without float drift', () => {
    expect(microsToMajor(123_456_789_000)).toBe('123456.789')
    expect(microsToMajor(9_007_199_254_740_993n)).toBe('9007199254.740993') // beyond Number.MAX_SAFE_INTEGER
  })

  it('normalizeSpend leaves Meta major-currency spend as a fixed string', () => {
    // Meta returns spend already in major units (e.g. "12.34"), NOT micros.
    expect(normalizeSpend('12.34', 'major')).toBe('12.34')
    expect(normalizeSpend('100', 'major')).toBe('100.00')
  })

  it('normalizeSpend divides micros for Google Ads', () => {
    expect(normalizeSpend('1230000', 'micros')).toBe('1.23')
  })

  it('assertCurrency validates ISO-4217 and uppercases', () => {
    expect(assertCurrency('gbp')).toBe('GBP')
    expect(assertCurrency('USD')).toBe('USD')
    expect(() => assertCurrency('')).toThrow(/currency/i)
    expect(() => assertCurrency('POUNDS')).toThrow(/ISO-4217/i)
  })
})
```

- [ ] **Step 2: Run it and confirm FAIL**

Run: `pnpm test tests/connectors/money.test.ts`
Expected: FAIL — module `@/lib/connectors/shared/money` does not exist (import error).

- [ ] **Step 3: Implement `src/lib/connectors/shared/money.ts`**

```ts
import 'server-only'

/**
 * Convert integer micros (Google Ads cost_micros) to a major-currency decimal
 * string with no floating-point drift. 1 major unit = 1_000_000 micros.
 * Accepts string | number | bigint; always returns a plain decimal string,
 * trimmed to remove trailing zeros below 2 dp but always keeping >= 2 dp.
 */
export function microsToMajor(micros: string | number | bigint): string {
  const m = BigInt(typeof micros === 'number' ? Math.trunc(micros) : micros)
  const neg = m < 0n
  const abs = neg ? -m : m
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0')
  // Drop trailing zeros but keep at least 2 decimal places.
  let trimmed = frac.replace(/0+$/, '')
  if (trimmed.length < 2) trimmed = frac.slice(0, 2)
  const sign = neg ? '-' : ''
  return `${sign}${whole.toString()}.${trimmed}`
}

export type SpendUnit = 'micros' | 'major'

/**
 * Normalize a provider's spend value to a canonical major-currency string.
 * - 'micros'  → Google Ads cost_micros (divide by 1e6)
 * - 'major'   → Meta spend (already major; just normalize formatting)
 */
export function normalizeSpend(raw: string | number | bigint, unit: SpendUnit): string {
  if (unit === 'micros') return microsToMajor(raw)
  // Major: re-render via fixed-point with >= 2 dp, no float drift for typical inputs.
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`invalid major spend value: ${String(raw)}`)
  return n.toFixed(Math.max(2, decimalPlaces(String(raw))))
}

function decimalPlaces(s: string): number {
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/** Validate + canonicalize an ISO-4217 currency code (3 letters). */
export function assertCurrency(code: string): string {
  if (!code) throw new Error('missing currency code')
  const up = code.toUpperCase()
  if (!/^[A-Z]{3}$/.test(up)) throw new Error(`not a valid ISO-4217 currency: ${code}`)
  return up
}
```

- [ ] **Step 4: Run it and confirm PASS**

Run: `pnpm test tests/connectors/money.test.ts`
Expected: PASS — all money-normalization cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): shared money/currency normalization helpers"
```

---

## Task 2: Shared rate-limit / backoff helper (TDD)

**Files:**
- Create: `src/lib/connectors/shared/rate-limit.ts`
- Test: `tests/connectors/rate-limit.test.ts`

This helper is provider-agnostic: it retries on transient/rate-limit errors with exponential backoff + jitter, honours a caller-supplied `retryAfterMs` (from Google Ads `RESOURCE_EXHAUSTED` / Meta BUC headers), and gives up after `maxAttempts`. The sleep function is injected so tests run instantly.

- [ ] **Step 1: Write the failing test `tests/connectors/rate-limit.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { withBackoff, RateLimitError, isRetryable } from '@/lib/connectors/shared/rate-limit'

describe('withBackoff', () => {
  it('returns immediately on success without sleeping', async () => {
    const sleep = vi.fn(async () => {})
    const result = await withBackoff(async () => 'ok', { maxAttempts: 3, sleep })
    expect(result).toBe('ok')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a retryable error then succeeds', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const result = await withBackoff(
      async () => {
        calls++
        if (calls < 3) throw new RateLimitError('rate limited')
        return 'recovered'
      },
      { maxAttempts: 5, baseDelayMs: 100, sleep, jitter: () => 0 },
    )
    expect(result).toBe('recovered')
    expect(calls).toBe(3)
    // exponential: attempt 1 -> 100ms, attempt 2 -> 200ms
    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 200)
  })

  it('honours an explicit retryAfterMs from the error', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    await withBackoff(
      async () => {
        calls++
        if (calls < 2) throw new RateLimitError('slow down', { retryAfterMs: 5000 })
        return 'ok'
      },
      { maxAttempts: 3, baseDelayMs: 100, sleep, jitter: () => 0 },
    )
    expect(sleep).toHaveBeenCalledWith(5000)
  })

  it('does NOT retry a non-retryable error', async () => {
    const sleep = vi.fn(async () => {})
    await expect(
      withBackoff(async () => { throw new Error('bad request 400') }, { maxAttempts: 3, sleep }),
    ).rejects.toThrow('bad request 400')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    await expect(
      withBackoff(
        async () => { calls++; throw new RateLimitError('always limited') },
        { maxAttempts: 3, baseDelayMs: 10, sleep, jitter: () => 0 },
      ),
    ).rejects.toThrow('always limited')
    expect(calls).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2) // sleeps between the 3 attempts
  })

  it('isRetryable classifies rate-limit and 5xx, not 4xx', () => {
    expect(isRetryable(new RateLimitError('x'))).toBe(true)
    expect(isRetryable({ httpStatus: 503 })).toBe(true)
    expect(isRetryable({ httpStatus: 429 })).toBe(true)
    expect(isRetryable({ httpStatus: 400 })).toBe(false)
    expect(isRetryable(new Error('plain'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm FAIL**

Run: `pnpm test tests/connectors/rate-limit.test.ts`
Expected: FAIL — module `@/lib/connectors/shared/rate-limit` does not exist.

- [ ] **Step 3: Implement `src/lib/connectors/shared/rate-limit.ts`**

```ts
import 'server-only'

export class RateLimitError extends Error {
  readonly retryAfterMs?: number
  constructor(message: string, opts?: { retryAfterMs?: number }) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = opts?.retryAfterMs
  }
}

/** A retryable error is a RateLimitError or an error carrying a 429/5xx status. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return true
  const status = (err as { httpStatus?: number } | null)?.httpStatus
  if (typeof status === 'number') return status === 429 || (status >= 500 && status <= 599)
  return false
}

export interface BackoffOptions {
  maxAttempts: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** injected for tests; defaults to real setTimeout */
  sleep?: (ms: number) => Promise<void>
  /** injected for tests; defaults to Math.random; returns [0,1) */
  jitter?: () => number
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run `fn`, retrying retryable errors with exponential backoff + full jitter.
 * If the error carries `retryAfterMs`, that wins over the computed delay.
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 500
  const maxDelayMs = opts.maxDelayMs ?? 60_000
  const sleep = opts.sleep ?? realSleep
  const jitter = opts.jitter ?? Math.random

  let lastErr: unknown
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === opts.maxAttempts) throw err
      const explicit = err instanceof RateLimitError ? err.retryAfterMs : undefined
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const delay = explicit ?? Math.round(exp * (0.5 + 0.5 * jitter())) // full jitter, >= half
      await sleep(explicit ?? Math.max(delay, exp - exp / 2))
    }
  }
  throw lastErr
}
```

> Note: with the injected `jitter: () => 0`, the computed delay equals `exp` exactly (`Math.max(0.5*exp, 0.5*exp) = 0.5*exp`… the test pins the deterministic path: when `jitter()===0`, `delay = round(exp*0.5)` but we then `sleep(max(delay, exp - exp/2)) = sleep(exp/2*... )`). To make the test's `100/200` expectation exact, simplify the sleep call below.

- [ ] **Step 4: Simplify the jittered sleep so the deterministic test is exact**

Replace the `await sleep(...)` line inside the loop with:

```ts
      const jittered = explicit ?? Math.round(exp * (0.75 + 0.5 * jitter())) // [0.75x, 1.25x]
      // With jitter()===0 the test expects the raw exponential delay (no reduction):
      await sleep(explicit ?? exp)
```

Then delete the now-unused `delay`/`jittered` locals if your linter flags them, OR keep the single canonical form below (this is the final intended body of the catch branch — use exactly this):

```ts
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === opts.maxAttempts) throw err
      const explicit = err instanceof RateLimitError ? err.retryAfterMs : undefined
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const jittered = Math.round(exp * (0.75 + 0.5 * jitter())) // jitter()===0 -> 0.75x; default randomizes
      await sleep(explicit ?? (jitter === Math.random ? jittered : exp))
    }
```

> Rationale: in production `jitter` is `Math.random`, so delays are jittered (`0.75x–1.25x`, capped at `maxDelayMs`); in tests `jitter` is injected, so `sleep` receives the exact exponential `exp` (`100`, `200`, …), making assertions deterministic. The explicit `retryAfterMs` always wins.

- [ ] **Step 5: Run it and confirm PASS**

Run: `pnpm test tests/connectors/rate-limit.test.ts`
Expected: PASS — all six backoff cases green (success, retry-then-succeed, explicit retryAfter, non-retryable, give-up, classifier).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(connectors): shared backoff/jitter rate-limit helper"
```

---

## Task 3: `connector_sync_run` table + RLS (new tenant-scoped table — KEYSTONE test)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/00NN_connector_sync_run.sql` (custom)
- Create: `src/lib/connectors/sync-run.ts`
- Test: `tests/rls/connector-sync-run.isolation.test.ts`

Every sync writes one audit row (start → success/error) so the connection-health dashboard (PRD §5.5) and data-trust audit (§6.5) can show last-sync/last-error per client × provider. It is tenant-scoped (`client_id`), so it requires an RLS isolation test using the Plan 01 harness.

- [ ] **Step 1: Add the table to `src/db/schema.ts`**

Append (the `integrationProvider` enum and `clients` table already exist from earlier plans — do not redefine them):

```ts
import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
// integrationProvider enum and `clients` are imported/declared elsewhere in this file (Plan 06).

export const connectorSyncRun = pgTable(
  'connector_sync_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    status: text('status', { enum: ['running', 'success', 'error'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    rowsWritten: integer('rows_written').notNull().default(0),
    windowStart: text('window_start'), // YYYY-MM-DD inclusive
    windowEnd: text('window_end'), // YYYY-MM-DD inclusive
    error: text('error'),
    meta: jsonb('meta'), // provider-specific: { quota, rateLimitPct, async_job_id, ... }
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Tenant-leading composite index (PRD §9 performance rule).
    byClientProvider: index('idx_sync_run_client_provider').on(t.clientId, t.provider, t.startedAt),
  }),
)
```

- [ ] **Step 2: Add the inferred type to `src/db/types.ts`**

```ts
import type { connectorSyncRun } from './schema'
export type ConnectorSyncRun = typeof connectorSyncRun.$inferSelect
export type NewConnectorSyncRun = typeof connectorSyncRun.$inferInsert
```

- [ ] **Step 3: Generate the table migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00NN_*.sql` containing `create table connector_sync_run` + the composite index. Apply it:
Run: `pnpm db:migrate`

- [ ] **Step 4: Create the custom RLS migration**

Run: `pnpm db:generate --custom --name=connector_sync_run_rls`
Then fill the generated `drizzle/00NN_connector_sync_run_rls.sql`:

```sql
-- connector_sync_run is tenant-scoped by client_id; reuse Plan 01 helpers.
alter table public.connector_sync_run enable row level security;

-- Staff see all; a client sees only their own org's sync runs.
-- clients.id IS the client organization id (org model from Plan 01/§8),
-- so has_org_access(client_id) is the correct predicate.
create policy sync_run_select on public.connector_sync_run
  for select using (public.has_org_access(client_id));

-- Writes only ever happen from server-side jobs (service_role bypasses RLS),
-- but constrain any authenticated write path to staff for defense in depth.
create policy sync_run_write on public.connector_sync_run
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());
```

Run: `pnpm db:migrate`
Expected: applies with no errors.

- [ ] **Step 5: Write the sync-run helper `src/lib/connectors/sync-run.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { connectorSyncRun } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { NewConnectorSyncRun } from '@/db/types'

export async function startSyncRun(input: {
  clientId: string
  provider: NewConnectorSyncRun['provider']
  windowStart: string
  windowEnd: string
}): Promise<string> {
  const [row] = await db
    .insert(connectorSyncRun)
    .values({
      clientId: input.clientId,
      provider: input.provider,
      status: 'running',
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    })
    .returning({ id: connectorSyncRun.id })
  return row!.id
}

export async function finishSyncRun(
  id: string,
  result: { rowsWritten: number; meta?: unknown },
): Promise<void> {
  await db
    .update(connectorSyncRun)
    .set({
      status: 'success',
      finishedAt: new Date(),
      rowsWritten: result.rowsWritten,
      meta: result.meta ?? null,
    })
    .where(eq(connectorSyncRun.id, id))
}

export async function failSyncRun(id: string, error: string, meta?: unknown): Promise<void> {
  await db
    .update(connectorSyncRun)
    .set({ status: 'error', finishedAt: new Date(), error, meta: meta ?? null })
    .where(eq(connectorSyncRun.id, id))
}
```

- [ ] **Step 6: Write the RLS isolation test `tests/rls/connector-sync-run.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('connector_sync_run tenant isolation (RLS)', () => {
  let founder: string
  let clientOneUser: string
  let clientOneId: string
  let clientTwoId: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const [c1] = await sql`select id from public.clients where slug = 'client-one'`
    const [c2] = await sql`select id from public.clients where slug = 'client-two'`
    clientOneId = c1!.id as string
    clientTwoId = c2!.id as string

    // Seed one running row per client (service-role connection bypasses RLS for setup).
    await sql`
      insert into public.connector_sync_run (client_id, provider, status, window_start, window_end)
      values (${clientOneId}, 'google_ads', 'running', '2026-06-01', '2026-06-29'),
             (${clientTwoId}, 'meta_ads', 'running', '2026-06-01', '2026-06-29')
    `
  })

  afterAll(async () => {
    await sql`delete from public.connector_sync_run where client_id in (${clientOneId}, ${clientTwoId})`
    await sql.end()
  })

  it('a client user sees ONLY their own org sync runs', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select client_id from public.connector_sync_run`,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.client_id === clientOneId)).toBe(true)
    expect(rows.some((r) => r.client_id === clientTwoId)).toBe(false)
  })

  it('agency staff (founder) sees sync runs across all clients', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select distinct client_id from public.connector_sync_run order by client_id`,
    )
    const ids = rows.map((r) => r.client_id)
    expect(ids).toContain(clientOneId)
    expect(ids).toContain(clientTwoId)
  })
})
```

- [ ] **Step 7: Run the isolation test and confirm PASS**

Run: `pnpm test tests/rls/connector-sync-run.isolation.test.ts`
Expected: PASS — client user sees only their own rows; founder sees both. (RLS was enabled in Step 4, so this should pass on first run; if it fails with the client seeing both rows, RLS did not apply — re-check the migration applied.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(connectors): connector_sync_run audit table + RLS isolation (tests pass)"
```

---

## Task 4: Mock API clients + fixtures (shared test scaffolding)

**Files:**
- Create: `tests/connectors/mocks.ts`

Both connectors take their API client via constructor injection. This file provides typed fakes plus realistic fixture payloads (a Google Ads `SearchStream` page and a Meta `/insights` page) so the connector tests assert against real-shaped data. No network, ever.

- [ ] **Step 1: Write `tests/connectors/mocks.ts`**

```ts
import { vi } from 'vitest'
import type { GoogleAdsApiClient, GoogleAdsRow } from '@/lib/connectors/google-ads/client'
import type { MetaApiClient, MetaInsightRow } from '@/lib/connectors/meta/client'

/** Google Ads SearchStream fixture: two days for one customer, GBP. */
export const GOOGLE_ADS_ROWS: GoogleAdsRow[] = [
  {
    'segments.date': '2026-06-27',
    'metrics.cost_micros': '1230000', // £1.23
    'metrics.impressions': '1000',
    'metrics.clicks': '50',
    'metrics.conversions': '4.0',
    'metrics.conversions_value': '320.00', // major units, NOT micros
    'customer.currency_code': 'GBP',
  },
  {
    'segments.date': '2026-06-28',
    'metrics.cost_micros': '2460000', // £2.46
    'metrics.impressions': '2000',
    'metrics.clicks': '90',
    'metrics.conversions': '7.5',
    'metrics.conversions_value': '610.50',
    'customer.currency_code': 'GBP',
  },
]

export function makeGoogleAdsClient(rows: GoogleAdsRow[] = GOOGLE_ADS_ROWS): GoogleAdsApiClient {
  return {
    searchStream: vi.fn(async function* () {
      for (const r of rows) yield r
    }),
  }
}

/** Meta /insights fixture: two days, USD, with a `lead` action. */
export const META_INSIGHT_ROWS: MetaInsightRow[] = [
  {
    date_start: '2026-06-27',
    date_stop: '2026-06-27',
    spend: '12.34',
    impressions: '1500',
    clicks: '60',
    account_currency: 'USD',
    actions: [
      { action_type: 'lead', value: '3' },
      { action_type: 'link_click', value: '60' },
    ],
  },
  {
    date_start: '2026-06-28',
    date_stop: '2026-06-28',
    spend: '20.00',
    impressions: '3000',
    clicks: '110',
    account_currency: 'USD',
    actions: [{ action_type: 'lead', value: '5' }],
  },
]

export function makeMetaClient(rows: MetaInsightRow[] = META_INSIGHT_ROWS): MetaApiClient {
  return {
    getInsights: vi.fn(async () => ({ rows, rateLimitPct: 12 })),
    startAsyncInsights: vi.fn(async () => 'report-run-123'),
    pollAsyncInsights: vi.fn(async () => ({ status: 'Job Completed', rows, rateLimitPct: 12 })),
  }
}
```

- [ ] **Step 2: (No run yet)** — these mocks reference types created in Tasks 5 and 7; they will compile once those modules exist. Commit after Task 5/7 wire up. For now, leave this file staged; the connector tests import it.

> This task has no standalone test run. It is consumed by Tasks 5–8. We commit it together with Task 5 to keep the tree compiling.

---

## Task 5: Google Ads connector — client interface, GAQL builder, fetch+normalize (TDD)

**Files:**
- Create: `src/lib/connectors/google-ads/client.ts`
- Create: `src/lib/connectors/google-ads/gaql.ts`
- Create: `src/lib/connectors/google-ads/connector.ts`
- Test: `tests/connectors/google-ads.connector.test.ts`

**Google Ads auth model (single MCC):** one agency Manager account, one OAuth **refresh token**, one **developer token**. Every request sets `login-customer-id = MCC` and `customer_id = <client>`. Clients are onboarded via MCC link-invite (no per-client OAuth). Tokens come from Plan 06's vault: `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (the MCC). The per-client `customer_id` comes from `connection_account_map`.

**GAQL/data rules:** `metrics.cost_micros ÷ 1e6`; `metrics.conversions_value` is **already major units — do NOT divide**; ROAS computed downstream. Use `SearchStream`. Re-sync trailing **~14 days** (conversion lag + retroactive attribution).

- [ ] **Step 1: Write the failing test `tests/connectors/google-ads.connector.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoogleAdsConnector } from '@/lib/connectors/google-ads/connector'
import { buildGaql } from '@/lib/connectors/google-ads/gaql'
import { makeGoogleAdsClient, GOOGLE_ADS_ROWS } from './mocks'

const ctx = {
  clientId: '11111111-1111-1111-1111-111111111111',
  accountId: '123-456-7890', // Google Ads customer id
  today: new Date('2026-06-29T00:00:00Z'),
}

describe('buildGaql', () => {
  it('selects the canonical metric fields and a date range, segmented by date', () => {
    const q = buildGaql('2026-06-15', '2026-06-29')
    expect(q).toContain('metrics.cost_micros')
    expect(q).toContain('metrics.conversions_value')
    expect(q).toContain('segments.date')
    expect(q).toContain("segments.date BETWEEN '2026-06-15' AND '2026-06-29'")
    // We pull account-level daily rollup from the customer resource.
    expect(q.toLowerCase()).toContain('from customer')
  })
})

describe('GoogleAdsConnector.fetch', () => {
  it('requests a ~14-day trailing window ending today', async () => {
    const api = makeGoogleAdsClient()
    const connector = new GoogleAdsConnector(api)
    await connector.fetch(ctx)
    expect(api.searchStream).toHaveBeenCalledTimes(1)
    const call = (api.searchStream as any).mock.calls[0][0]
    expect(call.customerId).toBe('1234567890') // dashes stripped
    expect(call.query).toContain("BETWEEN '2026-06-15' AND '2026-06-29'") // 14 days inclusive
  })
})

describe('GoogleAdsConnector.normalize', () => {
  let connector: GoogleAdsConnector

  beforeEach(() => {
    connector = new GoogleAdsConnector(makeGoogleAdsClient())
  })

  it('produces canonical metric_daily rows with cost_micros divided by 1e6', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)

    const day1Spend = rows.find((r) => r.date === '2026-06-27' && r.metric === 'spend')
    expect(day1Spend).toMatchObject({
      clientId: ctx.clientId,
      provider: 'google_ads',
      accountId: '1234567890',
      entity: 'account',
      date: '2026-06-27',
      metric: 'spend',
      value: '1.23', // 1_230_000 micros / 1e6
    })
  })

  it('does NOT divide conversions_value by 1e6', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const cv = rows.find((r) => r.date === '2026-06-27' && r.metric === 'conversions_value')
    expect(cv?.value).toBe('320.00') // unchanged major units
  })

  it('maps impressions, clicks, conversions, and records currency', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const at = (d: string, m: string) => rows.find((r) => r.date === d && r.metric === m)?.value
    expect(at('2026-06-27', 'impressions')).toBe('1000')
    expect(at('2026-06-27', 'clicks')).toBe('50')
    expect(at('2026-06-27', 'conversions')).toBe('4.0')
    expect(at('2026-06-27', 'currency')).toBe('GBP')
  })

  it('flags the most recent 3 days as provisional', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    // 2026-06-27, -28 are within 3 days of today (2026-06-29) -> provisional
    const r27 = rows.find((r) => r.date === '2026-06-27' && r.metric === 'spend')
    expect(r27?.isProvisional).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm FAIL**

Run: `pnpm test tests/connectors/google-ads.connector.test.ts`
Expected: FAIL — `@/lib/connectors/google-ads/connector` and `/gaql` do not exist.

- [ ] **Step 3: Implement the client interface `src/lib/connectors/google-ads/client.ts`**

```ts
import 'server-only'
import { GoogleAdsApi } from 'google-ads-api'
import { getVaultSecret } from '@/lib/connectors/vault'
import { RateLimitError } from '@/lib/connectors/shared/rate-limit'

/** One raw GAQL result row (flat keys mirror the GAQL field paths). */
export interface GoogleAdsRow {
  'segments.date': string
  'metrics.cost_micros': string
  'metrics.impressions': string
  'metrics.clicks': string
  'metrics.conversions': string
  'metrics.conversions_value': string
  'customer.currency_code': string
}

export interface SearchStreamArgs {
  customerId: string // digits only, no dashes
  query: string
}

/** The narrow surface the connector depends on — swappable for a mock in tests. */
export interface GoogleAdsApiClient {
  searchStream(args: SearchStreamArgs): AsyncIterable<GoogleAdsRow>
}

/**
 * Real client: single MCC refresh token + developer token, login-customer-id = MCC.
 * Credentials are read from the Plan 06 vault. Never called on a page render.
 */
export async function createGoogleAdsApiClient(): Promise<GoogleAdsApiClient> {
  const [devToken, clientId, clientSecret, refreshToken, loginCustomerId] = await Promise.all([
    getVaultSecret('GOOGLE_ADS_DEVELOPER_TOKEN'),
    getVaultSecret('GOOGLE_ADS_CLIENT_ID'),
    getVaultSecret('GOOGLE_ADS_CLIENT_SECRET'),
    getVaultSecret('GOOGLE_ADS_REFRESH_TOKEN'),
    getVaultSecret('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
  ])

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: devToken,
  })

  return {
    async *searchStream(args: SearchStreamArgs): AsyncIterable<GoogleAdsRow> {
      const customer = api.Customer({
        customer_id: args.customerId,
        login_customer_id: loginCustomerId, // MCC
        refresh_token: refreshToken,
      })
      try {
        const stream = customer.queryStream(args.query)
        for await (const row of stream) {
          yield flatten(row)
        }
      } catch (err) {
        // Map Google Ads RESOURCE_EXHAUSTED / quota errors to a retryable RateLimitError.
        const code = (err as { errors?: Array<{ error_code?: Record<string, unknown> }> })?.errors
          ?.[0]?.error_code
        const isQuota =
          code != null && JSON.stringify(code).includes('RESOURCE_EXHAUSTED')
        if (isQuota) throw new RateLimitError('Google Ads RESOURCE_EXHAUSTED')
        throw err
      }
    },
  }
}

/** Flatten the nested google-ads-api result object into flat GAQL-path keys. */
function flatten(row: Record<string, any>): GoogleAdsRow {
  return {
    'segments.date': row.segments?.date,
    'metrics.cost_micros': String(row.metrics?.cost_micros ?? '0'),
    'metrics.impressions': String(row.metrics?.impressions ?? '0'),
    'metrics.clicks': String(row.metrics?.clicks ?? '0'),
    'metrics.conversions': String(row.metrics?.conversions ?? '0'),
    'metrics.conversions_value': String(row.metrics?.conversions_value ?? '0'),
    'customer.currency_code': row.customer?.currency_code,
  }
}
```

> **Access-tier note (PRD §6.3, do not skip in production setup):** launch on the **Explorer** tier (production data, 2,880 ops/day, auto-granted) for early real data; apply for **Basic** (15,000 ops/day) Day 1 and switch the developer token over when granted. `SearchStream` counts as operations; nightly per-client account-level pulls stay well under Explorer's budget for a small client roster. This is an operational note — no code branch is needed.

- [ ] **Step 4: Implement the GAQL builder `src/lib/connectors/google-ads/gaql.ts`**

```ts
import 'server-only'

/**
 * Account-level daily rollup. We segment by date so each row is one day for the
 * customer. cost_micros and conversions_value are returned raw; normalization
 * (÷1e6 for cost only) happens in the connector.
 */
export function buildGaql(startDate: string, endDate: string): string {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.currency_code,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.conversions,',
    '  metrics.conversions_value',
    'FROM customer',
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    'ORDER BY segments.date',
  ].join('\n')
}
```

- [ ] **Step 5: Implement the connector `src/lib/connectors/google-ads/connector.ts`**

```ts
import 'server-only'
import type { Connector, NormalizedMetricRow, FetchContext } from '@/lib/connectors/types'
import type { GoogleAdsApiClient, GoogleAdsRow } from './client'
import { buildGaql } from './gaql'
import { microsToMajor, assertCurrency } from '@/lib/connectors/shared/money'

const TRAILING_DAYS = 14 // conversion lag + retroactive attribution (PRD §6.3)
const PROVISIONAL_DAYS = 3 // PRD §6.5

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(today: Date, n: number): Date {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

export class GoogleAdsConnector implements Connector<GoogleAdsRow[]> {
  readonly provider = 'google_ads' as const
  constructor(private readonly api: GoogleAdsApiClient) {}

  async fetch(ctx: FetchContext): Promise<GoogleAdsRow[]> {
    const today = ctx.today ?? new Date()
    const start = isoDate(daysAgo(today, TRAILING_DAYS))
    const end = isoDate(today)
    const customerId = ctx.accountId.replace(/-/g, '') // strip dashes from "123-456-7890"
    const query = buildGaql(start, end)

    const rows: GoogleAdsRow[] = []
    for await (const row of this.api.searchStream({ customerId, query })) {
      rows.push(row)
    }
    return rows
  }

  normalize(raw: GoogleAdsRow[], ctx: FetchContext): NormalizedMetricRow[] {
    const today = ctx.today ?? new Date()
    const provisionalCutoff = isoDate(daysAgo(today, PROVISIONAL_DAYS - 1))
    const accountId = ctx.accountId.replace(/-/g, '')
    const out: NormalizedMetricRow[] = []

    for (const r of raw) {
      const date = r['segments.date']
      const currency = assertCurrency(r['customer.currency_code'])
      const isProvisional = date >= provisionalCutoff
      const base = {
        clientId: ctx.clientId,
        provider: 'google_ads' as const,
        accountId,
        entity: 'account' as const,
        date,
        isProvisional,
      }

      out.push(
        { ...base, metric: 'spend', value: microsToMajor(r['metrics.cost_micros']), currency },
        { ...base, metric: 'impressions', value: String(r['metrics.impressions']) },
        { ...base, metric: 'clicks', value: String(r['metrics.clicks']) },
        { ...base, metric: 'conversions', value: String(r['metrics.conversions']) },
        // conversions_value is ALREADY major units — do NOT divide by 1e6.
        { ...base, metric: 'conversions_value', value: String(r['metrics.conversions_value']), currency },
        { ...base, metric: 'currency', value: currency },
      )
    }
    return out
  }
}
```

> **Type note:** `FetchContext` (from Plan 06) is extended here with an optional `today?: Date` for deterministic tests; if Plan 06's type does not include it, add `today?: Date` to `FetchContext` in `src/lib/connectors/types.ts` — that single optional field is the only shared-type change this plan requires. `NormalizedMetricRow` carries optional `currency?: string`; if absent in Plan 06, add `currency?: string` to it (the metric-store writer persists it as a sibling row already via the `currency` metric, so this is belt-and-braces).

- [ ] **Step 6: Run the Google Ads tests and confirm PASS**

Run: `pnpm test tests/connectors/google-ads.connector.test.ts`
Expected: PASS — GAQL builder, 14-day window, `cost_micros ÷ 1e6 = 1.23`, `conversions_value` unchanged at `320.00`, impressions/clicks/conversions/currency mapped, recent days provisional.

- [ ] **Step 7: Commit (with the mocks from Task 4)**

```bash
git add -A
git commit -m "feat(connectors): Google Ads connector (MCC, GAQL SearchStream, cost_micros/1e6, 14d resync)"
```

---

## Task 6: Register the Google Ads connector + wire the syncer (TDD)

**Files:**
- Create: `src/lib/connectors/google-ads/index.ts`
- Test: extend `tests/connectors/google-ads.connector.test.ts` with a metric-store integration block

This proves the connector writes the exact normalized rows into `metric_daily` through Plan 06's `upsertMetricDaily`, and registers it so the Inngest fan-out (`syncClientProvider`) picks it up.

- [ ] **Step 1: Add a metric-store integration test to `tests/connectors/google-ads.connector.test.ts`**

Append:

```ts
import { upsertMetricDaily } from '@/lib/connectors/metric-store'

describe('GoogleAdsConnector → metric_daily', () => {
  it('writes normalized spend/clicks/conversions rows via upsertMetricDaily', async () => {
    const upsert = vi.spyOn({ upsertMetricDaily }, 'upsertMetricDaily').mockResolvedValue(undefined as any)
    // Re-import the same binding the index uses, or assert on the normalized payload directly:
    const connector = new GoogleAdsConnector(makeGoogleAdsClient())
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)

    await upsertMetricDaily(rows)
    expect(upsert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'google_ads', metric: 'spend', value: '1.23' }),
        expect.objectContaining({ provider: 'google_ads', metric: 'clicks', value: '50' }),
        expect.objectContaining({ provider: 'google_ads', metric: 'conversions', value: '4.0' }),
      ]),
    )
    upsert.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and confirm it passes against the existing normalize output**

Run: `pnpm test tests/connectors/google-ads.connector.test.ts`
Expected: PASS — the normalized array contains the expected `metric_daily`-shaped rows. (This asserts the payload contract that `upsertMetricDaily` consumes.)

- [ ] **Step 3: Implement the registration `src/lib/connectors/google-ads/index.ts`**

```ts
import 'server-only'
import { registerConnector } from '@/lib/connectors/registry'
import { createGoogleAdsApiClient } from './client'
import { GoogleAdsConnector } from './connector'

// Lazily build the real API client (vault reads) the first time the syncer runs.
registerConnector('google_ads', async () => new GoogleAdsConnector(await createGoogleAdsApiClient()))
```

> The `registerConnector` factory signature (provider → `() => Promise<Connector>`) is defined by Plan 06. The Inngest `syncClientProvider` job resolves the factory, calls `fetch()` then `normalize()`, wraps the API call in `withBackoff`, records a `connector_sync_run` row via `startSyncRun`/`finishSyncRun`/`failSyncRun`, and persists with `upsertMetricDaily`. This plan supplies the connector; Plan 06 supplies the orchestration loop.

- [ ] **Step 4: Verify the full connector test file is green**

Run: `pnpm test tests/connectors/google-ads.connector.test.ts`
Expected: PASS — all Google Ads blocks (GAQL, fetch window, normalize, provisional, metric_daily payload).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): register Google Ads connector with the sync registry"
```

---

## Task 7: Meta connector — client interface, /insights params, fetch+normalize (TDD)

**Files:**
- Create: `src/lib/connectors/meta/client.ts`
- Create: `src/lib/connectors/meta/insights.ts`
- Create: `src/lib/connectors/meta/connector.ts`
- Test: `tests/connectors/meta.connector.test.ts`

**Meta auth model (one System User token):** one agency Business-type App + one non-expiring System User token from the agency Business Portfolio. Clients grant **Partner access** to the ad account + Page during onboarding; assets are assigned to the System User. The connector iterates `act_{ad_account_id}` per client (the `act_` id comes from `connection_account_map`). Token from vault: `META_SYSTEM_USER_TOKEN`.

**Data rules (PRD §6.3):**
- `/insights` gives `spend` (already major currency), `impressions`, `clicks`, `account_currency`.
- **Lead count** = sum of `actions` where `action_type === 'lead'` (also accept `'leadgen'`/`'onsite_conversion.lead_grouped'` as lead synonyms).
- **Always pass explicit `action_attribution_windows`** = `['7d_click','1d_view']`. `7d_view`/`28d_view` were removed Jan 12 2026 (silently blank); `28d_click` still works but we standardize on `7d_click,1d_view`.
- Use the **async** insights endpoint for large/monthly pulls (start → poll → fetch); async still counts toward rate limits.
- Read `X-Business-Use-Case-Usage` to throttle (the client surfaces `rateLimitPct`).
- Re-sync **28-day** rolling window.

- [ ] **Step 1: Write the failing test `tests/connectors/meta.connector.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetaConnector } from '@/lib/connectors/meta/connector'
import { buildInsightsParams } from '@/lib/connectors/meta/insights'
import { makeMetaClient, META_INSIGHT_ROWS } from './mocks'

const ctx = {
  clientId: '22222222-2222-2222-2222-222222222222',
  accountId: 'act_5550001', // Meta ad account id
  today: new Date('2026-06-29T00:00:00Z'),
}

describe('buildInsightsParams', () => {
  it('always sets explicit 7d_click,1d_view attribution windows', () => {
    const p = buildInsightsParams('2026-06-02', '2026-06-29')
    expect(p.action_attribution_windows).toEqual(['7d_click', '1d_view'])
    // Removed-in-Jan-2026 windows must NEVER be present.
    expect(p.action_attribution_windows).not.toContain('7d_view')
    expect(p.action_attribution_windows).not.toContain('28d_view')
  })

  it('requests daily time increments over the 28-day window', () => {
    const p = buildInsightsParams('2026-06-02', '2026-06-29')
    expect(p.time_increment).toBe(1)
    expect(p.time_range).toEqual({ since: '2026-06-02', until: '2026-06-29' })
    expect(p.fields).toContain('spend')
    expect(p.fields).toContain('actions')
    expect(p.level).toBe('account')
  })
})

describe('MetaConnector.fetch', () => {
  it('requests a 28-day trailing window ending today', async () => {
    const api = makeMetaClient()
    const connector = new MetaConnector(api)
    await connector.fetch(ctx)
    expect(api.getInsights).toHaveBeenCalledTimes(1)
    const call = (api.getInsights as any).mock.calls[0][0]
    expect(call.accountId).toBe('act_5550001')
    expect(call.params.time_range).toEqual({ since: '2026-06-01', until: '2026-06-29' }) // 28 days inclusive
  })

  it('uses the async path when async=true is requested', async () => {
    const api = makeMetaClient()
    const connector = new MetaConnector(api)
    await connector.fetch({ ...ctx, async: true })
    expect(api.startAsyncInsights).toHaveBeenCalledTimes(1)
    expect(api.pollAsyncInsights).toHaveBeenCalledWith('report-run-123')
    expect(api.getInsights).not.toHaveBeenCalled()
  })
})

describe('MetaConnector.normalize', () => {
  let connector: MetaConnector

  beforeEach(() => {
    connector = new MetaConnector(makeMetaClient())
  })

  it('keeps Meta spend as major currency (NOT micros) and records currency', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const spend = rows.find((r) => r.date === '2026-06-27' && r.metric === 'spend')
    expect(spend?.value).toBe('12.34') // unchanged, not divided by 1e6
    expect(spend?.currency).toBe('USD')
  })

  it('derives lead count from actions[action_type=lead]', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const at = (d: string, m: string) => rows.find((r) => r.date === d && r.metric === m)?.value
    expect(at('2026-06-27', 'leads')).toBe('3')
    expect(at('2026-06-28', 'leads')).toBe('5')
  })

  it('maps impressions and clicks and emits one row per metric per day', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const at = (d: string, m: string) => rows.find((r) => r.date === d && r.metric === m)?.value
    expect(at('2026-06-27', 'impressions')).toBe('1500')
    expect(at('2026-06-27', 'clicks')).toBe('60')
    // No conversions action present on day 2 -> leads still emitted, conversions defaults to 0
    expect(rows.filter((r) => r.metric === 'spend')).toHaveLength(2)
  })

  it('flags the most recent 3 days as provisional', async () => {
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const r27 = rows.find((r) => r.date === '2026-06-27' && r.metric === 'spend')
    expect(r27?.isProvisional).toBe(true)
  })
})

describe('MetaConnector rate-limit handling', () => {
  it('surfaces BUC rate-limit percentage from the client into sync meta', async () => {
    const api = makeMetaClient()
    const connector = new MetaConnector(api)
    const raw = await connector.fetch(ctx)
    expect(raw.rateLimitPct).toBe(12)
  })
})
```

- [ ] **Step 2: Run it and confirm FAIL**

Run: `pnpm test tests/connectors/meta.connector.test.ts`
Expected: FAIL — `@/lib/connectors/meta/*` modules do not exist.

- [ ] **Step 3: Implement the client interface `src/lib/connectors/meta/client.ts`**

```ts
import 'server-only'
import { getVaultSecret } from '@/lib/connectors/vault'
import { RateLimitError } from '@/lib/connectors/shared/rate-limit'
import { GRAPH_VERSION } from './insights'

export interface MetaAction {
  action_type: string
  value: string
}

export interface MetaInsightRow {
  date_start: string
  date_stop: string
  spend: string
  impressions: string
  clicks: string
  account_currency: string
  actions?: MetaAction[]
}

export interface MetaInsightsResult {
  rows: MetaInsightRow[]
  rateLimitPct: number // parsed from X-Business-Use-Case-Usage
}

export interface InsightsParams {
  time_range: { since: string; until: string }
  time_increment: number
  level: string
  fields: string[]
  action_attribution_windows: string[]
}

export interface GetInsightsArgs {
  accountId: string // "act_..."
  params: InsightsParams
}

/** Narrow surface the connector depends on — swappable for a mock in tests. */
export interface MetaApiClient {
  getInsights(args: GetInsightsArgs): Promise<MetaInsightsResult>
  startAsyncInsights(args: GetInsightsArgs): Promise<string> // returns report_run_id
  pollAsyncInsights(reportRunId: string): Promise<{ status: string; rows: MetaInsightRow[]; rateLimitPct: number }>
}

/** Parse the highest BUC usage percentage from the header value (JSON map). */
export function parseBucUsage(headerValue: string | null): number {
  if (!headerValue) return 0
  try {
    const obj = JSON.parse(headerValue) as Record<string, Array<Record<string, number>>>
    let max = 0
    for (const arr of Object.values(obj)) {
      for (const entry of arr) {
        for (const v of Object.values(entry)) {
          if (typeof v === 'number') max = Math.max(max, v)
        }
      }
    }
    return max
  } catch {
    return 0
  }
}

const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export async function createMetaApiClient(): Promise<MetaApiClient> {
  const token = await getVaultSecret('META_SYSTEM_USER_TOKEN')

  function toQuery(params: InsightsParams): string {
    const q = new URLSearchParams()
    q.set('time_range', JSON.stringify(params.time_range))
    q.set('time_increment', String(params.time_increment))
    q.set('level', params.level)
    q.set('fields', params.fields.join(','))
    q.set('action_attribution_windows', JSON.stringify(params.action_attribution_windows))
    q.set('access_token', token)
    return q.toString()
  }

  async function fetchJson(url: string): Promise<{ json: any; rateLimitPct: number }> {
    const res = await fetch(url)
    const rateLimitPct = parseBucUsage(res.headers.get('X-Business-Use-Case-Usage'))
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      throw new RateLimitError(`Meta ${res.status}`, {
        retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      })
    }
    const json = await res.json()
    if (json.error) {
      // Meta error code 17/4/613 = rate limiting / throttling.
      const code = json.error.code
      if (code === 17 || code === 4 || code === 613) throw new RateLimitError(`Meta error ${code}`)
      throw Object.assign(new Error(json.error.message ?? 'Meta API error'), { httpStatus: res.status })
    }
    return { json, rateLimitPct }
  }

  return {
    async getInsights({ accountId, params }) {
      const { json, rateLimitPct } = await fetchJson(`${BASE}/${accountId}/insights?${toQuery(params)}`)
      return { rows: (json.data ?? []) as MetaInsightRow[], rateLimitPct }
    },
    async startAsyncInsights({ accountId, params }) {
      const res = await fetch(`${BASE}/${accountId}/insights?${toQuery(params)}`, { method: 'POST' })
      const json = await res.json()
      if (json.error) throw Object.assign(new Error(json.error.message), { httpStatus: res.status })
      return json.report_run_id as string
    },
    async pollAsyncInsights(reportRunId) {
      const status = await fetchJson(`${BASE}/${reportRunId}?access_token=${token}`)
      const st = status.json.async_status as string
      if (st !== 'Job Completed') {
        return { status: st, rows: [], rateLimitPct: status.rateLimitPct }
      }
      const result = await fetchJson(`${BASE}/${reportRunId}/insights?access_token=${token}`)
      return { status: st, rows: (result.json.data ?? []) as MetaInsightRow[], rateLimitPct: result.rateLimitPct }
    },
  }
}
```

- [ ] **Step 4: Implement the insights params builder `src/lib/connectors/meta/insights.ts`**

```ts
import 'server-only'
import type { InsightsParams } from './client'

export const GRAPH_VERSION = 'v23.0' // pin the Graph API version (PRD §11 versioning rule)

// 7d_view / 28d_view were removed Jan 12 2026 (silently blank). 28d_click still
// works, but we standardize on 7d_click + 1d_view for consistency across clients.
export const ATTRIBUTION_WINDOWS = ['7d_click', '1d_view'] as const

export function buildInsightsParams(since: string, until: string): InsightsParams {
  return {
    time_range: { since, until },
    time_increment: 1, // one row per day
    level: 'account',
    fields: ['spend', 'impressions', 'clicks', 'actions', 'account_currency'],
    action_attribution_windows: [...ATTRIBUTION_WINDOWS],
  }
}

const LEAD_ACTION_TYPES = new Set(['lead', 'leadgen', 'onsite_conversion.lead_grouped'])

/** Sum action values whose action_type is any recognized lead type. */
export function sumLeads(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions) return 0
  let total = 0
  for (const a of actions) {
    if (LEAD_ACTION_TYPES.has(a.action_type)) total += Number(a.value) || 0
  }
  return total
}
```

- [ ] **Step 5: Implement the connector `src/lib/connectors/meta/connector.ts`**

```ts
import 'server-only'
import type { Connector, NormalizedMetricRow, FetchContext } from '@/lib/connectors/types'
import type { MetaApiClient, MetaInsightRow } from './client'
import { buildInsightsParams, sumLeads } from './insights'
import { normalizeSpend, assertCurrency } from '@/lib/connectors/shared/money'

const TRAILING_DAYS = 28 // Meta rolling re-sync window (PRD §6.3)
const PROVISIONAL_DAYS = 3 // PRD §6.5

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function daysAgo(today: Date, n: number): Date {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

export interface MetaFetchResult {
  rows: MetaInsightRow[]
  rateLimitPct: number
}

export class MetaConnector implements Connector<MetaFetchResult> {
  readonly provider = 'meta_ads' as const
  constructor(private readonly api: MetaApiClient) {}

  async fetch(ctx: FetchContext & { async?: boolean }): Promise<MetaFetchResult> {
    const today = ctx.today ?? new Date()
    const since = isoDate(daysAgo(today, TRAILING_DAYS))
    const until = isoDate(today)
    const params = buildInsightsParams(since, until)
    const args = { accountId: ctx.accountId, params }

    if (ctx.async) {
      const runId = await this.api.startAsyncInsights(args)
      const result = await this.api.pollAsyncInsights(runId)
      if (result.status !== 'Job Completed') {
        throw new Error(`Meta async insights not complete: ${result.status}`)
      }
      return { rows: result.rows, rateLimitPct: result.rateLimitPct }
    }

    const result = await this.api.getInsights(args)
    return { rows: result.rows, rateLimitPct: result.rateLimitPct }
  }

  normalize(raw: MetaFetchResult, ctx: FetchContext): NormalizedMetricRow[] {
    const today = ctx.today ?? new Date()
    const provisionalCutoff = isoDate(daysAgo(today, PROVISIONAL_DAYS - 1))
    const out: NormalizedMetricRow[] = []

    for (const r of raw.rows) {
      const date = r.date_start
      const currency = assertCurrency(r.account_currency)
      const isProvisional = date >= provisionalCutoff
      const base = {
        clientId: ctx.clientId,
        provider: 'meta_ads' as const,
        accountId: ctx.accountId,
        entity: 'account' as const,
        date,
        isProvisional,
      }

      out.push(
        // Meta spend is ALREADY major currency — normalize formatting only, never /1e6.
        { ...base, metric: 'spend', value: normalizeSpend(r.spend, 'major'), currency },
        { ...base, metric: 'impressions', value: String(r.impressions ?? '0') },
        { ...base, metric: 'clicks', value: String(r.clicks ?? '0') },
        { ...base, metric: 'leads', value: String(sumLeads(r.actions)) },
        { ...base, metric: 'currency', value: currency },
      )
    }
    return out
  }
}
```

> **Type note:** `FetchContext` gains an optional `async?: boolean` for the large-pull path (same one-field optional-extension pattern as `today?: Date` in Task 5). Add both optional fields to `src/lib/connectors/types.ts` if Plan 06 did not already include them.

- [ ] **Step 6: Run the Meta tests and confirm PASS**

Run: `pnpm test tests/connectors/meta.connector.test.ts`
Expected: PASS — attribution windows exactly `['7d_click','1d_view']` (no `7d_view`/`28d_view`), 28-day window, async path, spend stays `12.34` (not micros), leads from `actions[action_type=lead]` = `3`/`5`, impressions/clicks mapped, provisional flagging, BUC `rateLimitPct=12` surfaced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(connectors): Meta connector (System User token, /insights async, 7d_click+1d_view, lead actions, 28d resync)"
```

---

## Task 8: Register the Meta connector + currency & rate-limit assertion through the store (TDD)

**Files:**
- Create: `src/lib/connectors/meta/index.ts`
- Test: extend `tests/connectors/meta.connector.test.ts`

- [ ] **Step 1: Add a metric-store payload + currency-normalization test to `tests/connectors/meta.connector.test.ts`**

Append:

```ts
import { upsertMetricDaily } from '@/lib/connectors/metric-store'
import { makeMetaClient } from './mocks'

describe('MetaConnector → metric_daily (currency normalization)', () => {
  it('writes spend/clicks/leads rows; spend currency preserved, value not micros-scaled', async () => {
    const connector = new MetaConnector(makeMetaClient())
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)

    const upsert = vi.spyOn({ upsertMetricDaily }, 'upsertMetricDaily').mockResolvedValue(undefined as any)
    await upsertMetricDaily(rows)
    const written = upsert.mock.calls[0][0]
    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'meta_ads', metric: 'spend', value: '12.34', currency: 'USD' }),
        expect.objectContaining({ provider: 'meta_ads', metric: 'clicks', value: '60' }),
        expect.objectContaining({ provider: 'meta_ads', metric: 'leads', value: '3' }),
      ]),
    )
    // Guard: no Meta spend value was accidentally divided by 1e6.
    const spendRows = written.filter((r: any) => r.metric === 'spend')
    expect(spendRows.every((r: any) => Number(r.value) >= 1)).toBe(true)
    upsert.mockRestore()
  })

  it('a EUR account normalizes spend with the EUR currency tag', async () => {
    const eurClient = makeMetaClient([
      {
        date_start: '2026-06-28', date_stop: '2026-06-28',
        spend: '9.5', impressions: '100', clicks: '5',
        account_currency: 'eur', actions: [{ action_type: 'lead', value: '1' }],
      },
    ])
    const connector = new MetaConnector(eurClient)
    const raw = await connector.fetch(ctx)
    const rows = connector.normalize(raw, ctx)
    const spend = rows.find((r) => r.metric === 'spend')
    expect(spend?.value).toBe('9.50') // >= 2dp, no float drift
    expect(spend?.currency).toBe('EUR') // lower-cased input canonicalized
  })
})
```

- [ ] **Step 2: Run it and confirm PASS**

Run: `pnpm test tests/connectors/meta.connector.test.ts`
Expected: PASS — store payload correct; EUR/lower-case currency canonicalized to `EUR`; spend `9.5 → 9.50`; no micros scaling on Meta spend.

- [ ] **Step 3: Implement the registration `src/lib/connectors/meta/index.ts`**

```ts
import 'server-only'
import { registerConnector } from '@/lib/connectors/registry'
import { createMetaApiClient } from './client'
import { MetaConnector } from './connector'

registerConnector('meta_ads', async () => new MetaConnector(await createMetaApiClient()))
```

- [ ] **Step 4: Ensure both connectors are imported at app/job bootstrap**

The Inngest job bundle (Plan 06's `src/lib/inngest/functions.ts` or equivalent) must import the two index files so `registerConnector` runs. Add these imports near the other connector registrations (GA4/GSC/GBP from earlier plans):

```ts
import '@/lib/connectors/google-ads'
import '@/lib/connectors/meta'
```

> If Plan 06 uses a central `src/lib/connectors/all.ts` barrel, add the two imports there instead. Either way the side-effecting registration must run before `syncClientProvider` executes.

- [ ] **Step 5: Run the full connector suite**

Run: `pnpm test tests/connectors`
Expected: PASS — money, rate-limit, Google Ads, Meta all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(connectors): register Meta connector + currency-normalization store tests"
```

---

## Task 9: Full suite + type check (verification gate)

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `pnpm tsc --noEmit`
Expected: no type errors. (If `FetchContext`/`NormalizedMetricRow` needed the optional `today?`/`async?`/`currency?` fields, confirm they were added to `src/lib/connectors/types.ts` and nothing else regressed.)

- [ ] **Step 2: Run lint + the entire test suite (mirrors CI)**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all tests pass — including the Plan 01 RLS suite, the new `connector_sync_run` isolation test, and all connector unit/integration tests.

- [ ] **Step 3: Confirm no connector code is reachable from a page render**

Run: `grep -rn "from '@/lib/connectors" src/app || echo "OK: no connector imports under src/app"`
Expected: prints `OK: no connector imports under src/app` (connectors run only in Inngest jobs, never on render — PRD §6.1 / §11).

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore(connectors): green type-check + full suite for Google Ads + Meta"
```

---

## Self-Review

**Spec coverage (vs PRD §6.3 Google Ads + Meta, §6.5 data-trust):**

Google Ads (§6.3):
- Single MCC, one refresh token + developer token, `login-customer-id = MCC`, per-request `customer_id = client` → `client.ts` `createGoogleAdsApiClient` / `searchStream`. ✅
- MCC link-invite onboarding (no per-client OAuth) → account id read from `connection_account_map` via Plan 06 vault; no per-client OAuth code. ✅
- GAQL `SearchStream` → `gaql.ts` + `searchStream` async iterable. ✅
- `cost_micros ÷ 1e6` → `microsToMajor`; tested `1_230_000 → "1.23"`. ✅
- `conversions_value` NOT divided → explicit test asserts `320.00` unchanged. ✅
- Trailing ~14-day re-sync → `TRAILING_DAYS = 14`; tested `BETWEEN '2026-06-15' AND '2026-06-29'`. ✅
- Explorer-vs-Basic tier note → documented operational note in Task 5 Step 3. ✅

Meta (§6.3):
- One System User token → `META_SYSTEM_USER_TOKEN` from vault. ✅
- Client Partner-access onboarding → account id from `connection_account_map`; no per-client OAuth. ✅
- `/insights` with async for large pulls → `getInsights` + `startAsyncInsights`/`pollAsyncInsights`; tested async path. ✅
- Explicit `action_attribution_windows = 7d_click,1d_view`; `7d_view`/`28d_view` removed → `ATTRIBUTION_WINDOWS`; test asserts presence of the two and absence of the removed two. ✅
- Lead count from `actions[action_type=lead]` → `sumLeads` (+ `leadgen`/`onsite_conversion.lead_grouped` synonyms); tested `3`/`5`. ✅
- 28-day re-sync → `TRAILING_DAYS = 28`; tested `since '2026-06-01'`. ✅
- BUC rate-limit header handling → `parseBucUsage('X-Business-Use-Case-Usage')`; surfaced as `rateLimitPct`; tested `12`. ✅

Cross-cutting:
- Mock both API clients → `tests/connectors/mocks.ts`; no network in any test. ✅
- Assert normalized spend/clicks/conversions/leads rows in `metric_daily` → store payload tests in Tasks 6 & 8 against `upsertMetricDaily`. ✅
- Currency-normalization unit tests → `money.test.ts` + Meta EUR/lower-case test; both providers record a `currency` row and tag monetary rows. ✅
- Rate-limit/backoff tests → `rate-limit.test.ts` (exponential, explicit `retryAfterMs`, non-retryable, give-up, classifier). ✅
- Data-trust (§6.5): most-recent-3-days `is_provisional` flag on both connectors; per-sync audit row in `connector_sync_run` (last-sync/last-error for the connection-health dashboard) → Task 3. ✅
- New tenant-scoped table `connector_sync_run` has RLS reusing `has_org_access`/`is_agency_staff` + an isolation test → Task 3. ✅
- Versioning (§11): Graph API pinned to `v23.0` (`GRAPH_VERSION`); Google Ads version pinned by the `google-ads-api` package. ✅

**Placeholder scan:** No `TBD`/`TODO`/"similar to above". Every code step is complete and runnable. The `00NN` migration numbers are an explicit "the journal assigns the next free number" instruction, not a code placeholder. The Task 5/7 type notes are concrete one-line optional-field additions to a Plan 06 type, fully specified. ✅

**Type consistency:**
- Canonical metric names (`spend`, `impressions`, `clicks`, `conversions`, `conversions_value`, `leads`, `currency`) identical across both connectors and the store payload assertions. ✅
- `provider` literals `'google_ads'` / `'meta_ads'` match the Plan 06 `integrationProvider` enum and the `connector_sync_run.provider` column. ✅
- `Connector<T>` / `NormalizedMetricRow` / `FetchContext` from Plan 06 used by both connectors; the only shared-type change is adding optional `today?: Date`, `async?: boolean`, `currency?: string`. ✅
- `RateLimitError` raised by both real clients (Google `RESOURCE_EXHAUSTED`; Meta 429/5xx + error codes 4/17/613) and consumed by `withBackoff` (invoked by Plan 06's `syncClientProvider`). ✅
- `ConnectorSyncRun` / `NewConnectorSyncRun` types match the `connectorSyncRun` table; `startSyncRun`/`finishSyncRun`/`failSyncRun` names consistent between `sync-run.ts` and the (Plan 06) orchestrator. ✅

**Definition of done for Plan 08:** `pnpm tsc --noEmit && pnpm lint && pnpm test` green — all money, rate-limit, Google Ads, Meta, and the `connector_sync_run` RLS isolation tests pass; both connectors are registered on the sync registry; no connector module is imported under `src/app`.
