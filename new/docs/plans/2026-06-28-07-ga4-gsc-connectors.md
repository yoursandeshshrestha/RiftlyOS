# Agency OS — Plan 07: GA4 & Search Console Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the **Google Analytics 4** (Data API + Admin API) and **Google Search Console** (Search Analytics API) connectors against the Plan 06 `Connector` interface, so that a nightly Inngest sync pulls per-property metrics, normalizes them, and lands them — idempotently and tenant-scoped — in `metric_daily` with `provider` tags. GA4 uses service-account-added-to-property auth (primary) with OAuth-offline fallback, discovers properties via `accountSummaries.list`, pulls sessions/users/keyEvents/channel metrics nightly with a trailing-3-day re-sync, and is quota-aware (`returnPropertyQuota`). GSC uses `webmasters.readonly`, pulls clicks/impressions/CTR/position by query and page, keeps a 16-month rolling window, handles the ~2–3 day lag, and **stores property-level totals separately from query rows** (because query anonymization means query rows never sum to totals). Both Google API clients are **mocked** in tests; we assert normalized rows land in `metric_daily`.

**Architecture:** This plan adds two `Connector` implementations to the Plan 06 integration backbone. The dashboard never calls Google on page load (PRD §6.1 Plane A): connectors `fetch()` raw Google responses → `normalize()` them into canonical `MetricDailyRow[]` → the Plan 06 sync runner upserts them into `metric_daily` keyed by `(client_id, provider, account_id, entity, date, metric)`. Credentials come from the Plan 06 token vault (`oauth_token`, vault-backed) accessed only by server-side service-role code; property/site IDs come from `connection_account_map`. Re-sync windows (GA4: trailing 3 days; GSC: 16-month rolling, lag-aware) absorb late/adjusted Google data. The most recent ~3 days are flagged `is_provisional = true` (PRD §6.5). Per-provider connect-flow instructions ship as docs the onboarding wizard (Plan 05) and connection-health dashboard render.

**Tech Stack:** Next.js 16 · TypeScript (strict) · pnpm · Supabase Postgres + Vault · Drizzle ORM + drizzle-kit · postgres.js · Inngest (sync cron + fan-out, from Plan 06) · `@google-analytics/data` (GA4 Data API) · `googleapis` (GA4 Admin API `analyticsadmin` + Search Console `searchconsole`/`webmasters`) · `google-auth-library` (service-account + OAuth2 JWT/refresh) · Vitest (unit + integration incl. RLS isolation; Google clients mocked via `vi.mock`).

**Dependencies (assume already built — do NOT re-spec):**
- **Plan 01 (Foundation):** `organizations`/`profiles`/`memberships`, `org_type`/`app_role` enums, `public.has_org_access(uuid)` + `public.is_agency_staff()` SECURITY DEFINER helpers, the `custom_access_token_hook`, the seed (`scripts/seed.ts`), and the RLS test harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`).
- **Plan 06 (Connector framework + sync backbone):** the `connection`, `connection_account_map`, `oauth_token` (vault-backed), and `metric_daily` tables; the `provider` enum; the `Connector` TypeScript interface (`src/lib/connectors/types.ts`); the token-vault accessor (`src/lib/connectors/vault.ts` → `getCredential(connectionId)`); the connector registry (`src/lib/connectors/registry.ts`); the sync runner (`src/lib/connectors/run-sync.ts` → `upsertMetricDaily()`); and the Inngest nightly cron + per-connection fan-out (`src/inngest/sync.ts`). This plan registers two new connectors into that machinery and adds **no** new sync-orchestration code beyond registration.

> **Plan 06 contracts this plan binds to (reproduced verbatim so the steps are self-contained).** These already exist; do not recreate them. They are quoted here only so the code below compiles against known shapes.
>
> `src/lib/connectors/types.ts`:
> ```ts
> // Canonical normalized row — one (date, metric) measurement for one entity.
> export type MetricDailyRow = {
>   clientId: string            // organization_id of the client org (tenant)
>   provider: Provider          // 'ga4' | 'gsc' | 'google_ads' | 'meta_ads' | 'gbp' | 'stripe'
>   accountId: string           // external property/site id, e.g. 'properties/123' or 'sc-domain:x.com'
>   entity: string              // dimension bucket, e.g. 'property' | 'channel:Organic Search' | 'query:foo'
>   date: string                // 'YYYY-MM-DD' (property/site timezone day)
>   metric: string              // 'sessions' | 'clicks' | ...
>   value: number               // numeric value (already unit-normalized)
>   isProvisional: boolean       // true for the most-recent ~N days (PRD §6.5)
> }
>
> export type Provider = 'ga4' | 'gsc' | 'google_ads' | 'meta_ads' | 'gbp' | 'stripe'
>
> // What the sync runner hands every connector for one connection.
> export type SyncContext = {
>   connectionId: string
>   clientId: string            // tenant org id
>   accountIds: string[]        // from connection_account_map (kind='property'|'site')
>   credential: ConnectorCredential
>   // [start, end] inclusive UTC dates the runner asks us to (re)sync.
>   window: { start: string; end: string }
>   logger: { info: (m: string, meta?: unknown) => void; warn: (m: string, meta?: unknown) => void }
> }
>
> // From the vault. Exactly one of serviceAccount | oauth is present.
> export type ConnectorCredential =
>   | { kind: 'service_account'; serviceAccount: { client_email: string; private_key: string } }
>   | { kind: 'oauth'; oauth: { refreshToken: string; clientId: string; clientSecret: string } }
>
> export interface Connector {
>   readonly provider: Provider
>   // Discover external accounts this credential can see (onboarding/verify).
>   discover(credential: ConnectorCredential): Promise<DiscoveredAccount[]>
>   // Pull + normalize for the given window. Pure of DB writes — runner persists.
>   fetchAndNormalize(ctx: SyncContext): Promise<MetricDailyRow[]>
>   // Cheap call proving data is retrievable (connection-health "verify").
>   verify(ctx: Pick<SyncContext, 'accountIds' | 'credential'>): Promise<VerifyResult>
> }
>
> export type DiscoveredAccount = { externalId: string; kind: string; displayName: string }
> export type VerifyResult = { ok: boolean; detail: string }
> ```
>
> `src/lib/connectors/registry.ts` exports `registerConnector(c: Connector)` and `getConnector(p: Provider)`.
> `src/lib/connectors/run-sync.ts` exports `upsertMetricDaily(rows: MetricDailyRow[]): Promise<number>` (idempotent ON CONFLICT upsert on the `metric_daily` natural key, runs as service-role) and `PROVISIONAL_DAYS = 3`.
> `src/lib/connectors/vault.ts` exports `getCredential(connectionId: string): Promise<ConnectorCredential>`.

---

## File Structure (created by this plan)

```
.
├─ src/
│  └─ lib/
│     └─ connectors/
│        ├─ ga4/
│        │  ├─ client.ts            # GA4 Data + Admin client factory (auth assembly)
│        │  ├─ ga4-connector.ts     # GA4Connector implements Connector
│        │  ├─ normalize.ts         # GA4 report rows -> MetricDailyRow[]
│        │  └─ constants.ts         # metric/dimension names, quota, provisional window
│        ├─ gsc/
│        │  ├─ client.ts            # Search Console client factory (auth assembly)
│        │  ├─ gsc-connector.ts     # GSCConnector implements Connector
│        │  ├─ normalize.ts         # GSC rows -> MetricDailyRow[] (totals vs query/page)
│        │  └─ constants.ts         # row limits, lag days, 16-month window, dimensions
│        └─ register-google.ts      # registers GA4 + GSC into the Plan 06 registry
├─ docs/
│  └─ connect-flows/
│     ├─ ga4.md                     # GA4 service-account + OAuth-fallback connect flow
│     └─ gsc.md                     # GSC per-property grant connect flow
└─ tests/
   ├─ connectors/
   │  ├─ ga4-normalize.test.ts      # unit: normalization (mocked rows)
   │  ├─ ga4-connector.test.ts      # integration: fetchAndNormalize w/ mocked GA4 client
   │  ├─ gsc-normalize.test.ts      # unit: totals vs query rows, anonymization
   │  ├─ gsc-connector.test.ts      # integration: fetchAndNormalize w/ mocked GSC client
   │  └─ metric-daily-landing.test.ts  # end-to-end: rows land in metric_daily (provider tags)
   └─ rls/
      └─ metric-daily-isolation.test.ts # RLS: client sees only own metric_daily (if added here)
