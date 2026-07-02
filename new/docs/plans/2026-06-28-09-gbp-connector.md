# Agency OS — Plan 09: Google Business Profile (GBP) Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Google Business Profile connector — the Plane A (deterministic data backbone) integration that fetches each client's local-search performance, monthly search keywords, and reviews, then normalizes them into our own metrics store. The connector implements the shared `fetch()`/`normalize()` interface from Plan 06, sums the four `BUSINESS_IMPRESSIONS_*` metrics into a single total-impressions row, aggregates daily metrics into calendar months ourselves, lands reviews (rating + count) into a dedicated tenant-scoped table, and runs nightly via an Inngest fan-out. All external calls are mocked in tests; the assertions prove normalized metric rows + reviews land in the store.

**Architecture:** GBP exposes several APIs: the **Performance API** (`businessprofileperformance.googleapis.com`) for daily metrics and monthly search keywords, the **Account Management** + **Business Information** APIs for account/location discovery, and the legacy **v4 API** (`mybusiness.googleapis.com/v4`) for reviews + average rating. Auth is OAuth with the **sensitive** `https://www.googleapis.com/auth/business.manage` scope; the authenticated agency account must *manage* each client location (clients add the agency account/group as a manager so one consent covers all locations). The connector lives behind Plan 06's `Connector` interface so provider specifics never leak into the UI or schema. It reads tokens from the Plan 06 token vault (`oauth_token`), discovers the locations mapped to a client via `connection_account_map`, fetches per-location daily metrics + monthly keywords + reviews, normalizes daily rows into `metric_daily` (provider `'gbp'`), rolls them up into `metric_monthly_rollup`, and writes review snapshots into a new `gbp_review` table. The nightly Inngest job fans out per (client, connection) with bounded concurrency and a rolling re-sync window to absorb GBP's ~5-day data lag. **Q&A API is dead (discontinued Nov 2025) — this plan never calls it.**

**Tech Stack:** TypeScript (strict) · postgres.js + Drizzle (from Plan 01/06) · `googleapis` (official Google Node client) for typed Performance/Account/Business-Information access + `google-auth-library` for OAuth token refresh · Inngest (jobs/cron, from Plan 06) · Supabase Vault (tokens, from Plan 06) · Vitest with `vi.mock` for the Google API surface · date-fns for calendar-month math.

**Dependencies (assume already built — do NOT re-spec):**
- **Plan 01 (Foundation):** `organizations`/`profiles`/`memberships`, the `org_type`/`app_role` enums, `public.has_org_access(uuid)` + `public.is_agency_staff()` SECURITY DEFINER helpers, the test harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`), and the seed (`scripts/seed.ts`).
- **Plan 06 (Integration Backbone):** the `connection` table (`client_id`/`organization_id`, `provider`, `status`, `last_sync_at`, `last_error`), `connection_account_map` (`connection_id`, `external_account_id`, `kind`), the vault-backed `oauth_token` accessor, the `metric_daily` table (`organization_id`, `provider`, `account_id`, `entity`, `date`, `metric`, `value`, `is_provisional`) **with RLS already enabled**, `metric_monthly_rollup`, the shared `Connector` interface (`src/integrations/types.ts`), the connector registry, the sync-scheduler helpers (`runConnectorSync`, bounded-concurrency fan-out), and the Inngest client (`src/inngest/client.ts`).

> **Two approval gates (documented, not code — see Task 0):** GBP is the longest pole because it needs **(1) GBP API allow-listing** (the "Basic API Access" form: verified GBP 60+ days, live website, GCP project number; no SLA, days–6 weeks; quota goes 0 → 300 QPM when approved; **can be granted unevenly per API — verify all of them**), **and (2) sensitive-scope OAuth consent-screen verification** because `business.manage` is a sensitive scope. Both must be started Day 1. The connector ships behind the Plan 06 `connection` model and switches on per client as approvals land.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ integrations/
│  │  └─ gbp/
│  │     ├─ client.ts              # authed googleapis clients (performance/account/biz-info/v4 reviews) from a vault token
│  │     ├─ discovery.ts           # account + location enumeration → external account-map entries
│  │     ├─ metrics.ts             # daily metric pulls + the four BUSINESS_IMPRESSIONS_* sum + monthly keywords
│  │     ├─ reviews.ts             # v4 reviews: average rating + total count
│  │     ├─ normalize.ts           # raw GBP payloads → metric_daily rows + review snapshot (pure, testable)
│  │     ├─ connector.ts           # GBPConnector implementing the Plan 06 Connector interface
│  │     └─ constants.ts           # metric name constants, provider id, rolling-window + lag config
│  └─ inngest/
│     └─ functions/
│        └─ gbp-sync.ts            # nightly cron + per-(client,connection) fan-out
├─ drizzle/
│  └─ 00NN_gbp_reviews.sql         # gbp_review table + RLS (custom migration)
├─ src/db/schema.ts                # MODIFY: add gbpReview table
├─ src/db/types.ts                 # MODIFY: export GbpReview type
└─ tests/
   ├─ integrations/gbp/
   │  ├─ normalize.test.ts         # pure normalization (impressions sum, keyword + review mapping)
   │  ├─ discovery.test.ts         # account/location enumeration (mocked googleapis)
   │  ├─ connector.test.ts         # end-to-end fetch()→normalize()→store (mocked API; asserts rows + reviews land)
   │  └─ monthly-rollup.test.ts    # calendar-month aggregation + ~5-day-lag provisional flagging
   └─ rls/gbp-reviews.test.ts      # KEYSTONE tenant-isolation test for gbp_review
```

---

## Task 0: Document the two approval gates and provider constants

This task is documentation + constants only (no schema yet). It encodes the §6.3/§6.4 GBP gotchas so later code and ops never drift. There is no test here; it is a checked-in reference the connector imports.

**Files:**
- Create: `src/integrations/gbp/constants.ts`

- [ ] **Step 1: Write `src/integrations/gbp/constants.ts`**

```ts
/**
 * Google Business Profile (GBP) connector constants & approval notes.
 *
 * ── TWO APPROVAL GATES (PRD §6.3 / §6.4 — start BOTH on Day 1) ─────────────
 * GATE 1 — GBP API allow-listing ("Basic API Access" form):
 *   - Requires: a GBP account verified 60+ days, a live website
 *     (milktreeagency.com), and the GCP project number.
 *   - No SLA: days to ~6 weeks. On approval, per-API quota goes 0 → 300 QPM.
 *   - WARNING: allow-listing can be granted UNEVENLY per API. After approval,
 *     verify quota > 0 for EACH API used here: Business Profile Performance,
 *     Account Management, Business Information, and the v4 (mybusiness) API.
 * GATE 2 — OAuth consent-screen verification (sensitive scope):
 *   - `business.manage` is a SENSITIVE scope, so a public per-client-consent
 *     app ALSO needs OAuth consent-screen verification (sensitive-scope tier —
 *     NOT the heavier restricted/CASA tier). Plan it Day 1.
 *
 * Until both gates clear, the GBPConnector stays behind the Plan 06 `connection`
 * model (status `not_connected`/`pending`) and is switched on per client as
 * approvals land. Nothing here calls the discontinued Q&A API (sunset Nov 2025).
 */

export const GBP_PROVIDER = 'gbp' as const

/** Sensitive OAuth scope required for all GBP APIs (Gate 2). */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'

/**
 * Performance API daily metrics we request. The four BUSINESS_IMPRESSIONS_*
 * are summed into one normalized `impressions_total` row (PRD §6.3).
 */
export const GBP_IMPRESSION_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const

/** Action metrics requested 1:1 (no summing). */
export const GBP_ACTION_METRICS = [
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'WEBSITE_CLICKS',
  'BUSINESS_CONVERSATIONS',
] as const

/** Every daily metric we request from the Performance API. */
export const GBP_DAILY_METRICS = [
  ...GBP_IMPRESSION_METRICS,
  ...GBP_ACTION_METRICS,
] as const

/**
 * Normalized metric names written to metric_daily (provider 'gbp').
 * These are OUR stable names — provider specifics do not leak past normalize().
 */
export const GBP_NORMALIZED_METRICS = {
  IMPRESSIONS_TOTAL: 'impressions_total',
  CALL_CLICKS: 'call_clicks',
  DIRECTION_REQUESTS: 'direction_requests',
  WEBSITE_CLICKS: 'website_clicks',
  CONVERSATIONS: 'conversations',
} as const

/** Map a raw GBP action metric → our normalized name. */
export const GBP_ACTION_METRIC_MAP: Record<
  (typeof GBP_ACTION_METRICS)[number],
  string
> = {
  CALL_CLICKS: GBP_NORMALIZED_METRICS.CALL_CLICKS,
  BUSINESS_DIRECTION_REQUESTS: GBP_NORMALIZED_METRICS.DIRECTION_REQUESTS,
  WEBSITE_CLICKS: GBP_NORMALIZED_METRICS.WEBSITE_CLICKS,
  BUSINESS_CONVERSATIONS: GBP_NORMALIZED_METRICS.CONVERSATIONS,
}

/** entity column value for location-level metric rows. */
export const GBP_ENTITY = 'location' as const

/**
 * GBP data lag (~5 days). We re-pull a rolling window each sync and flag the
 * most-recent `PROVISIONAL_DAYS` as provisional (PRD §6.3 lag + §6.5 trust).
 */
export const GBP_LAG_DAYS = 5
export const GBP_PROVISIONAL_DAYS = 5
export const GBP_RESYNC_WINDOW_DAYS = 14

/**
 * Timezone-offset note: the Performance API returns metrics bucketed by the
 * LOCATION's local day boundary, NOT UTC. We store the date string exactly as
 * GBP reports it (the location-local calendar date) so monthly aggregation by
 * calendar month is consistent with what GBP shows. We do NOT re-bucket into
 * UTC, which would shift counts across day/month boundaries.
 */
export const GBP_DATE_IS_LOCATION_LOCAL = true
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs(gbp): approval-gate notes + connector constants (two gates, ~5d lag, impressions sum)"
```