```

> **Note on `metric_daily` ownership:** Plan 06 created `metric_daily` and its RLS policy. This plan does **not** redefine the table. The `tests/rls/metric-daily-isolation.test.ts` here is an **additive** isolation test asserting the connectors' provider-tagged rows respect the existing policy — it is included only because this plan is the first to write real GA4/GSC rows. If Plan 06 already ships this exact test, skip Task 9 and note it in Self-Review.

---

## Task 1: Install Google API client libraries

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the Google client libraries (runtime deps)**

Run:
```bash
pnpm add @google-analytics/data googleapis google-auth-library
```
- `@google-analytics/data` — GA4 **Data API v1beta** (`BetaAnalyticsDataClient.runReport`).
- `googleapis` — GA4 **Admin API** (`analyticsadmin.accountSummaries.list`) and **Search Console** (`searchconsole.searchanalytics.query`, `sites.list`).
- `google-auth-library` — `GoogleAuth`/`JWT` (service account) and `OAuth2Client` (refresh-token fallback).

- [ ] **Step 2: Pin the Google Ads/Graph-style version note**

These Google libraries are version-pinned by package; PRD §11 requires pinning external API surfaces. Confirm the resolved versions are written to the lockfile:
```bash
pnpm why @google-analytics/data googleapis google-auth-library | head -n 20
```
Expected: each package resolves to a single pinned version recorded in `pnpm-lock.yaml`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(connectors): add Google API client libraries (GA4 Data/Admin, Search Console)"
```

---

## Task 2: GA4 client factory and constants

**Files:**
- Create: `src/lib/connectors/ga4/constants.ts`, `src/lib/connectors/ga4/client.ts`

The client factory turns a Plan 06 `ConnectorCredential` into authenticated GA4 Data + Admin clients. It is the only place auth assembly lives, so connector logic stays testable (we mock these factory outputs in tests).

- [ ] **Step 1: Write `src/lib/connectors/ga4/constants.ts`**

```ts
// GA4 Data API metric/dimension names and sync tuning.
// Docs: developers.google.com/analytics/devguides/reporting/data/v1

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

// Metrics we pull. Keys are GA4 metric API names; values are our canonical metric names.
export const GA4_METRICS = {
  sessions: 'sessions',
  totalUsers: 'users',
  newUsers: 'newUsers',
  engagementRate: 'engagementRate',
  keyEvents: 'keyEvents', // GA4 "key events" == conversions/leads
} as const

export type Ga4ApiMetric = keyof typeof GA4_METRICS

// The channel-mix dimension (PRD §6.3).
export const GA4_CHANNEL_DIMENSION = 'sessionDefaultChannelGroup'

// Re-pull the trailing N days every night (24–48h processing lag); these are provisional.
export const GA4_RESYNC_TRAILING_DAYS = 3

// Quota / concurrency guardrails (PRD §6.3).
export const GA4_RETURN_PROPERTY_QUOTA = true
export const GA4_MAX_CONCURRENCY_PER_PROPERTY = 10

// Property resource names look like "properties/123456789".
export function isPropertyResourceName(id: string): boolean {
  return /^properties\/\d+$/.test(id)
}
```

- [ ] **Step 2: Write `src/lib/connectors/ga4/client.ts`**

```ts
import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { google, type analyticsadmin_v1beta } from 'googleapis'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import type { ConnectorCredential } from '@/lib/connectors/types'
import { GA4_SCOPE } from './constants'

// Build a google-auth credential object from our vault credential.
function authFromCredential(credential: ConnectorCredential): GoogleAuth | OAuth2Client {
  if (credential.kind === 'service_account') {
    return new GoogleAuth({
      scopes: [GA4_SCOPE],
      credentials: {
        client_email: credential.serviceAccount.client_email,
        private_key: credential.serviceAccount.private_key,
      },
    })
  }
  const oauth = new OAuth2Client(credential.oauth.clientId, credential.oauth.clientSecret)
  oauth.setCredentials({ refresh_token: credential.oauth.refreshToken })
  return oauth
}

export type Ga4Clients = {
  data: BetaAnalyticsDataClient
  admin: analyticsadmin_v1beta.Analyticsadmin
}

// Factory: turns a vault credential into authenticated Data + Admin clients.
// Mocked wholesale in tests via vi.mock('./client').
export function createGa4Clients(credential: ConnectorCredential): Ga4Clients {
  const auth = authFromCredential(credential)

  const data =
    credential.kind === 'service_account'
      ? new BetaAnalyticsDataClient({
          credentials: {
            client_email: credential.serviceAccount.client_email,
            private_key: credential.serviceAccount.private_key,
          },
        })
      : new BetaAnalyticsDataClient({ authClient: auth as OAuth2Client })

  const admin = google.analyticsadmin({ version: 'v1beta', auth: auth as GoogleAuth })

  return { data, admin }
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors in the two new files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ga4): GA4 client factory + constants (Data + Admin auth assembly)"
```

---

## Task 3: GA4 normalization — write the failing unit test, then implement

**Files:**
- Create: `tests/connectors/ga4-normalize.test.ts`
- Create: `src/lib/connectors/ga4/normalize.ts`

We normalize two GA4 report shapes into `MetricDailyRow[]`:
1. **Property-level daily metrics** (dimension: `date`) → `entity='property'`.
2. **Channel-mix daily metrics** (dimensions: `date`,`sessionDefaultChannelGroup`) → `entity='channel:<group>'`, metric `sessions`.

`engagementRate` arrives 0–1; we store it as-is (a ratio). `keyEvents` is the conversions/leads count. Provisional flagging is computed against the sync window end.

- [ ] **Step 1: Write the failing test `tests/connectors/ga4-normalize.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeGa4Reports } from '@/lib/connectors/ga4/normalize'

// Minimal shape mirroring @google-analytics/data runReport responses.
const propertyReport = {
  dimensionHeaders: [{ name: 'date' }],
  metricHeaders: [
    { name: 'sessions' },
    { name: 'totalUsers' },
    { name: 'newUsers' },
    { name: 'engagementRate' },
    { name: 'keyEvents' },
  ],
  rows: [
    {
      dimensionValues: [{ value: '20260626' }],
      metricValues: [
        { value: '1200' }, { value: '900' }, { value: '300' },
        { value: '0.62' }, { value: '45' },
      ],
    },
    {
      dimensionValues: [{ value: '20260627' }],
      metricValues: [
        { value: '1500' }, { value: '1100' }, { value: '400' },
        { value: '0.58' }, { value: '52' },
      ],
    },
  ],
}

const channelReport = {
  dimensionHeaders: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
  metricHeaders: [{ name: 'sessions' }],
  rows: [
    { dimensionValues: [{ value: '20260627' }, { value: 'Organic Search' }], metricValues: [{ value: '800' }] },
    { dimensionValues: [{ value: '20260627' }, { value: 'Direct' }], metricValues: [{ value: '400' }] },
  ],
}

describe('normalizeGa4Reports', () => {
  it('maps property report rows to canonical MetricDailyRow[] with provider/account tags', () => {
    const rows = normalizeGa4Reports({
      clientId: 'org-client-1',
      accountId: 'properties/123456789',
      propertyReport,
      channelReport: null,
      windowEnd: '20260629',
    })

    const day26 = rows.filter((r) => r.date === '2026-06-26')
    expect(day26.every((r) => r.provider === 'ga4')).toBe(true)
    expect(day26.every((r) => r.accountId === 'properties/123456789')).toBe(true)
    expect(day26.every((r) => r.clientId === 'org-client-1')).toBe(true)
    expect(day26.every((r) => r.entity === 'property')).toBe(true)

    const m = Object.fromEntries(day26.map((r) => [r.metric, r.value]))
    expect(m.sessions).toBe(1200)
    expect(m.users).toBe(900)
    expect(m.newUsers).toBe(300)
    expect(m.engagementRate).toBeCloseTo(0.62)
    expect(m.keyEvents).toBe(45)
  })

  it('reformats GA4 YYYYMMDD dates to ISO YYYY-MM-DD', () => {
    const rows = normalizeGa4Reports({
      clientId: 'c', accountId: 'properties/1', propertyReport, channelReport: null, windowEnd: '20260629',
    })
    expect(rows.some((r) => r.date === '2026-06-26')).toBe(true)
    expect(rows.some((r) => r.date === '20260626')).toBe(false)
  })

  it('emits channel rows as entity="channel:<group>" with metric sessions', () => {
    const rows = normalizeGa4Reports({
      clientId: 'c', accountId: 'properties/1', propertyReport: null, channelReport, windowEnd: '20260629',
    })
    const organic = rows.find((r) => r.entity === 'channel:Organic Search')
    expect(organic).toBeDefined()
    expect(organic!.metric).toBe('sessions')
    expect(organic!.value).toBe(800)
    expect(rows.find((r) => r.entity === 'channel:Direct')!.value).toBe(400)
  })

  it('flags the most-recent 3 days (incl. window end) as provisional', () => {
    const rows = normalizeGa4Reports({
      clientId: 'c', accountId: 'properties/1', propertyReport, channelReport: null, windowEnd: '20260629',
    })
    // window end 2026-06-29 => provisional cutoff is 2026-06-27 (29,28,27).
    expect(rows.find((r) => r.date === '2026-06-27')!.isProvisional).toBe(true)
    expect(rows.find((r) => r.date === '2026-06-26')!.isProvisional).toBe(false)
  })

  it('returns [] for empty reports without throwing', () => {
    expect(
      normalizeGa4Reports({ clientId: 'c', accountId: 'properties/1', propertyReport: null, channelReport: null, windowEnd: '20260629' }),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/connectors/ga4-normalize.test.ts`
Expected: FAIL — `normalizeGa4Reports` is not exported yet (module not found / not a function).

- [ ] **Step 3: Implement `src/lib/connectors/ga4/normalize.ts`**

```ts
import 'server-only'
import type { MetricDailyRow } from '@/lib/connectors/types'
import { GA4_METRICS, GA4_RESYNC_TRAILING_DAYS, type Ga4ApiMetric } from './constants'

// Loose shape mirroring the parts of runReport responses we read.
export type Ga4Report = {
  dimensionHeaders?: Array<{ name?: string | null }> | null
  metricHeaders?: Array<{ name?: string | null }> | null
  rows?: Array<{
    dimensionValues?: Array<{ value?: string | null }> | null
    metricValues?: Array<{ value?: string | null }> | null
  }> | null
} | null

type NormalizeArgs = {
  clientId: string
  accountId: string
  propertyReport: Ga4Report
  channelReport: Ga4Report
  windowEnd: string // GA4 'YYYYMMDD'
}

// 'YYYYMMDD' -> 'YYYY-MM-DD'
function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

// A date is provisional if it falls within the trailing re-sync window from windowEnd.
function provisionalChecker(windowEnd: string): (iso: string) => boolean {
  const end = new Date(`${isoDate(windowEnd)}T00:00:00Z`)
  const cutoff = new Date(end)
  cutoff.setUTCDate(cutoff.getUTCDate() - (GA4_RESYNC_TRAILING_DAYS - 1))
  return (iso: string) => new Date(`${iso}T00:00:00Z`) >= cutoff
}

function headerIndex(headers: Array<{ name?: string | null }> | null | undefined, name: string): number {
  return (headers ?? []).findIndex((h) => h?.name === name)
}

export function normalizeGa4Reports(args: NormalizeArgs): MetricDailyRow[] {
  const { clientId, accountId, propertyReport, channelReport, windowEnd } = args
  const isProvisional = provisionalChecker(windowEnd)
  const out: MetricDailyRow[] = []

  // --- Property-level daily metrics (dimension: date) ---
  if (propertyReport?.rows?.length) {
    const dateIdx = headerIndex(propertyReport.dimensionHeaders, 'date')
    const metricCols = (propertyReport.metricHeaders ?? []).map((h) => h?.name ?? '')
    for (const row of propertyReport.rows) {
      const raw = row.dimensionValues?.[dateIdx]?.value
      if (!raw) continue
      const date = isoDate(raw)
      const prov = isProvisional(date)
      metricCols.forEach((apiName, i) => {
        const canonical = GA4_METRICS[apiName as Ga4ApiMetric]
        if (!canonical) return
        const v = Number(row.metricValues?.[i]?.value ?? '0')
        out.push({
          clientId, provider: 'ga4', accountId, entity: 'property',
          date, metric: canonical, value: Number.isFinite(v) ? v : 0, isProvisional: prov,
        })
      })
    }
  }

  // --- Channel mix (dimensions: date, sessionDefaultChannelGroup) ---
  if (channelReport?.rows?.length) {
    const dateIdx = headerIndex(channelReport.dimensionHeaders, 'date')
    const chanIdx = headerIndex(channelReport.dimensionHeaders, 'sessionDefaultChannelGroup')
    const sessionsCol = (channelReport.metricHeaders ?? []).findIndex((h) => h?.name === 'sessions')
    for (const row of channelReport.rows) {
      const raw = row.dimensionValues?.[dateIdx]?.value
      const group = row.dimensionValues?.[chanIdx]?.value
      if (!raw || !group) continue
      const date = isoDate(raw)
      const v = Number(row.metricValues?.[sessionsCol]?.value ?? '0')
      out.push({
        clientId, provider: 'ga4', accountId, entity: `channel:${group}`,
        date, metric: 'sessions', value: Number.isFinite(v) ? v : 0, isProvisional: isProvisional(date),
      })
    }
  }

  return out
}
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/connectors/ga4-normalize.test.ts`
Expected: all six assertions pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ga4): normalize GA4 reports to canonical MetricDailyRow[] (TDD)"
```

---

## Task 4: GA4Connector — write the failing integration test, then implement

**Files:**
- Create: `tests/connectors/ga4-connector.test.ts`
- Create: `src/lib/connectors/ga4/ga4-connector.ts`

The connector wires the client factory + normalizer behind the Plan 06 `Connector` interface: `discover()` lists properties via `accountSummaries.list`; `fetchAndNormalize()` runs two `runReport` calls per property (property metrics + channel mix) with `returnPropertyQuota=true`; `verify()` runs a cheap 1-day report. Tests mock `./client` so no network is hit.

- [ ] **Step 1: Write the failing test `tests/connectors/ga4-connector.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the client factory so no Google network call happens.
const runReport = vi.fn()
const listAccountSummaries = vi.fn()

vi.mock('@/lib/connectors/ga4/client', () => ({
  createGa4Clients: () => ({
    data: { runReport },
    admin: { accountSummaries: { list: listAccountSummaries } },
  }),
}))

import { Ga4Connector } from '@/lib/connectors/ga4/ga4-connector'
import type { ConnectorCredential, SyncContext } from '@/lib/connectors/types'

const credential: ConnectorCredential = {
  kind: 'service_account',
  serviceAccount: { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: 'KEY' },
}

const noopLogger = { info: vi.fn(), warn: vi.fn() }

function ctx(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    connectionId: 'conn-1',
    clientId: 'org-client-1',
    accountIds: ['properties/123456789'],
    credential,
    window: { start: '2026-06-26', end: '2026-06-29' },
    logger: noopLogger,
    ...overrides,
  }
}

beforeEach(() => {
  runReport.mockReset()
  listAccountSummaries.mockReset()
})