---

## Task 1: `gbp_review` table — schema + RLS (KEYSTONE tenant-isolation test FIRST)

Reviews (average rating + count) are tenant-scoped client-owned data, so the table needs `organization_id` as the leading composite-index column, RLS enabled, and policies that reuse the Plan 01 helpers. Per shared conventions, **every new tenant-scoped table requires an RLS isolation test using the Plan 01 harness**. We write that test first (failing), then add the table + RLS to make it pass.

**Files:**
- Modify: `src/db/schema.ts`, `src/db/types.ts`
- Create: `drizzle/00NN_gbp_reviews.sql` (custom migration; replace `NN` with the next number)
- Create: `tests/rls/gbp-reviews.test.ts`

- [ ] **Step 1: Add the `gbpReview` table to `src/db/schema.ts`**

Append (the `connection` table is owned by Plan 06; we reference it by name in raw SQL for the FK to avoid coupling, and store `organizationId` directly for RLS):

```ts
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core'

// Google Business Profile reviews snapshot per (org, connection, location, day).
// One row per location per sync day: average rating + total review count.
export const gbpReview = pgTable(
  'gbp_review',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    // GBP location resource id this snapshot belongs to (e.g. "locations/123").
    locationId: text('location_id').notNull(),
    // Snapshot date (sync day, location-local). Reviews are cumulative, so we
    // store a daily snapshot rather than per-review rows.
    snapshotDate: date('snapshot_date').notNull(),
    averageRating: numeric('average_rating', { precision: 3, scale: 2 }),
    reviewCount: integer('review_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // tenant-LEADING composite index (RLS performance rule, PRD §9).
    orgIdx: index('idx_gbp_review_org').on(
      t.organizationId,
      t.locationId,
      t.snapshotDate,
    ),
    // idempotent upsert target: one snapshot per (org, location, day).
    uniqSnapshot: unique('uniq_gbp_review_snapshot').on(
      t.organizationId,
      t.locationId,
      t.snapshotDate,
    ),
  }),
)
```

> If the imports above already exist at the top of `schema.ts`, merge the new identifiers into the existing `drizzle-orm/pg-core` import rather than duplicating the statement.

- [ ] **Step 2: Export the type in `src/db/types.ts`**

```ts
import type { gbpReview } from './schema'

export type GbpReview = typeof gbpReview.$inferSelect
export type NewGbpReview = typeof gbpReview.$inferInsert
```

- [ ] **Step 3: Generate the table migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00NN_*.sql` creates `gbp_review` with the composite index and unique constraint. **Do not apply yet** — we add RLS in the same step set so the failing test is meaningful.

- [ ] **Step 4: Write the RLS isolation test FIRST (`tests/rls/gbp-reviews.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