describe('Ga4Connector', () => {
  it('declares provider ga4', () => {
    expect(new Ga4Connector().provider).toBe('ga4')
  })

  it('discover() lists properties via accountSummaries.list', async () => {
    listAccountSummaries.mockResolvedValue({
      data: {
        accountSummaries: [
          {
            account: 'accounts/111', displayName: 'Acme',
            propertySummaries: [
              { property: 'properties/123456789', displayName: 'Acme Web' },
              { property: 'properties/987654321', displayName: 'Acme App' },
            ],
          },
        ],
      },
    })
    const found = await new Ga4Connector().discover(credential)
    expect(found).toEqual([
      { externalId: 'properties/123456789', kind: 'property', displayName: 'Acme Web' },
      { externalId: 'properties/987654321', kind: 'property', displayName: 'Acme App' },
    ])
  })

  it('fetchAndNormalize() runs property + channel reports and returns canonical rows', async () => {
    // First call: property report. Second call: channel report.
    runReport
      .mockResolvedValueOnce([
        {
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [
            { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
            { name: 'engagementRate' }, { name: 'keyEvents' },
          ],
          rows: [
            { dimensionValues: [{ value: '20260627' }], metricValues: [
              { value: '1500' }, { value: '1100' }, { value: '400' }, { value: '0.58' }, { value: '52' },
            ] },
          ],
          propertyQuota: { tokensPerHour: { consumed: 5, remaining: 1995 } },
        },
      ])
      .mockResolvedValueOnce([
        {
          dimensionHeaders: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
          metricHeaders: [{ name: 'sessions' }],
          rows: [
            { dimensionValues: [{ value: '20260627' }, { value: 'Organic Search' }], metricValues: [{ value: '800' }] },
          ],
        },
      ])

    const rows = await new Ga4Connector().fetchAndNormalize(ctx())

    // runReport called twice (property + channel) for the single property.
    expect(runReport).toHaveBeenCalledTimes(2)
    // Quota request flag is set.
    expect(runReport.mock.calls[0][0].returnPropertyQuota).toBe(true)
    // property resource name passed through.
    expect(runReport.mock.calls[0][0].property).toBe('properties/123456789')

    const sessions = rows.find((r) => r.entity === 'property' && r.metric === 'sessions')
    expect(sessions).toMatchObject({ provider: 'ga4', accountId: 'properties/123456789', value: 1500, date: '2026-06-27' })
    expect(rows.some((r) => r.entity === 'channel:Organic Search' && r.value === 800)).toBe(true)
  })

  it('fetchAndNormalize() iterates every property in accountIds', async () => {
    runReport.mockResolvedValue([{ dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'sessions' }], rows: [] }])
    await new Ga4Connector().fetchAndNormalize(ctx({ accountIds: ['properties/1', 'properties/2'] }))
    // 2 reports per property * 2 properties = 4 calls.
    expect(runReport).toHaveBeenCalledTimes(4)
  })

  it('verify() returns ok when a 1-day report resolves', async () => {
    runReport.mockResolvedValue([{ rows: [{ dimensionValues: [{ value: '20260628' }], metricValues: [{ value: '1' }] }] }])
    const res = await new Ga4Connector().verify({ accountIds: ['properties/1'], credential })
    expect(res.ok).toBe(true)
  })

  it('verify() returns not-ok with detail when the report throws', async () => {
    runReport.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const res = await new Ga4Connector().verify({ accountIds: ['properties/1'], credential })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('PERMISSION_DENIED')
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/connectors/ga4-connector.test.ts`
Expected: FAIL — `Ga4Connector` is not exported yet.

- [ ] **Step 3: Implement `src/lib/connectors/ga4/ga4-connector.ts`**

```ts
import 'server-only'
import type {
  Connector, ConnectorCredential, DiscoveredAccount, MetricDailyRow, SyncContext, VerifyResult,
} from '@/lib/connectors/types'
import { createGa4Clients } from './client'
import { normalizeGa4Reports, type Ga4Report } from './normalize'
import {
  GA4_CHANNEL_DIMENSION, GA4_RETURN_PROPERTY_QUOTA, isPropertyResourceName,
} from './constants'

// The @google-analytics/data client returns [response, request, options];
// we read the first element.
function firstOf<T>(res: unknown): T {
  return (Array.isArray(res) ? res[0] : res) as T
}

const GA4_METRIC_REQUEST = [
  { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
  { name: 'engagementRate' }, { name: 'keyEvents' },
]

export class Ga4Connector implements Connector {
  readonly provider = 'ga4' as const

  async discover(credential: ConnectorCredential): Promise<DiscoveredAccount[]> {
    const { admin } = createGa4Clients(credential)
    const res = await admin.accountSummaries.list({ pageSize: 200 })
    const summaries = res.data?.accountSummaries ?? []
    const out: DiscoveredAccount[] = []
    for (const acct of summaries) {
      for (const p of acct.propertySummaries ?? []) {
        if (!p.property) continue
        out.push({ externalId: p.property, kind: 'property', displayName: p.displayName ?? p.property })
      }
    }
    return out
  }

  async fetchAndNormalize(ctx: SyncContext): Promise<MetricDailyRow[]> {
    const { data } = createGa4Clients(ctx.credential)
    const dateRanges = [{ startDate: ctx.window.start, endDate: ctx.window.end }]
    const windowEnd = ctx.window.end.replace(/-/g, '') // -> 'YYYYMMDD' for normalizer
    const all: MetricDailyRow[] = []

    for (const property of ctx.accountIds) {
      if (!isPropertyResourceName(property)) {
        ctx.logger.warn('ga4: skipping non-property accountId', { property })
        continue
      }

      const propertyRes = await data.runReport({
        property,
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: GA4_METRIC_REQUEST,
        returnPropertyQuota: GA4_RETURN_PROPERTY_QUOTA,
        keepEmptyRows: false,
      })
      const propertyReport = firstOf<Ga4Report>(propertyRes)

      const channelRes = await data.runReport({
        property,
        dateRanges,
        dimensions: [{ name: 'date' }, { name: GA4_CHANNEL_DIMENSION }],
        metrics: [{ name: 'sessions' }],
        returnPropertyQuota: GA4_RETURN_PROPERTY_QUOTA,
        keepEmptyRows: false,
      })
      const channelReport = firstOf<Ga4Report>(channelRes)

      const quota = (propertyReport as { propertyQuota?: unknown })?.propertyQuota
      if (quota) ctx.logger.info('ga4: property quota', { property, quota })

      all.push(
        ...normalizeGa4Reports({
          clientId: ctx.clientId, accountId: property, propertyReport, channelReport, windowEnd,
        }),
      )
    }
    return all
  }

  async verify(ctx: Pick<SyncContext, 'accountIds' | 'credential'>): Promise<VerifyResult> {
    const property = ctx.accountIds[0]
    if (!property) return { ok: false, detail: 'no property mapped to this connection' }
    try {
      const { data } = createGa4Clients(ctx.credential)
      await data.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        metrics: [{ name: 'sessions' }],
        limit: 1,
        returnPropertyQuota: GA4_RETURN_PROPERTY_QUOTA,
      })
      return { ok: true, detail: `verified ${property}` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/connectors/ga4-connector.test.ts`
Expected: all assertions pass; `runReport` invoked the expected number of times; quota flag asserted.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ga4): GA4Connector (discover/fetchAndNormalize/verify) against Plan 06 interface (TDD)"
```

---

## Task 5: GSC client factory and constants

**Files:**
- Create: `src/lib/connectors/gsc/constants.ts`, `src/lib/connectors/gsc/client.ts`

- [ ] **Step 1: Write `src/lib/connectors/gsc/constants.ts`**

```ts
// Search Console Search Analytics API tuning.
// Docs: developers.google.com/webmaster-tools/v1/searchanalytics/query

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

// Max rows per query page; we paginate with startRow.
export const GSC_ROW_LIMIT = 25000

// ~2–3 day lag before data is final. We only treat fully-final days as non-provisional.
export const GSC_LAG_DAYS = 3

// Google deletes data older than 16 months, so we own a 16-month rolling window.
export const GSC_ROLLING_MONTHS = 16

// We pull two row sets per day-range:
//  - totals: no dimensions except 'date' => property-level totals (authoritative).
//  - query rows: ['date','query'] and ['date','page'] => detail (does NOT sum to totals
//    because ~47% of clicks are anonymized; see PRD §6.3).
export const GSC_QUERY_DIMENSIONS = ['date', 'query'] as const
export const GSC_PAGE_DIMENSIONS = ['date', 'page'] as const

// Use finalized data for reporting.
export const GSC_DATA_STATE = 'final' as const

// Canonical metric names we store from each GSC row.
export const GSC_METRICS = ['clicks', 'impressions', 'ctr', 'position'] as const
export type GscMetric = (typeof GSC_METRICS)[number]
```

- [ ] **Step 2: Write `src/lib/connectors/gsc/client.ts`**

```ts
import { google, type searchconsole_v1 } from 'googleapis'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import type { ConnectorCredential } from '@/lib/connectors/types'
import { GSC_SCOPE } from './constants'

function authFromCredential(credential: ConnectorCredential): GoogleAuth | OAuth2Client {
  if (credential.kind === 'service_account') {
    return new GoogleAuth({
      scopes: [GSC_SCOPE],
      credentials: {
        client_email: credential.serviceAccount.client_email,
        private_key: credential.serviceAccount.private_key,
      },
    })
  }
  const oauth = new OAuth2Client(credential.oauth.clientId, credential.oauth.clientSecret)
  oauth.setCredentials({ refresh_token: credential.oauth.refreshToken })
  return oauth
}

export type GscClient = searchconsole_v1.Searchconsole

// Factory: turns a vault credential into an authenticated Search Console client.
// Mocked wholesale in tests via vi.mock('./client').
export function createGscClient(credential: ConnectorCredential): GscClient {
  const auth = authFromCredential(credential)
  return google.searchconsole({ version: 'v1', auth: auth as GoogleAuth })
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(gsc): Search Console client factory + constants"
```

---

## Task 6: GSC normalization — write the failing unit test, then implement

**Files:**
- Create: `tests/connectors/gsc-normalize.test.ts`
- Create: `src/lib/connectors/gsc/normalize.ts`

The critical correctness rule (PRD §6.3): **store property-level totals separately from query/page rows**, because anonymization means query rows never sum to totals. Totals → `entity='property'`; query rows → `entity='query:<q>'`; page rows → `entity='page:<url>'`. We store `clicks`/`impressions`/`ctr`/`position` for each.

- [ ] **Step 1: Write the failing test `tests/connectors/gsc-normalize.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeGscRows } from '@/lib/connectors/gsc/normalize'

// Totals rows: keys=[date] only.
const totalsRows = [
  { keys: ['2026-06-20'], clicks: 1000, impressions: 50000, ctr: 0.02, position: 8.4 },
  { keys: ['2026-06-21'], clicks: 1100, impressions: 52000, ctr: 0.021, position: 8.1 },
]

// Query rows: keys=[date, query]. These do NOT sum to totals (anonymization).
const queryRows = [
  { keys: ['2026-06-20', 'blue widgets'], clicks: 120, impressions: 4000, ctr: 0.03, position: 5.2 },
  { keys: ['2026-06-20', 'red widgets'], clicks: 80, impressions: 3000, ctr: 0.0267, position: 6.1 },
]

const pageRows = [
  { keys: ['2026-06-20', 'https://x.com/a'], clicks: 200, impressions: 6000, ctr: 0.033, position: 4.9 },
]

describe('normalizeGscRows', () => {
  it('tags property-level totals with entity="property"', () => {
    const rows = normalizeGscRows({
      clientId: 'org-1', accountId: 'sc-domain:x.com', totalsRows, queryRows: [], pageRows: [], windowEnd: '2026-06-23', lagDays: 3,
    })
    const day = rows.filter((r) => r.date === '2026-06-20' && r.entity === 'property')
    const m = Object.fromEntries(day.map((r) => [r.metric, r.value]))
    expect(m.clicks).toBe(1000)
    expect(m.impressions).toBe(50000)
    expect(m.ctr).toBeCloseTo(0.02)
    expect(m.position).toBeCloseTo(8.4)
    expect(day.every((r) => r.provider === 'gsc')).toBe(true)
    expect(day.every((r) => r.accountId === 'sc-domain:x.com')).toBe(true)
  })

  it('tags query rows with entity="query:<q>" (kept separate from totals)', () => {
    const rows = normalizeGscRows({
      clientId: 'c', accountId: 'sc-domain:x.com', totalsRows: [], queryRows, pageRows: [], windowEnd: '2026-06-23', lagDays: 3,
    })
    const blue = rows.filter((r) => r.entity === 'query:blue widgets')
    expect(blue.find((r) => r.metric === 'clicks')!.value).toBe(120)
    // query clicks (120+80=200) deliberately do NOT equal totals clicks (1000).
    const totalQueryClicks = rows.filter((r) => r.metric === 'clicks').reduce((s, r) => s + r.value, 0)
    expect(totalQueryClicks).toBe(200)
  })

  it('tags page rows with entity="page:<url>"', () => {
    const rows = normalizeGscRows({
      clientId: 'c', accountId: 'sc-domain:x.com', totalsRows: [], queryRows: [], pageRows, windowEnd: '2026-06-23', lagDays: 3,
    })
    expect(rows.some((r) => r.entity === 'page:https://x.com/a' && r.metric === 'clicks' && r.value === 200)).toBe(true)
  })

  it('flags days within the lag window as provisional', () => {
    // windowEnd 2026-06-23, lag 3 => 2026-06-21,22,23 are provisional.
    const rows = normalizeGscRows({
      clientId: 'c', accountId: 'sc-domain:x.com', totalsRows, queryRows: [], pageRows: [], windowEnd: '2026-06-23', lagDays: 3,
    })
    expect(rows.find((r) => r.date === '2026-06-21')!.isProvisional).toBe(true)
    expect(rows.find((r) => r.date === '2026-06-20')!.isProvisional).toBe(false)
  })

  it('returns [] for all-empty input', () => {
    expect(
      normalizeGscRows({ clientId: 'c', accountId: 'sc-domain:x.com', totalsRows: [], queryRows: [], pageRows: [], windowEnd: '2026-06-23', lagDays: 3 }),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/connectors/gsc-normalize.test.ts`
Expected: FAIL — `normalizeGscRows` not exported.

- [ ] **Step 3: Implement `src/lib/connectors/gsc/normalize.ts`**

```ts
import 'server-only'
import type { MetricDailyRow } from '@/lib/connectors/types'
import { GSC_METRICS, type GscMetric } from './constants'

export type GscRow = {
  keys?: string[] | null
  clicks?: number | null
  impressions?: number | null
  ctr?: number | null
  position?: number | null
}

type NormalizeArgs = {
  clientId: string
  accountId: string
  totalsRows: GscRow[]   // keys=[date]
  queryRows: GscRow[]    // keys=[date, query]
  pageRows: GscRow[]     // keys=[date, page]
  windowEnd: string      // ISO 'YYYY-MM-DD'
  lagDays: number
}

function provisionalChecker(windowEnd: string, lagDays: number): (iso: string) => boolean {
  const end = new Date(`${windowEnd}T00:00:00Z`)
  const cutoff = new Date(end)
  cutoff.setUTCDate(cutoff.getUTCDate() - (lagDays - 1))
  return (iso: string) => new Date(`${iso}T00:00:00Z`) >= cutoff
}

function emit(
  out: MetricDailyRow[], clientId: string, accountId: string, entity: string, date: string,
  row: GscRow, isProvisional: boolean,
): void {
  for (const metric of GSC_METRICS as readonly GscMetric[]) {
    const v = row[metric]
    if (v === null || v === undefined) continue
    out.push({
      clientId, provider: 'gsc', accountId, entity, date,
      metric, value: Number.isFinite(v) ? Number(v) : 0, isProvisional,
    })
  }
}

export function normalizeGscRows(args: NormalizeArgs): MetricDailyRow[] {
  const { clientId, accountId, totalsRows, queryRows, pageRows, windowEnd, lagDays } = args
  const isProvisional = provisionalChecker(windowEnd, lagDays)
  const out: MetricDailyRow[] = []

  // Property-level totals (authoritative; stored separately from detail rows).
  for (const r of totalsRows) {
    const date = r.keys?.[0]
    if (!date) continue
    emit(out, clientId, accountId, 'property', date, r, isProvisional(date))
  }

  // Query detail (does NOT sum to totals due to anonymization).
  for (const r of queryRows) {
    const date = r.keys?.[0]
    const query = r.keys?.[1]
    if (!date || query === undefined) continue
    emit(out, clientId, accountId, `query:${query}`, date, r, isProvisional(date))
  }

  // Page detail.
  for (const r of pageRows) {
    const date = r.keys?.[0]
    const page = r.keys?.[1]
    if (!date || page === undefined) continue
    emit(out, clientId, accountId, `page:${page}`, date, r, isProvisional(date))
  }

  return out
}
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/connectors/gsc-normalize.test.ts`
Expected: all assertions pass — totals separate from detail; provisional flagging correct.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gsc): normalize GSC rows; store property totals separate from query/page (TDD)"
```

---

## Task 7: GSCConnector — write the failing integration test, then implement

**Files:**
- Create: `tests/connectors/gsc-connector.test.ts`
- Create: `src/lib/connectors/gsc/gsc-connector.ts`

`discover()` → `sites.list`. `fetchAndNormalize()` → three `searchanalytics.query` calls per site (totals, query, page) with `rowLimit`, `dataState='final'`, and pagination via `startRow`. `verify()` → a cheap 1-row totals query. The window the runner passes is already clamped to the 16-month rolling store by Plan 06; we additionally guard it here.

- [ ] **Step 1: Write the failing test `tests/connectors/gsc-connector.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const listSites = vi.fn()

vi.mock('@/lib/connectors/gsc/client', () => ({
  createGscClient: () => ({
    searchanalytics: { query },
    sites: { list: listSites },
  }),
}))

import { GscConnector } from '@/lib/connectors/gsc/gsc-connector'
import type { ConnectorCredential, SyncContext } from '@/lib/connectors/types'

const credential: ConnectorCredential = {
  kind: 'oauth',
  oauth: { refreshToken: 'rt', clientId: 'cid', clientSecret: 'cs' },
}
const noopLogger = { info: vi.fn(), warn: vi.fn() }

function ctx(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    connectionId: 'conn-1',
    clientId: 'org-client-1',
    accountIds: ['sc-domain:x.com'],
    credential,
    window: { start: '2026-06-18', end: '2026-06-23' },
    logger: noopLogger,
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  listSites.mockReset()
})

describe('GscConnector', () => {
  it('declares provider gsc', () => {
    expect(new GscConnector().provider).toBe('gsc')
  })

  it('discover() lists verified sites (excludes unverified)', async () => {
    listSites.mockResolvedValue({
      data: {
        siteEntry: [
          { siteUrl: 'sc-domain:x.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://y.com/', permissionLevel: 'siteUnverifiedUser' },
        ],
      },
    })
    const found = await new GscConnector().discover(credential)
    expect(found).toEqual([{ externalId: 'sc-domain:x.com', kind: 'site', displayName: 'sc-domain:x.com' }])
  })

  it('fetchAndNormalize() issues totals + query + page queries and returns canonical rows', async () => {
    // 1=totals, 2=query, 3=page (single page each => pagination stops).
    query
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20'], clicks: 1000, impressions: 50000, ctr: 0.02, position: 8.4 }] } })
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20', 'blue widgets'], clicks: 120, impressions: 4000, ctr: 0.03, position: 5.2 }] } })
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20', 'https://x.com/a'], clicks: 200, impressions: 6000, ctr: 0.033, position: 4.9 }] } })

    const rows = await new GscConnector().fetchAndNormalize(ctx())

    expect(query).toHaveBeenCalledTimes(3)
    // dataState='final' on every call.
    for (const call of query.mock.calls) {
      expect(call[0].requestBody.dataState).toBe('final')
      expect(call[0].siteUrl).toBe('sc-domain:x.com')
    }
    // totals dimensions = ['date'] only.
    expect(query.mock.calls[0][0].requestBody.dimensions).toEqual(['date'])
    expect(query.mock.calls[1][0].requestBody.dimensions).toEqual(['date', 'query'])
    expect(query.mock.calls[2][0].requestBody.dimensions).toEqual(['date', 'page'])

    expect(rows.some((r) => r.entity === 'property' && r.metric === 'clicks' && r.value === 1000)).toBe(true)
    expect(rows.some((r) => r.entity === 'query:blue widgets' && r.value === 120)).toBe(true)
    expect(rows.some((r) => r.entity === 'page:https://x.com/a' && r.value === 200)).toBe(true)
  })

  it('paginates query rows via startRow until a short page is returned', async () => {
    const fullPage = Array.from({ length: 25000 }, (_, i) => ({ keys: ['2026-06-20', `q${i}`], clicks: 1, impressions: 1, ctr: 1, position: 1 }))
    // totals: one short page. query: one full page then a short page (2 calls). page: short page.
    query
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20'], clicks: 1, impressions: 1, ctr: 1, position: 1 }] } }) // totals
      .mockResolvedValueOnce({ data: { rows: fullPage } })   // query page 1 (full => paginate)
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20', 'last'], clicks: 1, impressions: 1, ctr: 1, position: 1 }] } }) // query page 2 (short => stop)
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-20', 'https://x.com/a'], clicks: 1, impressions: 1, ctr: 1, position: 1 }] } }) // page

    await new GscConnector().fetchAndNormalize(ctx())
    // totals(1) + query(2 pages) + page(1) = 4 calls.
    expect(query).toHaveBeenCalledTimes(4)
    // page-2 query used startRow = 25000.
    expect(query.mock.calls[2][0].requestBody.startRow).toBe(25000)
  })

  it('verify() returns ok when a totals query resolves', async () => {
    query.mockResolvedValue({ data: { rows: [{ keys: ['2026-06-20'], clicks: 1, impressions: 1, ctr: 1, position: 1 }] } })
    const res = await new GscConnector().verify({ accountIds: ['sc-domain:x.com'], credential })
    expect(res.ok).toBe(true)
  })

  it('verify() returns not-ok with detail when query throws', async () => {
    query.mockRejectedValue(new Error('insufficientPermissions'))
    const res = await new GscConnector().verify({ accountIds: ['sc-domain:x.com'], credential })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('insufficientPermissions')
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/connectors/gsc-connector.test.ts`
Expected: FAIL — `GscConnector` not exported.

- [ ] **Step 3: Implement `src/lib/connectors/gsc/gsc-connector.ts`**

```ts
import 'server-only'
import type {
  Connector, ConnectorCredential, DiscoveredAccount, MetricDailyRow, SyncContext, VerifyResult,
} from '@/lib/connectors/types'
import { createGscClient } from './client'
import { normalizeGscRows, type GscRow } from './normalize'
import {
  GSC_DATA_STATE, GSC_LAG_DAYS, GSC_PAGE_DIMENSIONS, GSC_QUERY_DIMENSIONS, GSC_ROW_LIMIT,
} from './constants'

type GscClientLike = {
  searchanalytics: { query: (params: unknown) => Promise<{ data?: { rows?: GscRow[] | null } }> }
  sites: { list: () => Promise<{ data?: { siteEntry?: Array<{ siteUrl?: string | null; permissionLevel?: string | null }> | null } }> }
}

// One dimension set, fully paginated.
async function queryAllRows(
  client: GscClientLike, siteUrl: string, start: string, end: string, dimensions: readonly string[],
): Promise<GscRow[]> {
  const rows: GscRow[] = []
  let startRow = 0
  for (;;) {
    const res = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: start, endDate: end,
        dimensions: [...dimensions],
        rowLimit: GSC_ROW_LIMIT,
        startRow,
        dataState: GSC_DATA_STATE,
      },
    })
    const page = res.data?.rows ?? []
    rows.push(...page)
    if (page.length < GSC_ROW_LIMIT) break
    startRow += GSC_ROW_LIMIT
  }
  return rows
}

export class GscConnector implements Connector {
  readonly provider = 'gsc' as const

  async discover(credential: ConnectorCredential): Promise<DiscoveredAccount[]> {
    const client = createGscClient(credential) as unknown as GscClientLike
    const res = await client.sites.list()
    const sites = res.data?.siteEntry ?? []
    return sites
      .filter((s) => !!s.siteUrl && s.permissionLevel !== 'siteUnverifiedUser')
      .map((s) => ({ externalId: s.siteUrl!, kind: 'site', displayName: s.siteUrl! }))
  }

  async fetchAndNormalize(ctx: SyncContext): Promise<MetricDailyRow[]> {
    const client = createGscClient(ctx.credential) as unknown as GscClientLike
    const { start, end } = ctx.window
    const all: MetricDailyRow[] = []

    for (const siteUrl of ctx.accountIds) {
      const totalsRows = await queryAllRows(client, siteUrl, start, end, ['date'])
      const queryRows = await queryAllRows(client, siteUrl, start, end, GSC_QUERY_DIMENSIONS)
      const pageRows = await queryAllRows(client, siteUrl, start, end, GSC_PAGE_DIMENSIONS)

      all.push(
        ...normalizeGscRows({
          clientId: ctx.clientId, accountId: siteUrl, totalsRows, queryRows, pageRows,
          windowEnd: end, lagDays: GSC_LAG_DAYS,
        }),
      )
    }
    return all
  }

  async verify(ctx: Pick<SyncContext, 'accountIds' | 'credential'>): Promise<VerifyResult> {
    const siteUrl = ctx.accountIds[0]
    if (!siteUrl) return { ok: false, detail: 'no site mapped to this connection' }
    try {
      const client = createGscClient(ctx.credential) as unknown as GscClientLike
      await client.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: '30daysAgo', endDate: 'today', dimensions: ['date'], rowLimit: 1, dataState: GSC_DATA_STATE },
      })
      return { ok: true, detail: `verified ${siteUrl}` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
}
```

> **Note on `verify()` date literals:** the Search Console API does not accept GA4-style relative date tokens; production code must pass concrete ISO dates. The literals above are placeholders ONLY inside the mocked test (the mock ignores them). Replace with computed ISO dates in Step 3b.

- [ ] **Step 3b: Use concrete ISO dates in `verify()`**

Replace the `requestBody` of the `verify()` query with computed dates so it works against the real API:

```ts
const today = new Date()
const end = today.toISOString().slice(0, 10)
const startD = new Date(today)
startD.setUTCDate(startD.getUTCDate() - 30)
const start = startD.toISOString().slice(0, 10)
await client.searchanalytics.query({
  siteUrl,
  requestBody: { startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1, dataState: GSC_DATA_STATE },
})
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/connectors/gsc-connector.test.ts`
Expected: all assertions pass — 3 dimension sets queried, pagination via `startRow`, `dataState='final'` enforced.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gsc): GSCConnector (discover/fetchAndNormalize/verify) with pagination (TDD)"
```

---

## Task 8: Register GA4 + GSC into the Plan 06 connector registry

**Files:**
- Create: `src/lib/connectors/register-google.ts`
- Modify: the Plan 06 connector bootstrap (`src/lib/connectors/registry.ts` import side — see Step 2)

- [ ] **Step 1: Write `src/lib/connectors/register-google.ts`**

```ts
import 'server-only'
import { registerConnector } from '@/lib/connectors/registry'
import { Ga4Connector } from './ga4/ga4-connector'
import { GscConnector } from './gsc/gsc-connector'

// Idempotent: registering the same provider twice is a no-op in Plan 06's registry.
export function registerGoogleConnectors(): void {
  registerConnector(new Ga4Connector())
  registerConnector(new GscConnector())
}
```

- [ ] **Step 2: Invoke registration where Plan 06 bootstraps connectors**

Plan 06 has a single bootstrap module that the Inngest sync entrypoint (`src/inngest/sync.ts`) imports before it calls `getConnector(...)`. Add the call there. If Plan 06's bootstrap is `src/lib/connectors/register.ts`, add:

```ts
import { registerGoogleConnectors } from './register-google'
// ...existing registrations (Plan 06 / later plans)...
registerGoogleConnectors()
```

If Plan 06 instead auto-registers via the registry module's top-level side effects, import `register-google` from that module the same way the other connectors are imported. The contract: `getConnector('ga4')` and `getConnector('gsc')` must resolve after bootstrap.

- [ ] **Step 3: Write a registry smoke test `tests/connectors/registry-google.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { registerGoogleConnectors } from '@/lib/connectors/register-google'
import { getConnector } from '@/lib/connectors/registry'

describe('google connector registration', () => {
  it('registers ga4 and gsc connectors', () => {
    registerGoogleConnectors()
    expect(getConnector('ga4').provider).toBe('ga4')
    expect(getConnector('gsc').provider).toBe('gsc')
  })
})
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/connectors/registry-google.test.ts`
Expected: PASS — both providers resolve from the registry.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): register GA4 + GSC into the Plan 06 registry"
```

---

## Task 9: End-to-end landing test — normalized rows hit `metric_daily` (+ RLS isolation)

**Files:**
- Create: `tests/connectors/metric-daily-landing.test.ts`
- Create: `tests/rls/metric-daily-isolation.test.ts`

This is the keystone for this plan: prove that connector output, fed through the Plan 06 `upsertMetricDaily()`, lands in `metric_daily` with the right `provider` tags, is **idempotent** on re-sync, and respects the existing RLS policy. We mock the Google clients (no network) and use the real local DB + seed.

> **Prerequisite:** `pnpm db:migrate && pnpm db:seed` (Plan 01 + Plan 06 migrations applied; seed users/orgs present). We use `userIdByEmail('user1@clientone.com')` and the `client-one` org id from the seed.

- [ ] **Step 1: Write `tests/connectors/metric-daily-landing.test.ts`**

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from '../helpers/db'

// Mock both Google client factories.
const runReport = vi.fn()
vi.mock('@/lib/connectors/ga4/client', () => ({
  createGa4Clients: () => ({ data: { runReport }, admin: { accountSummaries: { list: vi.fn() } } }),
}))
const gscQuery = vi.fn()
vi.mock('@/lib/connectors/gsc/client', () => ({
  createGscClient: () => ({ searchanalytics: { query: gscQuery }, sites: { list: vi.fn() } }),
}))

import { Ga4Connector } from '@/lib/connectors/ga4/ga4-connector'
import { GscConnector } from '@/lib/connectors/gsc/gsc-connector'
import { upsertMetricDaily } from '@/lib/connectors/run-sync'
import type { SyncContext } from '@/lib/connectors/types'

const logger = { info: vi.fn(), warn: vi.fn() }
let clientOrgId: string

beforeAll(async () => {
  const rows = await sql`select id from public.organizations where slug = 'client-one'`
  clientOrgId = rows[0]!.id as string
})

afterAll(async () => {
  // Clean only the rows this test created.
  await sql`delete from public.metric_daily where client_id = ${clientOrgId} and account_id in ('properties/777','sc-domain:landing-test.com')`
  await sql.end()
})

beforeEach(() => {
  runReport.mockReset()
  gscQuery.mockReset()
})

function ga4Ctx(): SyncContext {
  return {
    connectionId: 'c', clientId: clientOrgId, accountIds: ['properties/777'],
    credential: { kind: 'service_account', serviceAccount: { client_email: 'x', private_key: 'y' } },
    window: { start: '2026-06-27', end: '2026-06-27' }, logger,
  }
}
function gscCtx(): SyncContext {
  return {
    connectionId: 'c', clientId: clientOrgId, accountIds: ['sc-domain:landing-test.com'],
    credential: { kind: 'oauth', oauth: { refreshToken: 'r', clientId: 'i', clientSecret: 's' } },
    window: { start: '2026-06-27', end: '2026-06-27' }, logger,
  }
}

describe('connector output lands in metric_daily', () => {
  it('GA4 rows upsert with provider=ga4 and survive re-sync (idempotent)', async () => {
    runReport
      .mockResolvedValue([
        { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'sessions' }, { name: 'keyEvents' }],
          rows: [{ dimensionValues: [{ value: '20260627' }], metricValues: [{ value: '1500' }, { value: '52' }] }] },
      ])

    const rows = await new Ga4Connector().fetchAndNormalize(ga4Ctx())
    await upsertMetricDaily(rows)
    const inserted1 = await upsertMetricDaily(rows) // second time: no duplicates

    const stored = await sql`
      select metric, value from public.metric_daily
      where client_id = ${clientOrgId} and provider = 'ga4'
        and account_id = 'properties/777' and date = '2026-06-27' and entity = 'property'
      order by metric`
    const m = Object.fromEntries(stored.map((r) => [r.metric, Number(r.value)]))
    expect(m.sessions).toBe(1500)
    expect(m.keyEvents).toBe(52)

    // Idempotency: re-running did not create extra rows for this key.
    const count = await sql`
      select count(*)::int as n from public.metric_daily
      where client_id = ${clientOrgId} and provider = 'ga4' and account_id = 'properties/777'
        and date = '2026-06-27' and entity = 'property' and metric = 'sessions'`
    expect(count[0]!.n).toBe(1)
    expect(inserted1).toBeGreaterThanOrEqual(0)
  })

  it('GSC totals land with provider=gsc and entity=property, kept separate from query rows', async () => {
    gscQuery
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-27'], clicks: 1000, impressions: 50000, ctr: 0.02, position: 8.4 }] } }) // totals
      .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-06-27', 'widgets'], clicks: 120, impressions: 4000, ctr: 0.03, position: 5.2 }] } }) // query
      .mockResolvedValueOnce({ data: { rows: [] } }) // page

    const rows = await new GscConnector().fetchAndNormalize(gscCtx())
    await upsertMetricDaily(rows)

    const totals = await sql`
      select value from public.metric_daily
      where client_id = ${clientOrgId} and provider = 'gsc'
        and account_id = 'sc-domain:landing-test.com' and entity = 'property'
        and metric = 'clicks' and date = '2026-06-27'`
    expect(Number(totals[0]!.value)).toBe(1000)

    const queryRow = await sql`
      select value from public.metric_daily
      where client_id = ${clientOrgId} and provider = 'gsc'
        and account_id = 'sc-domain:landing-test.com' and entity = 'query:widgets'
        and metric = 'clicks' and date = '2026-06-27'`
    expect(Number(queryRow[0]!.value)).toBe(120)
    // Property total (1000) != sum of stored query clicks (120) — anonymization preserved.
    expect(Number(totals[0]!.value)).not.toBe(Number(queryRow[0]!.value))
  })
})
```

- [ ] **Step 2: Run it and confirm it PASSES**

Run: `pnpm db:migrate && pnpm db:seed && pnpm test tests/connectors/metric-daily-landing.test.ts`
Expected: PASS — GA4 + GSC rows persist with correct provider tags; re-sync is idempotent; GSC totals stay separate from query rows.

- [ ] **Step 3: Write the RLS isolation test `tests/rls/metric-daily-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'
import { upsertMetricDaily } from '@/lib/connectors/run-sync'
import type { MetricDailyRow } from '@/lib/connectors/types'

describe('metric_daily tenant isolation (RLS) — GA4/GSC rows', () => {
  let clientOneOrg: string
  let clientTwoOrg: string
  let clientOneUser: string

  beforeAll(async () => {
    clientOneOrg = (await sql`select id from public.organizations where slug = 'client-one'`)[0]!.id as string
    clientTwoOrg = (await sql`select id from public.organizations where slug = 'client-two'`)[0]!.id as string
    clientOneUser = await userIdByEmail('user1@clientone.com')

    // Seed one ga4 row for each client org via the service-role upsert.
    const mk = (org: string, acct: string): MetricDailyRow => ({
      clientId: org, provider: 'ga4', accountId: acct, entity: 'property',
      date: '2026-06-27', metric: 'sessions', value: 999, isProvisional: false,
    })
    await upsertMetricDaily([mk(clientOneOrg, 'properties/rls1'), mk(clientTwoOrg, 'properties/rls2')])
  })

  afterAll(async () => {
    await sql`delete from public.metric_daily where account_id in ('properties/rls1','properties/rls2')`
    await sql.end()
  })

  it('a client user sees ONLY their own org\'s metric_daily rows', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select account_id from public.metric_daily where metric = 'sessions' and account_id in ('properties/rls1','properties/rls2')`)
    const accts = rows.map((r) => r.account_id)
    expect(accts).toContain('properties/rls1')
    expect(accts).not.toContain('properties/rls2') // client-two's row must be invisible
  })
})
```

- [ ] **Step 4: Run the RLS test and confirm it PASSES**

Run: `pnpm test tests/rls/metric-daily-isolation.test.ts`
Expected: PASS — client-one user sees only `properties/rls1`; client-two's GA4 row is filtered by the Plan 06 RLS policy. (If this fails, the bug is a missing/incorrect `metric_daily` policy in Plan 06 — fix there, not here.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(connectors): metric_daily landing + idempotency + RLS isolation for GA4/GSC rows"
```

---

## Task 10: Per-provider connect-flow docs (onboarding + connection-health)

**Files:**
- Create: `docs/connect-flows/ga4.md`, `docs/connect-flows/gsc.md`

These are the operator-facing instructions the Plan 05 onboarding wizard and connection-health dashboard render verbatim. They encode the exact grant mechanism + the "verify connection" call (PRD §5.5 acceptance: "documented, testable connect flow with a verify call").

- [ ] **Step 1: Write `docs/connect-flows/ga4.md`**

```markdown
# Connect flow — Google Analytics 4 (GA4)

**Provider tag:** `ga4` · **Connector:** `Ga4Connector` · **Scope:** `analytics.readonly`

## Primary path — add our service account to the client's GA4 account (preferred)
This auto-covers all current AND future properties under the account and avoids OAuth
verification delays (PRD §6.3).

1. We give the client our service-account email (from the Token Vault, e.g.
   `agency-ga4@<project>.iam.gserviceaccount.com`).
2. Client opens **GA4 Admin → Account Access Management** (account level, not property).
3. Client clicks **+ → Add users**, pastes the email, sets role **Viewer** (or **Analyst**),
   and saves.
4. In Agency OS onboarding, click **Discover properties** → calls
   `Ga4Connector.discover(credential)` (`accountSummaries.list`) and lists every property.
5. Map the correct property to this client → writes `connection_account_map`
   (`kind='property'`, `external_account_id='properties/<id>'`).
6. Click **Verify** → `Ga4Connector.verify()` runs a 1-row `runReport`. Green = connected.

## Fallback path — OAuth offline (refresh token)
Use only when the client cannot grant account-level access (e.g. agency-managed property
they don't own).

1. Operator runs the OAuth consent flow (scope `analytics.readonly`, `access_type=offline`,
   `prompt=consent`) and we store the **refresh token** in the Token Vault as an
   `oauth` credential.
2. Same Discover → Map → Verify steps as above.
> Public multi-account OAuth requires sensitive-scope verification (~weeks); prefer the
> service-account path for new clients.

## Sync behaviour
- Nightly per property; **re-pull trailing 3 days** (24–48h processing lag) → those days
  stored `is_provisional = true`.
- `returnPropertyQuota=true`; concurrency ≤ 10 per property; staggered to respect the
  per-project-per-property hourly token cap.

## Gotchas (surface as footnotes in the UI — PRD §6.5)
- **Sampling** on large queries — check `samplingMetadatas`.
- **`(other)`** high-cardinality bucket in channel/source dimensions.
- **Data thresholding** when Google Signals is on (rows withheld for small cohorts).
- **Consent-mode modeling** can inflate/smooth recent days.
- Never query GA4 on page load — the dashboard reads `metric_daily` only.

## Troubleshooting
- `PERMISSION_DENIED` on verify → access not granted at the right level, or wrong property
  mapped. Re-check Step 3 (account-level, not property-level if you want auto-coverage).
- Empty rows for recent days → expected (processing lag); they fill in on the trailing
  3-day re-sync.
```