// Tenant-isolation keystone for gbp_review: a client user must see ONLY their
// own org's review snapshots; agency staff see all.
describe('gbp_review tenant isolation (RLS)', () => {
  let founder: string
  let clientOneUser: string
  let clientOneOrg: string
  let clientTwoOrg: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')

    const [c1] = await sql`select id from public.organizations where slug = 'client-one'`
    const [c2] = await sql`select id from public.organizations where slug = 'client-two'`
    clientOneOrg = c1!.id as string
    clientTwoOrg = c2!.id as string

    // Seed one review snapshot per client org (service-role / bypasses RLS).
    await sql`
      insert into public.gbp_review
        (organization_id, connection_id, location_id, snapshot_date, average_rating, review_count)
      values
        (${clientOneOrg}, gen_random_uuid(), 'locations/c1', '2026-06-28', 4.50, 120),
        (${clientTwoOrg}, gen_random_uuid(), 'locations/c2', '2026-06-28', 3.90, 40)
      on conflict (organization_id, location_id, snapshot_date) do nothing
    `
  })

  afterAll(async () => {
    await sql`delete from public.gbp_review where location_id in ('locations/c1', 'locations/c2')`
    await sql.end()
  })

  it('a client user sees ONLY their own org review snapshots', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id, location_id from public.gbp_review`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.organization_id).toBe(clientOneOrg)
    expect(rows.some((r) => r.organization_id === clientTwoOrg)).toBe(false)
  })

  it('agency staff (founder) sees ALL org review snapshots', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select organization_id from public.gbp_review order by review_count desc`,
    )
    const orgs = rows.map((r) => r.organization_id)
    expect(orgs).toContain(clientOneOrg)
    expect(orgs).toContain(clientTwoOrg)
  })

  it('a client user cannot INSERT a snapshot for another org', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.gbp_review
             (organization_id, connection_id, location_id, snapshot_date, review_count)
           values (${clientTwoOrg}, gen_random_uuid(), 'locations/evil', '2026-06-28', 1)`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Run the test and confirm it FAILS**

Run: `pnpm test tests/rls/gbp-reviews.test.ts`
Expected: FAIL — the `gbp_review` table either does not exist yet (migration not applied) or has no RLS, so either the insert in `beforeAll` errors or the client user sees both orgs / the cross-org insert succeeds. This proves the test is real before RLS exists.

- [ ] **Step 6: Create the RLS custom migration**

Run: `pnpm db:generate --custom --name=gbp_reviews_rls`
Expected: an empty `drizzle/00NN_gbp_reviews_rls.sql` registered in the journal. Fill it:

```sql
-- FK to the Plan 06 connection table (referenced by name to avoid Drizzle coupling).
alter table public.gbp_review
  add constraint gbp_review_connection_fk
  foreign key (connection_id) references public.connection (id) on delete cascade;

-- FK to organizations (tenant).
alter table public.gbp_review
  add constraint gbp_review_org_fk
  foreign key (organization_id) references public.organizations (id) on delete cascade;

-- Enable RLS.
alter table public.gbp_review enable row level security;

-- SELECT: client sees own org; staff see all (reuse Plan 01 helper).
create policy gbp_review_select on public.gbp_review
  for select using (public.has_org_access(organization_id));

-- INSERT: only for orgs the user can access (blocks cross-org writes).
create policy gbp_review_insert on public.gbp_review
  for insert with check (public.has_org_access(organization_id));

-- UPDATE: same scope (idempotent upserts run as service_role in jobs and bypass
-- RLS; this policy guards any user-context write path).
create policy gbp_review_update on public.gbp_review
  for update using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
```

- [ ] **Step 7: Apply both migrations**

Run: `pnpm db:migrate`
Expected: applies the `gbp_review` table migration and the RLS migration with no errors. Verify:
```bash
psql "$DATABASE_URL" -c "\d+ public.gbp_review"
```
Expected: table present; `Policies` section lists `gbp_review_select`, `gbp_review_insert`, `gbp_review_update`; RLS enabled.

- [ ] **Step 8: Run the RLS test and confirm it PASSES**

Run: `pnpm test tests/rls/gbp-reviews.test.ts`
Expected: all three tests PASS — the client user sees only their org, the founder sees both, the cross-org insert is rejected.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(gbp): gbp_review table + RLS tenant isolation (keystone test passes)"
```

---

## Task 2: Normalization — sum impressions, map actions, shape reviews (pure, TDD)

The normalizer is the heart of the connector and the part most worth testing in isolation: it takes raw GBP API payloads and emits `metric_daily` rows (provider `'gbp'`) + a review snapshot, with the four `BUSINESS_IMPRESSIONS_*` series summed per day into one `impressions_total` row. It is pure (no I/O), so tests need no mocks.

**Files:**
- Create: `src/integrations/gbp/normalize.ts`
- Create: `tests/integrations/gbp/normalize.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/normalize.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeDailyMetrics,
  normalizeReviews,
  type RawTimeSeries,
} from '@/integrations/gbp/normalize'

const ORG = '00000000-0000-0000-0000-000000000001'
const CONN = '00000000-0000-0000-0000-000000000002'
const LOC = 'locations/777'

// Each multiDailyMetricTimeSeries entry is one metric with dated values.
function ts(metric: string, byDate: Record<string, number>): RawTimeSeries {
  return {
    dailyMetric: metric,
    timeSeries: {
      datedValues: Object.entries(byDate).map(([d, v]) => {
        const [year, month, day] = d.split('-').map(Number)
        return { date: { year, month, day }, value: String(v) }
      }),
    },
  }
}

describe('normalizeDailyMetrics', () => {
  it('sums the four BUSINESS_IMPRESSIONS_* into one impressions_total row per day', () => {
    const raw: RawTimeSeries[] = [
      ts('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', { '2026-06-01': 10, '2026-06-02': 1 }),
      ts('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', { '2026-06-01': 20, '2026-06-02': 2 }),
      ts('BUSINESS_IMPRESSIONS_MOBILE_MAPS', { '2026-06-01': 30, '2026-06-02': 3 }),
      ts('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', { '2026-06-01': 40, '2026-06-02': 4 }),
    ]
    const rows = normalizeDailyMetrics({ organizationId: ORG, connectionId: CONN, locationId: LOC, series: raw })
    const total = rows.filter((r) => r.metric === 'impressions_total')
    expect(total).toHaveLength(2)
    expect(total.find((r) => r.date === '2026-06-01')!.value).toBe(100) // 10+20+30+40
    expect(total.find((r) => r.date === '2026-06-02')!.value).toBe(10)  // 1+2+3+4
  })

  it('maps each action metric 1:1 to a normalized row', () => {
    const raw: RawTimeSeries[] = [
      ts('CALL_CLICKS', { '2026-06-01': 5 }),
      ts('BUSINESS_DIRECTION_REQUESTS', { '2026-06-01': 6 }),
      ts('WEBSITE_CLICKS', { '2026-06-01': 7 }),
      ts('BUSINESS_CONVERSATIONS', { '2026-06-01': 8 }),
    ]
    const rows = normalizeDailyMetrics({ organizationId: ORG, connectionId: CONN, locationId: LOC, series: raw })
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]))
    expect(byMetric['call_clicks']).toBe(5)
    expect(byMetric['direction_requests']).toBe(6)
    expect(byMetric['website_clicks']).toBe(7)
    expect(byMetric['conversations']).toBe(8)
  })

  it('stamps provider/entity/org/connection and treats missing values as 0', () => {
    const raw: RawTimeSeries[] = [
      ts('CALL_CLICKS', { '2026-06-01': 5 }),
      // impressions partially missing on 06-01 → still emits a total row of 5.
      ts('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', { '2026-06-01': 5 }),
    ]
    const rows = normalizeDailyMetrics({ organizationId: ORG, connectionId: CONN, locationId: LOC, series: raw })
    const sample = rows[0]!
    expect(sample.provider).toBe('gbp')
    expect(sample.entity).toBe('location')
    expect(sample.accountId).toBe(LOC)
    expect(sample.organizationId).toBe(ORG)
    const total = rows.find((r) => r.metric === 'impressions_total' && r.date === '2026-06-01')!
    expect(total.value).toBe(5)
  })
})

describe('normalizeReviews', () => {
  it('extracts averageRating + totalReviewCount into a snapshot', () => {
    const snap = normalizeReviews({
      organizationId: ORG,
      connectionId: CONN,
      locationId: LOC,
      snapshotDate: '2026-06-28',
      payload: { averageRating: 4.5, totalReviewCount: 132, reviews: [] },
    })
    expect(snap.organizationId).toBe(ORG)
    expect(snap.connectionId).toBe(CONN)
    expect(snap.locationId).toBe(LOC)
    expect(snap.snapshotDate).toBe('2026-06-28')
    expect(snap.averageRating).toBe('4.5')
    expect(snap.reviewCount).toBe(132)
  })

  it('defaults to 0 count and null rating when GBP returns an empty location', () => {
    const snap = normalizeReviews({
      organizationId: ORG,
      connectionId: CONN,
      locationId: LOC,
      snapshotDate: '2026-06-28',
      payload: {},
    })
    expect(snap.reviewCount).toBe(0)
    expect(snap.averageRating).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/normalize.test.ts`
Expected: FAIL — `Cannot find module '@/integrations/gbp/normalize'` (the file does not exist yet).

- [ ] **Step 3: Implement `src/integrations/gbp/normalize.ts`**

```ts
import {
  GBP_PROVIDER,
  GBP_ENTITY,
  GBP_NORMALIZED_METRICS,
  GBP_ACTION_METRIC_MAP,
  GBP_IMPRESSION_METRICS,
} from './constants'

/** A single GBP date (Performance API returns y/m/d, not ISO strings). */
export interface GbpDate {
  year: number
  month: number
  day: number
}

/** One metric's dated values, as returned by the Performance API. */
export interface RawTimeSeries {
  dailyMetric: string
  timeSeries: { datedValues: Array<{ date: GbpDate; value?: string }> }
}

/** A normalized row destined for metric_daily (provider 'gbp'). */
export interface NormalizedMetricRow {
  organizationId: string
  connectionId: string
  provider: typeof GBP_PROVIDER
  accountId: string // GBP location resource id
  entity: typeof GBP_ENTITY
  date: string // ISO yyyy-mm-dd (location-local — see constants note)
  metric: string
  value: number
}

/** A normalized review snapshot destined for gbp_review. */
export interface NormalizedReview {
  organizationId: string
  connectionId: string
  locationId: string
  snapshotDate: string
  averageRating: string | null
  reviewCount: number
}

function isoDate(d: GbpDate): string {
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

function toNumber(v: string | undefined): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const IMPRESSION_SET: ReadonlySet<string> = new Set(GBP_IMPRESSION_METRICS)

export function normalizeDailyMetrics(input: {
  organizationId: string
  connectionId: string
  locationId: string
  series: RawTimeSeries[]
}): NormalizedMetricRow[] {
  const { organizationId, connectionId, locationId, series } = input
  const rows: NormalizedMetricRow[] = []
  // Accumulate the four impression series per date before emitting one total.
  const impressionsByDate = new Map<string, number>()

  for (const s of series) {
    const metric = s.dailyMetric
    const values = s.timeSeries?.datedValues ?? []

    if (IMPRESSION_SET.has(metric)) {
      for (const dv of values) {
        const date = isoDate(dv.date)
        impressionsByDate.set(date, (impressionsByDate.get(date) ?? 0) + toNumber(dv.value))
      }
      continue
    }

    const normalized = GBP_ACTION_METRIC_MAP[metric as keyof typeof GBP_ACTION_METRIC_MAP]
    if (!normalized) continue // ignore unknown metrics defensively

    for (const dv of values) {
      rows.push({
        organizationId,
        connectionId,
        provider: GBP_PROVIDER,
        accountId: locationId,
        entity: GBP_ENTITY,
        date: isoDate(dv.date),
        metric: normalized,
        value: toNumber(dv.value),
      })
    }
  }

  for (const [date, total] of impressionsByDate) {
    rows.push({
      organizationId,
      connectionId,
      provider: GBP_PROVIDER,
      accountId: locationId,
      entity: GBP_ENTITY,
      date,
      metric: GBP_NORMALIZED_METRICS.IMPRESSIONS_TOTAL,
      value: total,
    })
  }

  return rows
}

/** Raw v4 reviews payload shape (only the fields we use). */
export interface RawReviewsPayload {
  averageRating?: number
  totalReviewCount?: number
  reviews?: unknown[]
}

export function normalizeReviews(input: {
  organizationId: string
  connectionId: string
  locationId: string
  snapshotDate: string
  payload: RawReviewsPayload
}): NormalizedReview {
  const { organizationId, connectionId, locationId, snapshotDate, payload } = input
  const rating =
    typeof payload.averageRating === 'number' ? String(payload.averageRating) : null
  return {
    organizationId,
    connectionId,
    locationId,
    snapshotDate,
    averageRating: rating,
    reviewCount: payload.totalReviewCount ?? 0,
  }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/normalize.test.ts`
Expected: all tests PASS — impressions summed per day, actions mapped 1:1, reviews shaped, missing values → 0 / null.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gbp): pure normalizer (impressions sum, action map, review snapshot) + tests"
```

---

## Task 3: Authed clients + account/location discovery (TDD with mocked googleapis)

The connector needs (a) an authed `googleapis` client built from a vault token, and (b) discovery: enumerate the GBP accounts the agency manages and the locations under each, producing `connection_account_map`-shaped entries. We mock the `googleapis` surface so no network calls happen.

**Files:**
- Create: `src/integrations/gbp/client.ts`
- Create: `src/integrations/gbp/discovery.ts`
- Create: `tests/integrations/gbp/discovery.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/discovery.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the googleapis clients our discovery module uses.
const accountsList = vi.fn()
const locationsList = vi.fn()

vi.mock('@/integrations/gbp/client', () => ({
  getGbpClients: vi.fn(async () => ({
    accountManagement: { accounts: { list: accountsList } },
    businessInformation: { accounts: { locations: { list: locationsList } } },
  })),
}))

import { discoverLocations } from '@/integrations/gbp/discovery'

describe('discoverLocations', () => {
  beforeEach(() => {
    accountsList.mockReset()
    locationsList.mockReset()
  })

  it('enumerates accounts then locations into account-map entries', async () => {
    accountsList.mockResolvedValue({ data: { accounts: [{ name: 'accounts/1' }] } })
    locationsList.mockResolvedValueOnce({
      data: {
        locations: [
          { name: 'locations/100', title: 'Shop A' },
          { name: 'locations/200', title: 'Shop B' },
        ],
        nextPageToken: undefined,
      },
    })

    const result = await discoverLocations({ connectionId: 'conn-1' })

    expect(accountsList).toHaveBeenCalledOnce()
    expect(locationsList).toHaveBeenCalledWith(
      expect.objectContaining({ parent: 'accounts/1' }),
    )
    expect(result).toEqual([
      { connectionId: 'conn-1', externalAccountId: 'locations/100', kind: 'gbp_location', label: 'Shop A' },
      { connectionId: 'conn-1', externalAccountId: 'locations/200', kind: 'gbp_location', label: 'Shop B' },
    ])
  })

  it('follows pagination across location pages', async () => {
    accountsList.mockResolvedValue({ data: { accounts: [{ name: 'accounts/1' }] } })
    locationsList
      .mockResolvedValueOnce({
        data: { locations: [{ name: 'locations/100', title: 'A' }], nextPageToken: 'pg2' },
      })
      .mockResolvedValueOnce({
        data: { locations: [{ name: 'locations/300', title: 'C' }], nextPageToken: undefined },
      })

    const result = await discoverLocations({ connectionId: 'conn-1' })
    expect(locationsList).toHaveBeenCalledTimes(2)
    expect(result.map((r) => r.externalAccountId)).toEqual(['locations/100', 'locations/300'])
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/discovery.test.ts`
Expected: FAIL — `Cannot find module '@/integrations/gbp/discovery'`.

- [ ] **Step 3: Implement `src/integrations/gbp/client.ts`**

```ts
import 'server-only'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { getOAuthToken } from '@/integrations/vault' // Plan 06 vault accessor
import { GBP_SCOPE } from './constants'

/**
 * Authed googleapis clients for one connection, built from the Plan 06 vault.
 * The vault accessor returns a refresh token (and optional access token); the
 * google-auth-library OAuth2Client refreshes transparently on demand.
 */
export interface GbpClients {
  accountManagement: ReturnType<typeof google.mybusinessaccountmanagement>
  businessInformation: ReturnType<typeof google.mybusinessbusinessinformation>
  performance: ReturnType<typeof google.businessprofileperformance>
}

export async function getAuthClient(connectionId: string): Promise<OAuth2Client> {
  const token = await getOAuthToken(connectionId) // { refreshToken, accessToken? }
  const oauth = new OAuth2Client({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
  })
  oauth.setCredentials({
    refresh_token: token.refreshToken,
    access_token: token.accessToken,
    scope: GBP_SCOPE,
  })
  return oauth
}

export async function getGbpClients(connectionId: string): Promise<GbpClients> {
  const auth = await getAuthClient(connectionId)
  return {
    accountManagement: google.mybusinessaccountmanagement({ version: 'v1', auth }),
    businessInformation: google.mybusinessbusinessinformation({ version: 'v1', auth }),
    performance: google.businessprofileperformance({ version: 'v1', auth }),
  }
}
```

> The legacy v4 reviews API (`mybusiness.googleapis.com/v4`) is not in the `googleapis` typed surface; Task 4 calls it via the same `OAuth2Client.request()` to reuse refresh handling.

- [ ] **Step 4: Implement `src/integrations/gbp/discovery.ts`**

```ts
import { getGbpClients } from './client'

export interface AccountMapEntry {
  connectionId: string
  externalAccountId: string // GBP location resource id, e.g. "locations/100"
  kind: 'gbp_location'
  label: string
}

/**
 * Enumerate all GBP accounts the agency manages for this connection, then all
 * locations under each account, returning connection_account_map-shaped rows.
 * Read-only (Account Management + Business Information APIs).
 */
export async function discoverLocations(input: {
  connectionId: string
}): Promise<AccountMapEntry[]> {
  const { connectionId } = input
  const { accountManagement, businessInformation } = await getGbpClients(connectionId)

  const accountsRes = await accountManagement.accounts.list({})
  const accounts = accountsRes.data.accounts ?? []
  const entries: AccountMapEntry[] = []

  for (const account of accounts) {
    if (!account.name) continue
    let pageToken: string | undefined
    do {
      const locRes = await businessInformation.accounts.locations.list({
        parent: account.name,
        // Field mask is required by the Business Information API.
        readMask: 'name,title',
        pageSize: 100,
        pageToken,
      })
      for (const loc of locRes.data.locations ?? []) {
        if (!loc.name) continue
        entries.push({
          connectionId,
          externalAccountId: loc.name,
          kind: 'gbp_location',
          label: loc.title ?? loc.name,
        })
      }
      pageToken = locRes.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  return entries
}
```

- [ ] **Step 5: Run the test and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/discovery.test.ts`
Expected: both tests PASS — accounts enumerated, locations paginated, entries shaped correctly.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(gbp): authed googleapis clients + account/location discovery (mocked tests)"
```

---

## Task 4: Metric + review fetchers (TDD with mocked API)

These thin fetchers call the Performance API (daily metrics + monthly search keywords) and the v4 reviews endpoint, returning raw payloads for the normalizer. We mock the API objects.

**Files:**
- Create: `src/integrations/gbp/metrics.ts`
- Create: `src/integrations/gbp/reviews.ts`
- Create: `tests/integrations/gbp/fetchers.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/fetchers.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMultiDaily = vi.fn()
const oauthRequest = vi.fn()

vi.mock('@/integrations/gbp/client', () => ({
  getGbpClients: vi.fn(async () => ({
    performance: {
      locations: { fetchMultiDailyMetricsTimeSeries: fetchMultiDaily },
    },
  })),
  getAuthClient: vi.fn(async () => ({ request: oauthRequest })),
}))

import { fetchDailyMetrics } from '@/integrations/gbp/metrics'
import { fetchReviews } from '@/integrations/gbp/reviews'

describe('fetchDailyMetrics', () => {
  beforeEach(() => fetchMultiDaily.mockReset())

  it('requests the four impression + four action metrics for the window', async () => {
    fetchMultiDaily.mockResolvedValue({
      data: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [] } }] }] },
    })
    const series = await fetchDailyMetrics({
      connectionId: 'conn-1',
      locationId: 'locations/100',
      start: { year: 2026, month: 6, day: 1 },
      end: { year: 2026, month: 6, day: 14 },
    })
    const call = fetchMultiDaily.mock.calls[0]![0]
    expect(call.location).toBe('locations/100')
    expect(call.dailyMetrics).toEqual(
      expect.arrayContaining([
        'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
        'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
        'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
        'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
        'CALL_CLICKS',
        'BUSINESS_DIRECTION_REQUESTS',
        'WEBSITE_CLICKS',
        'BUSINESS_CONVERSATIONS',
      ]),
    )
    // Flattened to a list of {dailyMetric, timeSeries}.
    expect(series).toEqual([{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [] } }])
  })
})