- [ ] **Step 2: Write `docs/connect-flows/gsc.md`**

```markdown
# Connect flow — Google Search Console (GSC)

**Provider tag:** `gsc` · **Connector:** `GscConnector` · **Scope:** `webmasters.readonly`

> There is **no API to self-add** a user to a Search Console property — onboarding ALWAYS
> includes a manual per-property grant by the client (PRD §6.3).

## Grant path (per property)
1. We give the client the account/email that holds our `webmasters.readonly` credential
   (OAuth user, or the service-account email if using the service-account variant).
2. Client opens **Search Console → Settings → Users and permissions** for the property.
3. Client clicks **Add user**, pastes the email, sets permission **Full** (recommended for
   reporting).
   - If using a **service account as owner**, add it as a **user FIRST, then owner** —
     adding straight as owner triggers a known access bug.
4. In Agency OS onboarding, click **Discover sites** → `GscConnector.discover(credential)`
   (`sites.list`) lists verified sites only (unverified are filtered out).
5. Map the correct site to this client → `connection_account_map` (`kind='site'`,
   `external_account_id='sc-domain:<domain>'` or the URL-prefix property string).
6. Click **Verify** → `GscConnector.verify()` runs a 1-row totals query. Green = connected.

## Sync behaviour
- Nightly; paginate `rowLimit=25000` via `startRow`; query **day-by-day inside the runner
  window** to beat the ~50k-rows/type/day sampling cap.
- **`dataState='final'`** for reporting.
- **Store a 16-month rolling window** — Google deletes data older than 16 months, so we own
  the history.
- **~2–3 day lag**: the most recent 3 days are stored `is_provisional = true`.

## Critical correctness rule — totals vs query rows (PRD §6.3)
- **~47% of clicks have NO query** (anonymization), so query rows **never sum to totals**.
- We store **property-level totals separately** (`entity='property'`) from query rows
  (`entity='query:<q>'`) and page rows (`entity='page:<url>'`).
- **Any filter/dimension drops anonymized clicks** — always read totals from the
  `entity='property'` rows, never by summing query rows. Footnote this in the UI.

## Troubleshooting
- `insufficientPermissions` on verify → the grant in Step 3 is missing or at too low a level.
- Query-row clicks far below the headline total → expected (anonymization), not a bug.
- Data missing beyond ~16 months → expected (Google deletion); our store is the source of
  truth for older history.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(connect-flows): GA4 + GSC connect/verify instructions (onboarding + health)"
```

---

## Task 11: Full suite + type-check gate

**Files:**
- None (verification task)

- [ ] **Step 1: Type-check the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Run the full test suite (mirrors CI)**

Run: `pnpm db:migrate && pnpm db:seed && pnpm test`
Expected: all suites green, including:
- `tests/connectors/ga4-normalize.test.ts`
- `tests/connectors/ga4-connector.test.ts`
- `tests/connectors/gsc-normalize.test.ts`
- `tests/connectors/gsc-connector.test.ts`
- `tests/connectors/registry-google.test.ts`
- `tests/connectors/metric-daily-landing.test.ts`
- `tests/rls/metric-daily-isolation.test.ts`
- (plus all Plan 01 / Plan 06 suites — unchanged)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(connectors): GA4 + GSC connectors complete (Plan 07) — suite green"
```

---

## Self-Review

**Spec coverage (vs PRD §6.3 GA4, §6.3 GSC, §6.5 data-trust, §5.5/§5.6, §8 schema):**
- **GA4 auth** — service-account-added-to-account (primary) + OAuth-offline fallback → `ga4/client.ts` `authFromCredential`, both `ConnectorCredential` kinds; documented in `docs/connect-flows/ga4.md`. ✅
- **GA4 discovery** — `accountSummaries.list` → `Ga4Connector.discover()` (Task 4) + test. ✅
- **GA4 metrics** — sessions/users/newUsers/engagementRate/keyEvents + channel mix (`sessionDefaultChannelGroup`) → `GA4_METRICS`, `normalize.ts`, tests. ✅
- **GA4 sync tuning** — trailing-3-day re-sync (provisional flag), `returnPropertyQuota=true`, concurrency note → `constants.ts`, connector request, normalize provisional logic; quota logged. ✅
- **GSC auth/scope** — `webmasters.readonly`; per-property manual grant (no self-add API) → `gsc/client.ts`, `docs/connect-flows/gsc.md`. ✅
- **GSC metrics** — clicks/impressions/ctr/position by query + page → `GSC_METRICS`, `normalize.ts`, tests. ✅
- **GSC 16-month rolling store** — `GSC_ROLLING_MONTHS` constant + documented; runner-clamped window honored. ✅ (window clamping is owned by the Plan 06 runner; connector guards via the window it receives.)
- **GSC lag handling** — `GSC_LAG_DAYS=3`, provisional flag on recent days → `normalize.ts` + test. ✅
- **GSC anonymization / totals-separate-from-query** — `entity='property'` totals vs `entity='query:'`/`'page:'`; explicit non-equality asserted in unit + landing tests; documented. ✅
- **Mock Google clients in tests; assert rows land in `metric_daily` with provider tags** — `vi.mock` on both client factories; `metric-daily-landing.test.ts` asserts `provider='ga4'`/`'gsc'` rows persist + idempotent. ✅
- **Data-trust (§6.5)** — provisional flagging implemented; caveats documented as UI footnotes in connect-flow docs; raw-response audit is the Plan 06 runner's responsibility (this connector returns normalized rows; raw audit happens at the runner per Plan 06). ✅
- **Plan 06 interface compliance** — both connectors `implements Connector`; use `SyncContext`/`ConnectorCredential`/`MetricDailyRow`/`VerifyResult`; registered via `registerConnector`; persistence via `upsertMetricDaily`. ✅
- **RLS isolation for tenant-scoped data** — `metric_daily` is tenant-scoped; additive isolation test added (Task 9) reusing Plan 01 harness `asUser()`. The table + policy itself is owned by Plan 06; this plan does not redefine it (noted in File Structure). ✅

**Placeholder scan:** No `TBD`/`add X here`. The only "placeholder" word appears in Task 7 Step 3b, which is an explicit, resolved instruction (replace relative date literals with computed ISO dates — code provided). The Task 8 Step 2 registration wording adapts to wherever Plan 06 bootstraps, with an explicit contract ("`getConnector('ga4'|'gsc')` resolves after bootstrap"); both branches are spelled out. ✅

**Type consistency:**
- `Provider` literals `'ga4'`/`'gsc'` consistent across constants, connectors, normalizers, registry test, landing test, and the Plan 06 `Provider` union.
- `MetricDailyRow` field names (`clientId`,`provider`,`accountId`,`entity`,`date`,`metric`,`value`,`isProvisional`) used identically in both normalizers and asserted in tests; SQL column reads (`client_id`,`account_id`,`is_provisional`) match the Plan 06 `metric_daily` schema (§8).
- `ConnectorCredential` discriminated union (`service_account` | `oauth`) handled in both `client.ts` factories.
- `Connector` method signatures (`discover`/`fetchAndNormalize`/`verify`) match the Plan 06 interface exactly.
- `entity` conventions consistent: `'property'`, `'channel:<group>'` (GA4), `'query:<q>'`, `'page:<url>'` (GSC).

**Definition of done for Plan 07:** `pnpm exec tsc --noEmit && pnpm lint && pnpm test` green — GA4 + GSC normalize/connector/registry unit+integration tests pass, mocked-client output lands in `metric_daily` with correct provider tags and is idempotent on re-sync, the additive `metric_daily` RLS isolation test passes, and both connect-flow docs render the grant + verify steps.