describe('fetchReviews', () => {
  beforeEach(() => oauthRequest.mockReset())

  it('calls the v4 reviews endpoint and returns rating + count', async () => {
    oauthRequest.mockResolvedValue({
      data: { averageRating: 4.7, totalReviewCount: 88, reviews: [{ name: 'r1' }] },
    })
    const payload = await fetchReviews({ connectionId: 'conn-1', locationId: 'locations/100' })
    const url = oauthRequest.mock.calls[0]![0].url as string
    expect(url).toContain('mybusiness.googleapis.com/v4')
    expect(url).toContain('locations/100/reviews')
    expect(payload.averageRating).toBe(4.7)
    expect(payload.totalReviewCount).toBe(88)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/fetchers.test.ts`
Expected: FAIL — modules `@/integrations/gbp/metrics` / `reviews` do not exist.

- [ ] **Step 3: Implement `src/integrations/gbp/metrics.ts`**

```ts
import { getGbpClients } from './client'
import { getAuthClient } from './client'
import { GBP_DAILY_METRICS } from './constants'
import type { GbpDate, RawTimeSeries } from './normalize'

/**
 * Fetch the requested daily metrics for one location over [start, end].
 * Returns a flat list of {dailyMetric, timeSeries} for the normalizer.
 */
export async function fetchDailyMetrics(input: {
  connectionId: string
  locationId: string
  start: GbpDate
  end: GbpDate
}): Promise<RawTimeSeries[]> {
  const { connectionId, locationId, start, end } = input
  const { performance } = await getGbpClients(connectionId)

  const res = await performance.locations.fetchMultiDailyMetricsTimeSeries({
    location: locationId,
    dailyMetrics: [...GBP_DAILY_METRICS],
    'dailyRange.startDate.year': start.year,
    'dailyRange.startDate.month': start.month,
    'dailyRange.startDate.day': start.day,
    'dailyRange.endDate.year': end.year,
    'dailyRange.endDate.month': end.month,
    'dailyRange.endDate.day': end.day,
  } as never)

  const groups = res.data.multiDailyMetricTimeSeries ?? []
  const out: RawTimeSeries[] = []
  for (const g of groups) {
    for (const s of g.dailyMetricTimeSeries ?? []) {
      if (!s.dailyMetric) continue
      out.push({
        dailyMetric: s.dailyMetric,
        timeSeries: { datedValues: s.timeSeries?.datedValues ?? [] },
      })
    }
  }
  return out
}

/**
 * Monthly search keywords (Performance API searchkeywords endpoint).
 * Returns [{ keyword, value }] for the requested calendar month.
 */
export async function fetchMonthlySearchKeywords(input: {
  connectionId: string
  locationId: string
  year: number
  month: number
}): Promise<Array<{ keyword: string; value: number }>> {
  const { connectionId, locationId, year, month } = input
  const auth = await getAuthClient(connectionId)
  const url =
    `https://businessprofileperformance.googleapis.com/v1/${locationId}/searchkeywords/impressions/monthly` +
    `?monthlyRange.startMonth.year=${year}&monthlyRange.startMonth.month=${month}` +
    `&monthlyRange.endMonth.year=${year}&monthlyRange.endMonth.month=${month}`
  const res = (await auth.request({ url })) as {
    data: { searchKeywordsCounts?: Array<{ searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }> }
  }
  const rows = res.data.searchKeywordsCounts ?? []
  return rows.map((r) => ({
    keyword: r.searchKeyword ?? '',
    // Below-threshold buckets return `threshold` instead of an exact value.
    value: Number(r.insightsValue?.value ?? r.insightsValue?.threshold ?? 0),
  }))
}
```

- [ ] **Step 4: Implement `src/integrations/gbp/reviews.ts`**

```ts
import { getAuthClient } from './client'
import type { RawReviewsPayload } from './normalize'

/**
 * Fetch reviews summary for one location via the legacy v4 API
 * (mybusiness.googleapis.com/v4). We only use averageRating + totalReviewCount;
 * `reviews` is paginated but not stored per-review in v1 of this connector.
 */
export async function fetchReviews(input: {
  connectionId: string
  locationId: string
}): Promise<RawReviewsPayload> {
  const { connectionId, locationId } = input
  const auth = await getAuthClient(connectionId)
  const url = `https://mybusiness.googleapis.com/v4/${locationId}/reviews`
  const res = (await auth.request({ url })) as { data: RawReviewsPayload }
  return res.data ?? {}
}
```

- [ ] **Step 5: Run the test and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/fetchers.test.ts`
Expected: both tests PASS — metrics request includes all eight daily metrics and flattens the response; reviews hit the v4 URL and return rating + count.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(gbp): performance daily-metrics + monthly-keywords + v4 reviews fetchers (mocked tests)"
```

---

## Task 5: The `GBPConnector` — fetch()→normalize()→store (TDD; asserts rows + reviews land)

This wires the pieces into the Plan 06 `Connector` interface and persists results: it computes the rolling re-sync window with the ~5-day lag, fetches per mapped location, normalizes, upserts `metric_daily` rows (flagging the last `GBP_PROVISIONAL_DAYS` provisional), and upserts the review snapshot into `gbp_review`. The test mocks the fetchers and asserts that normalized rows + reviews actually land in the store via a captured upsert.

**Files:**
- Create: `src/integrations/gbp/connector.ts`
- Create: `tests/integrations/gbp/connector.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/connector.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchDailyMetrics = vi.fn()
const fetchReviews = vi.fn()
const upsertMetricDaily = vi.fn()
const upsertReviewSnapshot = vi.fn()
const listLocations = vi.fn()

vi.mock('@/integrations/gbp/metrics', () => ({
  fetchDailyMetrics,
  fetchMonthlySearchKeywords: vi.fn(async () => []),
}))
vi.mock('@/integrations/gbp/reviews', () => ({ fetchReviews }))
vi.mock('@/integrations/gbp/store', () => ({ upsertMetricDaily, upsertReviewSnapshot }))
vi.mock('@/integrations/gbp/account-map', () => ({ listMappedLocations: listLocations }))

import { GBPConnector } from '@/integrations/gbp/connector'

const CTX = {
  organizationId: 'org-1',
  connectionId: 'conn-1',
  now: new Date('2026-07-10T00:00:00Z'), // run ~5 days into the new month
}

describe('GBPConnector.sync', () => {
  beforeEach(() => {
    fetchDailyMetrics.mockReset()
    fetchReviews.mockReset()
    upsertMetricDaily.mockReset()
    upsertReviewSnapshot.mockReset()
    listLocations.mockReset()
    listLocations.mockResolvedValue(['locations/100'])
  })

  it('fetches per location, normalizes, and lands metric rows + a review snapshot in the store', async () => {
    fetchDailyMetrics.mockResolvedValue([
      {
        dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
        timeSeries: { datedValues: [{ date: { year: 2026, month: 7, day: 1 }, value: '10' }] },
      },
      {
        dailyMetric: 'CALL_CLICKS',
        timeSeries: { datedValues: [{ date: { year: 2026, month: 7, day: 1 }, value: '3' }] },
      },
    ])
    fetchReviews.mockResolvedValue({ averageRating: 4.2, totalReviewCount: 51 })

    await new GBPConnector().sync(CTX)

    // metric rows landed
    expect(upsertMetricDaily).toHaveBeenCalledOnce()
    const rows = upsertMetricDaily.mock.calls[0]![0] as Array<{ metric: string; value: number; provider: string; accountId: string }>
    const total = rows.find((r) => r.metric === 'impressions_total')!
    expect(total.value).toBe(10)
    expect(total.provider).toBe('gbp')
    expect(total.accountId).toBe('locations/100')
    expect(rows.find((r) => r.metric === 'call_clicks')!.value).toBe(3)

    // review snapshot landed
    expect(upsertReviewSnapshot).toHaveBeenCalledOnce()
    const snap = upsertReviewSnapshot.mock.calls[0]![0]
    expect(snap.organizationId).toBe('org-1')
    expect(snap.locationId).toBe('locations/100')
    expect(snap.averageRating).toBe('4.2')
    expect(snap.reviewCount).toBe(51)
  })

  it('flags rows within the ~5-day lag window as provisional', async () => {
    // Day 2026-07-08 is within 5 days of the 07-10 run → provisional.
    fetchDailyMetrics.mockResolvedValue([
      {
        dailyMetric: 'CALL_CLICKS',
        timeSeries: {
          datedValues: [
            { date: { year: 2026, month: 7, day: 1 }, value: '1' }, // settled
            { date: { year: 2026, month: 7, day: 8 }, value: '2' }, // provisional
          ],
        },
      },
    ])
    fetchReviews.mockResolvedValue({ totalReviewCount: 0 })

    await new GBPConnector().sync(CTX)

    const rows = upsertMetricDaily.mock.calls[0]![0] as Array<{ date: string; isProvisional: boolean }>
    expect(rows.find((r) => r.date === '2026-07-01')!.isProvisional).toBe(false)
    expect(rows.find((r) => r.date === '2026-07-08')!.isProvisional).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/connector.test.ts`
Expected: FAIL — `@/integrations/gbp/connector` (and the `store` / `account-map` helpers) do not exist.

- [ ] **Step 3: Implement the store helper `src/integrations/gbp/store.ts`**

```ts
import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { gbpReview } from '@/db/schema'
import { metricDaily } from '@/db/schema' // Plan 06 table
import type { NormalizedMetricRow, NormalizedReview } from './normalize'

/** Provisional flag travels with each row from the connector. */
export type MetricRowToStore = NormalizedMetricRow & { isProvisional: boolean }

/**
 * Idempotent upsert of metric_daily rows. Conflict target matches Plan 06's
 * natural key (organization_id, provider, account_id, entity, date, metric).
 * Runs as service_role inside the job (RLS bypassed for admin writes).
 */
export async function upsertMetricDaily(rows: MetricRowToStore[]): Promise<void> {
  if (rows.length === 0) return
  await db
    .insert(metricDaily)
    .values(
      rows.map((r) => ({
        organizationId: r.organizationId,
        provider: r.provider,
        accountId: r.accountId,
        entity: r.entity,
        date: r.date,
        metric: r.metric,
        value: String(r.value),
        isProvisional: r.isProvisional,
      })),
    )
    .onConflictDoUpdate({
      target: [
        metricDaily.organizationId,
        metricDaily.provider,
        metricDaily.accountId,
        metricDaily.entity,
        metricDaily.date,
        metricDaily.metric,
      ],
      set: {
        value: sql`excluded.value`,
        isProvisional: sql`excluded.is_provisional`,
      },
    })
}

/** Idempotent upsert of a daily review snapshot. */
export async function upsertReviewSnapshot(snap: NormalizedReview): Promise<void> {
  await db
    .insert(gbpReview)
    .values({
      organizationId: snap.organizationId,
      connectionId: snap.connectionId,
      locationId: snap.locationId,
      snapshotDate: snap.snapshotDate,
      averageRating: snap.averageRating,
      reviewCount: snap.reviewCount,
    })
    .onConflictDoUpdate({
      target: [gbpReview.organizationId, gbpReview.locationId, gbpReview.snapshotDate],
      set: {
        averageRating: sql`excluded.average_rating`,
        reviewCount: sql`excluded.review_count`,
      },
    })
}
```

- [ ] **Step 4: Implement the account-map helper `src/integrations/gbp/account-map.ts`**

```ts
import 'server-only'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { connectionAccountMap } from '@/db/schema' // Plan 06 table

/** Location resource ids mapped to this connection (kind = 'gbp_location'). */
export async function listMappedLocations(connectionId: string): Promise<string[]> {
  const rows = await db
    .select({ ext: connectionAccountMap.externalAccountId })
    .from(connectionAccountMap)
    .where(
      and(
        eq(connectionAccountMap.connectionId, connectionId),
        eq(connectionAccountMap.kind, 'gbp_location'),
      ),
    )
  return rows.map((r) => r.ext)
}
```

- [ ] **Step 5: Implement `src/integrations/gbp/connector.ts`**

```ts
import 'server-only'
import { fetchDailyMetrics } from './metrics'
import { fetchReviews } from './reviews'
import { upsertMetricDaily, upsertReviewSnapshot, type MetricRowToStore } from './store'
import { listMappedLocations } from './account-map'
import { normalizeDailyMetrics, normalizeReviews, type GbpDate } from './normalize'
import {
  GBP_PROVIDER,
  GBP_LAG_DAYS,
  GBP_PROVISIONAL_DAYS,
  GBP_RESYNC_WINDOW_DAYS,
} from './constants'
import type { Connector, SyncContext } from '@/integrations/types' // Plan 06 interface

function toGbpDate(d: Date): GbpDate {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + days)
  return x
}

/**
 * GBP connector. Implements the Plan 06 Connector interface. Reads tokens +
 * mapped locations, fetches a rolling re-sync window honoring the ~5-day lag,
 * normalizes, and upserts metric rows + a review snapshot into our store.
 */
export class GBPConnector implements Connector {
  readonly provider = GBP_PROVIDER

  async sync(ctx: SyncContext): Promise<void> {
    const { organizationId, connectionId, now } = ctx

    // Rolling window: end = now - lag, start = end - resync window. The most
    // recent GBP_PROVISIONAL_DAYS are flagged provisional (PRD §6.3/§6.5).
    const end = addDays(now, -GBP_LAG_DAYS)
    const start = addDays(end, -GBP_RESYNC_WINDOW_DAYS)
    const provisionalCutoff = addDays(now, -GBP_PROVISIONAL_DAYS)
    const provisionalCutoffIso = isoOf(provisionalCutoff)

    const locations = await listMappedLocations(connectionId)

    for (const locationId of locations) {
      // ── metrics ──────────────────────────────────────────────────────────
      const series = await fetchDailyMetrics({
        connectionId,
        locationId,
        start: toGbpDate(start),
        end: toGbpDate(end),
      })
      const normalized = normalizeDailyMetrics({
        organizationId,
        connectionId,
        locationId,
        series,
      })
      const rows: MetricRowToStore[] = normalized.map((r) => ({
        ...r,
        // A row is provisional if its date is on/after the provisional cutoff.
        isProvisional: r.date >= provisionalCutoffIso,
      }))
      await upsertMetricDaily(rows)

      // ── reviews ──────────────────────────────────────────────────────────
      const payload = await fetchReviews({ connectionId, locationId })
      const snapshot = normalizeReviews({
        organizationId,
        connectionId,
        locationId,
        snapshotDate: isoOf(now),
        payload,
      })
      await upsertReviewSnapshot(snapshot)
    }
  }
}
```

- [ ] **Step 6: Run the test and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/connector.test.ts`
Expected: both tests PASS — normalized rows (with `impressions_total` summed) and the review snapshot land in the store via the captured upserts; rows inside the ~5-day window are flagged provisional.

- [ ] **Step 7: Register the connector in the Plan 06 registry**

Edit `src/integrations/registry.ts` (Plan 06) to add the GBP connector:
```ts
import { GBPConnector } from './gbp/connector'
// inside the registry map/array:
//   gbp: new GBPConnector(),
```
Add the line consistent with however Plan 06 structured the registry (map keyed by provider id). If the registry is an array, push `new GBPConnector()`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(gbp): GBPConnector fetch->normalize->store, provisional flagging, registry wiring"
```

---

## Task 6: Calendar-month rollup ourselves (TDD)

GBP data is daily; the PRD requires we **aggregate to calendar months ourselves** and run monthly reports ~5 days into the new month. This task adds a pure month-aggregation helper over normalized daily rows and a store helper to upsert `metric_monthly_rollup`. We test the aggregation purely and assert the provisional flag is preserved when any constituent day is provisional.

**Files:**
- Create: `src/integrations/gbp/rollup.ts`
- Create: `tests/integrations/gbp/monthly-rollup.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/monthly-rollup.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateToCalendarMonths } from '@/integrations/gbp/rollup'
import type { MetricRowToStore } from '@/integrations/gbp/store'

function row(date: string, metric: string, value: number, isProvisional = false): MetricRowToStore {
  return {
    organizationId: 'org-1',
    connectionId: 'conn-1',
    provider: 'gbp',
    accountId: 'locations/100',
    entity: 'location',
    date,
    metric,
    value,
    isProvisional,
  }
}

describe('aggregateToCalendarMonths', () => {
  it('sums daily values into one row per (location, metric, calendar month)', () => {
    const daily = [
      row('2026-06-01', 'call_clicks', 2),
      row('2026-06-15', 'call_clicks', 3),
      row('2026-07-01', 'call_clicks', 10),
      row('2026-06-10', 'impressions_total', 100),
    ]
    const months = aggregateToCalendarMonths(daily)
    const juneCalls = months.find((m) => m.month === '2026-06' && m.metric === 'call_clicks')!
    const julyCalls = months.find((m) => m.month === '2026-07' && m.metric === 'call_clicks')!
    const juneImpr = months.find((m) => m.month === '2026-06' && m.metric === 'impressions_total')!
    expect(juneCalls.value).toBe(5)
    expect(julyCalls.value).toBe(10)
    expect(juneImpr.value).toBe(100)
  })

  it('marks a month provisional if ANY constituent day is provisional', () => {
    const daily = [
      row('2026-07-01', 'call_clicks', 1, false),
      row('2026-07-08', 'call_clicks', 2, true), // within lag window
    ]
    const months = aggregateToCalendarMonths(daily)
    const july = months.find((m) => m.month === '2026-07' && m.metric === 'call_clicks')!
    expect(july.value).toBe(3)
    expect(july.isProvisional).toBe(true)
  })

  it('keeps metrics and locations separate', () => {
    const daily = [
      { ...row('2026-06-01', 'call_clicks', 1), accountId: 'locations/100' },
      { ...row('2026-06-01', 'call_clicks', 9), accountId: 'locations/200' },
    ]
    const months = aggregateToCalendarMonths(daily)
    expect(months.find((m) => m.accountId === 'locations/100')!.value).toBe(1)
    expect(months.find((m) => m.accountId === 'locations/200')!.value).toBe(9)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/monthly-rollup.test.ts`
Expected: FAIL — `@/integrations/gbp/rollup` does not exist.

- [ ] **Step 3: Implement `src/integrations/gbp/rollup.ts`**

```ts
import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { metricMonthlyRollup } from '@/db/schema' // Plan 06 table
import type { MetricRowToStore } from './store'

export interface MonthlyRollupRow {
  organizationId: string
  provider: string
  accountId: string
  entity: string
  month: string // 'yyyy-mm'
  metric: string
  value: number
  isProvisional: boolean
}

/**
 * Pure: aggregate normalized daily rows into one row per
 * (org, provider, account, entity, calendar month, metric). A month is
 * provisional if ANY of its days is provisional (PRD §6.3 / §6.5).
 */
export function aggregateToCalendarMonths(daily: MetricRowToStore[]): MonthlyRollupRow[] {
  const byKey = new Map<string, MonthlyRollupRow>()
  for (const r of daily) {
    const month = r.date.slice(0, 7) // 'yyyy-mm'
    const key = `${r.organizationId}|${r.accountId}|${r.entity}|${month}|${r.metric}`
    const existing = byKey.get(key)
    if (existing) {
      existing.value += r.value
      existing.isProvisional = existing.isProvisional || r.isProvisional
    } else {
      byKey.set(key, {
        organizationId: r.organizationId,
        provider: r.provider,
        accountId: r.accountId,
        entity: r.entity,
        month,
        metric: r.metric,
        value: r.value,
        isProvisional: r.isProvisional,
      })
    }
  }
  return [...byKey.values()]
}

/** Idempotent upsert of monthly rollups (service_role inside the job). */
export async function upsertMonthlyRollup(rows: MonthlyRollupRow[]): Promise<void> {
  if (rows.length === 0) return
  await db
    .insert(metricMonthlyRollup)
    .values(
      rows.map((r) => ({
        organizationId: r.organizationId,
        provider: r.provider,
        accountId: r.accountId,
        entity: r.entity,
        month: r.month,
        metric: r.metric,
        value: String(r.value),
        isProvisional: r.isProvisional,
      })),
    )
    .onConflictDoUpdate({
      target: [
        metricMonthlyRollup.organizationId,
        metricMonthlyRollup.provider,
        metricMonthlyRollup.accountId,
        metricMonthlyRollup.entity,
        metricMonthlyRollup.month,
        metricMonthlyRollup.metric,
      ],
      set: {
        value: sql`excluded.value`,
        isProvisional: sql`excluded.is_provisional`,
      },
    })
}
```

> If Plan 06's `metric_monthly_rollup` uses a different column for the month (e.g. a `date` set to the first of the month rather than a `yyyy-mm` text column), adapt the `month` value and conflict target to match Plan 06's schema exactly; the aggregation logic above is unchanged.

- [ ] **Step 4: Wire the rollup into the connector**

Edit `src/integrations/gbp/connector.ts`. Accumulate all rows across locations, then roll up once at the end of `sync`:

```ts
// add imports
import { aggregateToCalendarMonths, upsertMonthlyRollup } from './rollup'
```

Inside `sync`, collect `rows` across the loop and after the loop:
```ts
    const allRows: MetricRowToStore[] = []
    for (const locationId of locations) {
      // ...existing per-location fetch/normalize...
      allRows.push(...rows)
      await upsertMetricDaily(rows)
      // ...existing review fetch/upsert...
    }
    await upsertMonthlyRollup(aggregateToCalendarMonths(allRows))
```
(Declare `allRows` before the loop and `push` each location's `rows` into it; keep the per-location `upsertMetricDaily(rows)` as-is.)

- [ ] **Step 5: Run the rollup test and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/monthly-rollup.test.ts`
Expected: all three tests PASS — daily values summed per calendar month, month marked provisional when any day is, metrics/locations kept separate.

- [ ] **Step 6: Re-run the connector test to confirm no regression**

Run: `pnpm test tests/integrations/gbp/connector.test.ts`
Expected: still PASS (the rollup call adds a mocked/no-op `upsertMonthlyRollup`; if the connector test now needs the rollup mocked, add `vi.mock('@/integrations/gbp/rollup', () => ({ aggregateToCalendarMonths: (x:unknown)=>[], upsertMonthlyRollup: vi.fn() }))` to `connector.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(gbp): self-computed calendar-month rollups with provisional propagation"
```

---

## Task 7: Nightly Inngest sync — cron + per-(client,connection) fan-out (TDD)

The connector runs nightly via Inngest, fanning out per connected GBP client with bounded concurrency, updating `connection.last_sync_at`/`last_error`, and using the rolling window already built into the connector. We test the fan-out logic with a mocked Inngest step + connection list.

**Files:**
- Create: `src/inngest/functions/gbp-sync.ts`
- Create: `tests/integrations/gbp/sync-job.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/sync-job.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listConnected = vi.fn()
const runSync = vi.fn()
const markSynced = vi.fn()
const markError = vi.fn()

vi.mock('@/integrations/gbp/connections', () => ({ listConnectedGbpConnections: listConnected }))
vi.mock('@/integrations/gbp/connector', () => ({
  GBPConnector: class {
    sync = runSync
  },
}))
vi.mock('@/integrations/connection-status', () => ({
  markConnectionSynced: markSynced,
  markConnectionError: markError,
}))

import { runGbpSync } from '@/inngest/functions/gbp-sync'

describe('runGbpSync', () => {
  beforeEach(() => {
    listConnected.mockReset()
    runSync.mockReset()
    markSynced.mockReset()
    markError.mockReset()
  })

  it('fans out one sync per connected client and marks each synced', async () => {
    listConnected.mockResolvedValue([
      { organizationId: 'org-1', connectionId: 'conn-1' },
      { organizationId: 'org-2', connectionId: 'conn-2' },
    ])
    runSync.mockResolvedValue(undefined)

    const result = await runGbpSync(new Date('2026-07-10T02:00:00Z'))

    expect(runSync).toHaveBeenCalledTimes(2)
    expect(markSynced).toHaveBeenCalledWith('conn-1')
    expect(markSynced).toHaveBeenCalledWith('conn-2')
    expect(result).toEqual({ total: 2, ok: 2, failed: 0 })
  })

  it('records an error on a failing connection without aborting the others', async () => {
    listConnected.mockResolvedValue([
      { organizationId: 'org-1', connectionId: 'conn-1' },
      { organizationId: 'org-2', connectionId: 'conn-2' },
    ])
    runSync
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValueOnce(undefined)

    const result = await runGbpSync(new Date('2026-07-10T02:00:00Z'))

    expect(markError).toHaveBeenCalledWith('conn-1', 'token expired')
    expect(markSynced).toHaveBeenCalledWith('conn-2')
    expect(result).toEqual({ total: 2, ok: 1, failed: 1 })
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/sync-job.test.ts`
Expected: FAIL — `@/inngest/functions/gbp-sync` (and the `connections` helper) do not exist.

- [ ] **Step 3: Implement the connection-list helper `src/integrations/gbp/connections.ts`**

```ts
import 'server-only'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { connection } from '@/db/schema' // Plan 06 table
import { GBP_PROVIDER } from './constants'

export interface GbpConnectionRef {
  organizationId: string
  connectionId: string
}

/** All connections with provider 'gbp' in a syncable (connected) status. */
export async function listConnectedGbpConnections(): Promise<GbpConnectionRef[]> {
  const rows = await db
    .select({ organizationId: connection.organizationId, connectionId: connection.id })
    .from(connection)
    .where(and(eq(connection.provider, GBP_PROVIDER), eq(connection.status, 'connected')))
  return rows
}
```

- [ ] **Step 4: Implement the runner + Inngest function `src/inngest/functions/gbp-sync.ts`**

```ts
import { inngest } from '@/inngest/client' // Plan 06 client
import { GBPConnector } from '@/integrations/gbp/connector'
import { listConnectedGbpConnections } from '@/integrations/gbp/connections'
import {
  markConnectionSynced,
  markConnectionError,
} from '@/integrations/connection-status' // Plan 06 helpers

export interface GbpSyncSummary {
  total: number
  ok: number
  failed: number
}

/**
 * Pure-ish runner (no Inngest step plumbing) so it is unit-testable. Fans out
 * one connector.sync per connected GBP connection; failures are isolated and
 * recorded on the connection (token expiry/revocation surfaces as `error`).
 */
export async function runGbpSync(now: Date): Promise<GbpSyncSummary> {
  const connections = await listConnectedGbpConnections()
  const connector = new GBPConnector()
  let ok = 0
  let failed = 0

  for (const ref of connections) {
    try {
      await connector.sync({
        organizationId: ref.organizationId,
        connectionId: ref.connectionId,
        now,
      })
      await markConnectionSynced(ref.connectionId)
      ok += 1
    } catch (err) {
      failed += 1
      await markConnectionError(
        ref.connectionId,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { total: connections.length, ok, failed }
}

/**
 * Nightly cron. Runs at 02:30 UTC — after GBP's daily processing and within our
 * ~5-day-lag rolling window. Wrapped in an Inngest step for retries/observability.
 */
export const gbpSync = inngest.createFunction(
  { id: 'gbp-nightly-sync', concurrency: { limit: 5 } },
  { cron: '30 2 * * *' },
  async ({ step }) => {
    return step.run('run-gbp-sync', () => runGbpSync(new Date()))
  },
)
```

- [ ] **Step 5: Register the function with Inngest**

Add `gbpSync` to the functions array served at the Inngest route (Plan 06's `src/app/api/inngest/route.ts`):
```ts
import { gbpSync } from '@/inngest/functions/gbp-sync'
// add gbpSync to the `functions: [...]` array passed to serve().
```

- [ ] **Step 6: Run the sync-job test and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/sync-job.test.ts`
Expected: both tests PASS — fan-out runs once per connection, successes mark synced, a failure marks error and isolates without aborting the rest.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(gbp): nightly Inngest sync with per-connection fan-out + status reconciliation"
```

---

## Task 8: Discovery persistence on connect + full suite green

When a GBP connection is established, discovery must persist mapped locations into `connection_account_map` so the nightly job has targets. We add a small "onConnect" step and verify the whole GBP suite + the RLS keystone run green together.

**Files:**
- Create: `src/integrations/gbp/on-connect.ts`
- Create: `tests/integrations/gbp/on-connect.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/gbp/on-connect.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const discover = vi.fn()
const upsertMap = vi.fn()

vi.mock('@/integrations/gbp/discovery', () => ({ discoverLocations: discover }))
vi.mock('@/integrations/account-map-store', () => ({ upsertAccountMapEntries: upsertMap }))

import { onGbpConnect } from '@/integrations/gbp/on-connect'

describe('onGbpConnect', () => {
  beforeEach(() => {
    discover.mockReset()
    upsertMap.mockReset()
  })

  it('discovers locations and persists them to connection_account_map', async () => {
    discover.mockResolvedValue([
      { connectionId: 'conn-1', externalAccountId: 'locations/100', kind: 'gbp_location', label: 'A' },
    ])
    const count = await onGbpConnect({ connectionId: 'conn-1' })
    expect(discover).toHaveBeenCalledWith({ connectionId: 'conn-1' })
    expect(upsertMap).toHaveBeenCalledOnce()
    const entries = upsertMap.mock.calls[0]![0]
    expect(entries[0].externalAccountId).toBe('locations/100')
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/gbp/on-connect.test.ts`
Expected: FAIL — `@/integrations/gbp/on-connect` does not exist.

- [ ] **Step 3: Implement `src/integrations/gbp/on-connect.ts`**

```ts
import 'server-only'
import { discoverLocations } from './discovery'
import { upsertAccountMapEntries } from '@/integrations/account-map-store' // Plan 06 helper

/**
 * Called when a GBP connection is established (or its "verify connection" /
 * reconnect action runs). Enumerates locations and persists them to
 * connection_account_map so the nightly sync has targets. Idempotent.
 * Returns the number of locations mapped.
 */
export async function onGbpConnect(input: { connectionId: string }): Promise<number> {
  const entries = await discoverLocations({ connectionId: input.connectionId })
  await upsertAccountMapEntries(entries)
  return entries.length
}
```

> `upsertAccountMapEntries` is the Plan 06 helper that idempotently writes `connection_account_map` rows (conflict target `(connection_id, external_account_id)`). If Plan 06 named it differently, use that name; the contract is "idempotently persist account-map entries."

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/integrations/gbp/on-connect.test.ts`
Expected: PASS — discovery results are persisted; the mapped count is returned.

- [ ] **Step 5: Run the FULL GBP suite + the RLS keystone**

Run:
```bash
pnpm test tests/integrations/gbp tests/rls/gbp-reviews.test.ts
```
Expected: every GBP test (normalize, discovery, fetchers, connector, monthly-rollup, sync-job, on-connect) and the `gbp_review` RLS isolation test PASS.

- [ ] **Step 6: Run the entire repo test suite + typecheck to confirm no regression**

Run:
```bash
pnpm test && pnpm tsc --noEmit
```
Expected: all tests green (Plan 01 RLS + auth + Plan 06 + Plan 09), TypeScript strict passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(gbp): persist discovered locations on connect; full GBP suite green"
```

---

## Self-Review

**Spec coverage (vs PRD §6.3 GBP + §6.5 Data-trust + §5.6 Local analytics):**
- OAuth `business.manage` sensitive scope; authed account manages each location (one consent covers all) → `constants.ts` (`GBP_SCOPE`) + `client.ts` (OAuth2Client with refresh) + approval notes. ✅
- Account/location discovery via Account Management + Business Information APIs → `discovery.ts` (Task 3), persisted on connect → `on-connect.ts` (Task 8). ✅
- Performance API daily metrics: sum the four `BUSINESS_IMPRESSIONS_*` into total impressions; `CALL_CLICKS`, `BUSINESS_DIRECTION_REQUESTS`, `WEBSITE_CLICKS`, `BUSINESS_CONVERSATIONS` → `constants.ts` metric sets + `normalize.ts` impressions-sum + `metrics.ts` fetch (Tasks 2, 4), asserted in `normalize.test.ts` + `connector.test.ts`. ✅
- Monthly search keywords → `fetchMonthlySearchKeywords` in `metrics.ts` (Task 4). ✅
- v4 reviews (rating + count) → `reviews.ts` + `normalizeReviews` + `gbp_review` table (Tasks 1, 2, 4); landed + asserted in `connector.test.ts`. ✅
- Aggregate to calendar months ourselves → `rollup.ts` `aggregateToCalendarMonths` (Task 6), tested in `monthly-rollup.test.ts`. ✅
- ~5-day lag handling + run monthly reports ~5 days into the new month → `GBP_LAG_DAYS`/`GBP_PROVISIONAL_DAYS`/`GBP_RESYNC_WINDOW_DAYS` + rolling window in `connector.ts`; provisional flagging asserted (Task 5) and propagated to monthly rollups (Task 6). ✅
- Timezone-offset day-boundary note → documented in `constants.ts` (`GBP_DATE_IS_LOCATION_LOCAL`); dates stored as location-local exactly as GBP reports. ✅
- TWO approval gates (GBP API allow-listing **and** sensitive-scope OAuth verification), uneven-per-API caveat, Day-1 start → `constants.ts` header doc (Task 0). ✅
- Q&A API is dead — never used → no Q&A call anywhere; explicitly noted in `constants.ts`. ✅
- MCP not on the data path → connector uses the official SDK/REST directly into our store; reads serve from our DB (PRD §6.1). ✅
- Data-trust §6.5: provisional flag on recent days carried to `metric_daily.is_provisional` and monthly rollups; idempotent upserts keep our own history; mock-based tests assert reproducible normalized rows. ✅ (The "as of" timestamp / freshness badge UI is an Analytics-aggregator concern, not this connector — out of scope here.)
- Tenant safety: `gbp_review` is tenant-scoped with `organization_id`-leading composite index, RLS enabled, policies reuse `public.has_org_access`; RLS isolation test added (KEYSTONE, Task 1). `metric_daily`/`metric_monthly_rollup`/`connection_account_map`/`connection` are Plan 06 tables (RLS owned there, not redefined). Job writes run as service_role; user-facing reads go through RLS. ✅

**Placeholder scan:** No `TBD`/`TODO`/"similar to above". Every code step contains complete code. The notes about Plan 06 naming (registry shape, `metric_monthly_rollup` month column, `upsertAccountMapEntries`) are explicit integration instructions against a declared dependency, not placeholders — each states the exact contract to match. ✅

**Type consistency:** `GBP_PROVIDER` (`'gbp'`) is the single provider id across constants, normalize, store, connections, and the Inngest job. Normalized metric names (`impressions_total`, `call_clicks`, `direction_requests`, `website_clicks`, `conversations`) are defined once in `GBP_NORMALIZED_METRICS` and reused. `NormalizedMetricRow`/`MetricRowToStore`/`NormalizedReview`/`MonthlyRollupRow` flow consistently from `normalize.ts` → `store.ts` → `connector.ts` → `rollup.ts`. `GbpReview`/`NewGbpReview` exported from `src/db/types.ts` mirror the schema. The `Connector`/`SyncContext` interface and `metricDaily`/`metricMonthlyRollup`/`connection`/`connectionAccountMap` tables are imported from Plan 06 and used by their documented shapes. ✅

**Definition of done for Plan 09:** `pnpm test && pnpm tsc --noEmit` green — all GBP unit tests (normalize, discovery, fetchers, connector, monthly-rollup, sync-job, on-connect) plus the `gbp_review` RLS isolation keystone pass; the connector is registered in the Plan 06 registry; the nightly Inngest function is served; mocked-API tests prove normalized metric rows (impressions summed) + review snapshots land in the store; both approval gates and the dead-Q&A constraint are documented in code.
