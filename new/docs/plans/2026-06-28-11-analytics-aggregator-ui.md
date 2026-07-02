# Agency OS — Plan 11: Analytics Aggregator UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Analytics UI** for Agency OS (PRD §5.6) that reads **only from the metrics store** (`metric_daily` / `metric_monthly_rollup` / `gbp_review`, Plans 06–09) — **never** live external APIs. It delivers (a) an **internal cross-client overview**: a sortable table of headline KPIs per client for a selected period with MoM deltas and inline sparklines; and (b) a **per-client channel dashboard** (Website/Search/Google Ads/Meta/Local/Leads) rendered with **Recharts**, reused verbatim in the **client portal** under RLS-scoped access. Every view shows an **"as of" timestamp** + freshness badge, flags the **most recent ~3 days as provisional**, footnotes **data-quality caveats** (sampling, consent-mode, attribution, query anonymization), offers a **date-range selector**, **CSV + PDF export**, and **"verify in platform" deep links**. The keystone tests prove the **client portal view is strictly own-org** (RLS) and that **every rendered KPI traces to a stored dated row** in `metric_daily`.

**Architecture:** This is a **read-only presentation layer over Plane A** (PRD §6.1): the dashboard issues no external API calls on page render (PRD §11) — it reads the normalized store landed by the Plan 06 sync scheduler and the Plan 07–09 connectors. A pure **aggregation library** (`src/lib/analytics/*`) turns `metric_daily` rows into channel KPI view-models, MoM deltas, daily series for sparklines/charts, and freshness/provisional metadata; it is provider-agnostic via a **channel registry** that maps PRD §5.6 channels → `(provider, metric)` tuples (decoupling the UI from connector internals and from the `meta`/`meta_ads` provider-tag drift between Plan 06 and Plan 08). Two read paths reuse the same library: **staff** reads use the service-role Drizzle `db` client and pass an explicit `organizationId` (cross-client, app-scoped per view, defense-in-depth); **portal** reads pass `session.orgId` AND rely on Postgres RLS (`metric_daily`/`metric_monthly_rollup`/`gbp_review` already enable RLS with `public.has_org_access(uuid)` policies from Plans 06/09) so a client can only ever read their own org. "As of" comes from `connection.lastSuccessAt` (per provider) and `metric_daily.syncedAt`; provisional comes from the stored `is_provisional` flag. Export (CSV server action; PDF via `@react-pdf/renderer`, the PRD §10 / §7 choice) renders the same view-models. No new tenant-scoped *metric* tables are introduced (we read existing ones); the one new tenant-scoped table is `analytics_export_log` (audit of who exported what), which gets its own RLS isolation test per shared conventions.

**Tech Stack:** Next.js 16 (App Router, TS strict) · Drizzle ORM + postgres.js (read the existing `metric_daily`/`metric_monthly_rollup`/`gbp_review` tables) · Supabase Postgres + RLS (Plan 01 helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`) · Tailwind + shadcn/ui (`card`, `table`, `button`, `select`, `tabs`, `badge`, `chart`) · **Recharts** (already present from Plans 02/04) · **@react-pdf/renderer** (PDF export) · Vitest (unit aggregation tests + RLS isolation + "KPI traces to stored row" integration test) using the Plan 01 harness `tests/helpers/db.ts` `asUser()`.

**Dependencies (assume built; do NOT re-spec):** Plan 06 (integration framework: `connection`, `connection_account_map`, `metric_daily`, `metric_monthly_rollup`, `raw_event`, RLS + Vault), Plan 07 (GA4 `provider='ga4'` + GSC `provider='gsc'`), Plan 08 (Google Ads `provider='google_ads'` + Meta `provider='meta'`), Plan 09 (GBP `provider='gbp'` + `gbp_review`), Plan 10 (Unified Leads: canonical `lead` table per PRD §8). Plan 01 tenancy/RLS/harness; Plan 02 `client` table (per-client `name`, `organizationId`); Plan 05 portal shell (`(portal)/layout.tsx`, role guards) + audit helper `recordAuditEvent()`.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                                   # MODIFY: + analytics_export_log table
│  │  └─ types.ts                                    # MODIFY: + AnalyticsExportLog types
│  ├─ lib/
│  │  └─ analytics/
│  │     ├─ channels.ts                              # channel registry: channel -> (provider, metric[]) + verify-links + caveats
│  │     ├─ dateRange.ts                             # period parsing, MoM previous-period, provisional cutoff
│  │     ├─ aggregate.ts                             # metric_daily rows -> KPI view-models, deltas, daily series
│  │     ├─ freshness.ts                             # "as of" + freshness badge state from connection.lastSuccessAt
│  │     ├─ queries.ts                               # server-only reads (staff: db; portal: org-scoped + RLS)
│  │     ├─ csv.ts                                   # view-model -> CSV string
│  │     └─ types.ts                                 # ChannelKpi, KpiView, DailyPoint, OverviewRow, Freshness
│  ├─ components/
│  │  └─ analytics/
│  │     ├─ DateRangeSelector.tsx                    # client component; updates ?from&to
│  │     ├─ AsOfBadge.tsx                            # "as of" + provisional/stale freshness badge
│  │     ├─ KpiCard.tsx                              # single KPI value + MoM delta
│  │     ├─ Sparkline.tsx                            # Recharts mini line (table cell)
│  │     ├─ ChannelChart.tsx                         # Recharts area/bar per channel
│  │     ├─ CaveatFootnotes.tsx                      # data-quality footnotes per channel
│  │     ├─ VerifyInPlatformLink.tsx                 # "verify in platform" deep link
│  │     ├─ OverviewTable.tsx                        # sortable cross-client table (client component)
│  │     ├─ ChannelDashboard.tsx                     # composes per-client channel views (shared internal+portal)
│  │     └─ ExportButtons.tsx                        # CSV + PDF export triggers
│  ├─ app/
│  │  ├─ (internal)/analytics/page.tsx               # cross-client overview (staff)
│  │  ├─ (internal)/analytics/[clientId]/page.tsx    # per-client drilldown (staff)
│  │  ├─ (internal)/analytics/actions.ts             # staff CSV export server action
│  │  ├─ (internal)/analytics/export/pdf/route.ts    # staff PDF route handler
│  │  ├─ (portal)/performance/page.tsx               # per-client dashboard (client, RLS-scoped)
│  │  ├─ (portal)/performance/actions.ts             # portal CSV export server action
│  │  └─ (portal)/performance/export/pdf/route.ts    # portal PDF route handler
│  └─ lib/pdf/AnalyticsReport.tsx                    # @react-pdf/renderer document for analytics export
└─ tests/
   ├─ analytics/dateRange.test.ts                    # period + MoM + provisional cutoff
   ├─ analytics/aggregate.test.ts                    # rows -> KPI view-models, deltas, series
   ├─ analytics/channels.test.ts                     # channel registry mapping + verify links
   ├─ analytics/traces-to-store.test.ts              # KEYSTONE: every KPI traces to a stored metric_daily row
   └─ rls/analytics-export-log.test.ts               # KEYSTONE: tenant isolation for analytics_export_log
```

---

## Task 1: Channel registry + analytics types (decouple UI from connector internals)

**Files:**
- Create: `src/lib/analytics/types.ts`
- Create: `src/lib/analytics/channels.ts`
- Create: `tests/analytics/channels.test.ts`

The PRD §5.6 channels (Website/Search/Google Ads/Meta/Local/Leads) map onto stored `(provider, metric, entity)` tuples produced by Plans 07–09. We centralize that mapping so the UI never hard-codes provider strings, and so the **`meta` vs `meta_ads`** provider-tag drift (Plan 06 enum `meta_ads` vs Plan 08 connector writing `provider='meta'`) is resolved in exactly one place.

- [ ] **Step 1: Write `src/lib/analytics/types.ts`**

```ts
import 'server-only'

/** PRD §5.6 channel groups. */
export type ChannelKey = 'website' | 'search' | 'google_ads' | 'meta' | 'local' | 'leads'

/** A single KPI definition resolved from the channel registry. */
export type KpiDef = {
  /** stable key used in URLs/CSV headers */
  key: string
  /** human label shown in the UI */
  label: string
  /** metric_daily.provider tag(s) this KPI reads from */
  providers: string[]
  /** metric_daily.metric name(s) summed for this KPI */
  metrics: string[]
  /** how to aggregate the daily values across the period */
  agg: 'sum' | 'avg' | 'latest'
  /** display format */
  format: 'integer' | 'decimal' | 'percent' | 'currency'
  /** derived KPIs are computed from other KPIs, not summed from rows */
  derivedFrom?: { numerator: string; denominator: string; kind: 'ratio' | 'cost_per' }
}

/** One channel = a provider grouping + its KPI defs + UI metadata. */
export type ChannelDef = {
  key: ChannelKey
  label: string
  /** providers whose metric_daily rows belong to this channel */
  providers: string[]
  kpis: KpiDef[]
  /** data-quality footnotes (PRD §6.5) */
  caveats: string[]
  /** "verify in platform" base URL builder */
  verifyUrl: (ctx: { accountId?: string | null }) => string
}

/** A resolved KPI value for a period. */
export type ChannelKpi = {
  key: string
  label: string
  format: KpiDef['format']
  value: number
  /** previous-period value for MoM delta (null if no prior data) */
  previous: number | null
  /** signed fractional change (e.g. 0.12 = +12%); null if previous is null/0 */
  deltaPct: number | null
  /** true if any contributing row in the current period is provisional */
  hasProvisional: boolean
}

/** A point in a daily time series (for sparklines + charts). */
export type DailyPoint = { date: string; value: number; isProvisional: boolean }

/** A channel's full view-model. */
export type ChannelView = {
  key: ChannelKey
  label: string
  kpis: ChannelKpi[]
  /** primary metric daily series for the channel chart */
  series: DailyPoint[]
  /** the metric the series represents (e.g. 'sessions', 'spend') */
  seriesMetric: string
  caveats: string[]
  verifyUrl: string
  /** true if this channel has no stored rows for the org/period */
  empty: boolean
}

/** One row of the cross-client overview table. */
export type OverviewRow = {
  organizationId: string
  clientId: string
  clientName: string
  /** headline KPIs keyed by KpiDef.key */
  kpis: Record<string, ChannelKpi>
  /** sparkline series for the headline traffic metric */
  spark: DailyPoint[]
}

/** Freshness metadata for a view. */
export type Freshness = {
  /** newest connection.lastSuccessAt across the channels shown (ISO) or null */
  asOf: string | null
  /** true if asOf is older than the 24h SLA (PRD §11) */
  stale: boolean
  /** number of trailing days flagged provisional in the current period */
  provisionalDays: number
}

/** A raw metric_daily row as read for aggregation. */
export type MetricRow = {
  organizationId: string
  provider: string
  accountId: string
  entity: string
  date: string // ISO yyyy-mm-dd
  metric: string
  value: number
  isProvisional: boolean
}
```

- [ ] **Step 2: Write `src/lib/analytics/channels.ts`**

```ts
import 'server-only'
import type { ChannelDef, ChannelKey, KpiDef } from './types'

/**
 * Resolve the provider-tag drift in one place: Plan 06's enum value is
 * 'meta_ads' but the Plan 08 Meta connector writes metric_daily.provider='meta'.
 * We accept BOTH wherever Meta is read so the UI is robust to either landing tag.
 */
export const META_PROVIDERS = ['meta', 'meta_ads'] as const

const websiteKpis: KpiDef[] = [
  { key: 'sessions', label: 'Sessions', providers: ['ga4'], metrics: ['sessions'], agg: 'sum', format: 'integer' },
  { key: 'users', label: 'Users', providers: ['ga4'], metrics: ['users'], agg: 'sum', format: 'integer' },
  { key: 'newUsers', label: 'New users', providers: ['ga4'], metrics: ['newUsers'], agg: 'sum', format: 'integer' },
  { key: 'engagementRate', label: 'Engagement rate', providers: ['ga4'], metrics: ['engagementRate'], agg: 'avg', format: 'percent' },
  { key: 'keyEvents', label: 'Key events', providers: ['ga4'], metrics: ['keyEvents'], agg: 'sum', format: 'integer' },
]

const searchKpis: KpiDef[] = [
  { key: 'clicks', label: 'Clicks', providers: ['gsc'], metrics: ['clicks'], agg: 'sum', format: 'integer' },
  { key: 'impressions', label: 'Impressions', providers: ['gsc'], metrics: ['impressions'], agg: 'sum', format: 'integer' },
  { key: 'ctr', label: 'CTR', providers: ['gsc'], metrics: ['ctr'], agg: 'avg', format: 'percent' },
  { key: 'position', label: 'Avg position', providers: ['gsc'], metrics: ['position'], agg: 'avg', format: 'decimal' },
]

const googleAdsKpis: KpiDef[] = [
  { key: 'spend', label: 'Spend', providers: ['google_ads'], metrics: ['spend'], agg: 'sum', format: 'currency' },
  { key: 'impressions', label: 'Impressions', providers: ['google_ads'], metrics: ['impressions'], agg: 'sum', format: 'integer' },
  { key: 'clicks', label: 'Clicks', providers: ['google_ads'], metrics: ['clicks'], agg: 'sum', format: 'integer' },
  { key: 'conversions', label: 'Conversions', providers: ['google_ads'], metrics: ['conversions'], agg: 'sum', format: 'decimal' },
  {
    key: 'cpa', label: 'CPA', providers: ['google_ads'], metrics: [], agg: 'sum', format: 'currency',
    derivedFrom: { numerator: 'spend', denominator: 'conversions', kind: 'cost_per' },
  },
  {
    key: 'roas', label: 'ROAS', providers: ['google_ads'], metrics: [], agg: 'sum', format: 'decimal',
    derivedFrom: { numerator: 'conversions_value', denominator: 'spend', kind: 'ratio' },
  },
  { key: 'conversions_value', label: 'Conv. value', providers: ['google_ads'], metrics: ['conversions_value'], agg: 'sum', format: 'currency' },
]

const metaKpis: KpiDef[] = [
  { key: 'spend', label: 'Spend', providers: [...META_PROVIDERS], metrics: ['spend'], agg: 'sum', format: 'currency' },
  { key: 'impressions', label: 'Impressions', providers: [...META_PROVIDERS], metrics: ['impressions'], agg: 'sum', format: 'integer' },
  { key: 'clicks', label: 'Clicks', providers: [...META_PROVIDERS], metrics: ['clicks'], agg: 'sum', format: 'integer' },
  { key: 'leads', label: 'Results (leads)', providers: [...META_PROVIDERS], metrics: ['leads'], agg: 'sum', format: 'integer' },
  {
    key: 'cpl', label: 'CPL', providers: [...META_PROVIDERS], metrics: [], agg: 'sum', format: 'currency',
    derivedFrom: { numerator: 'spend', denominator: 'leads', kind: 'cost_per' },
  },
]

const localKpis: KpiDef[] = [
  { key: 'impressions_total', label: 'Total impressions', providers: ['gbp'], metrics: ['impressions_total'], agg: 'sum', format: 'integer' },
  { key: 'call_clicks', label: 'Calls', providers: ['gbp'], metrics: ['call_clicks'], agg: 'sum', format: 'integer' },
  { key: 'direction_requests', label: 'Directions', providers: ['gbp'], metrics: ['direction_requests'], agg: 'sum', format: 'integer' },
  { key: 'website_clicks', label: 'Website clicks', providers: ['gbp'], metrics: ['website_clicks'], agg: 'sum', format: 'integer' },
  { key: 'conversations', label: 'Messages', providers: ['gbp'], metrics: ['conversations'], agg: 'sum', format: 'integer' },
]

const leadsKpis: KpiDef[] = [
  { key: 'leads', label: 'Leads', providers: ['leads'], metrics: ['leads'], agg: 'sum', format: 'integer' },
]

/**
 * Channel registry. The 'leads' channel reads a pre-aggregated daily 'leads'
 * series materialized into metric_daily (provider='leads') by Plan 10's leads
 * pipeline; if that series is absent the channel renders empty (never errors).
 */
export const CHANNELS: Record<ChannelKey, ChannelDef> = {
  website: {
    key: 'website', label: 'Website (GA4)', providers: ['ga4'], kpis: websiteKpis,
    caveats: [
      'GA4 may sample large queries; the most recent ~3 days are provisional (24–48h processing lag).',
      'Consent-mode modeling and data thresholding (Google Signals) can affect totals.',
    ],
    verifyUrl: () => 'https://analytics.google.com/',
  },
  search: {
    key: 'search', label: 'Search (GSC)', providers: ['gsc'], kpis: searchKpis,
    caveats: [
      'Search Console has a ~2–3 day lag; recent days are provisional.',
      'Query anonymization (~47% of clicks have no query) means query rows never sum to property totals.',
    ],
    verifyUrl: () => 'https://search.google.com/search-console',
  },
  google_ads: {
    key: 'google_ads', label: 'Google Ads', providers: ['google_ads'], kpis: googleAdsKpis,
    caveats: [
      'Conversions are re-attributed for ~14 days; recent days are provisional.',
      'ROAS = conversions value ÷ spend; CPA = spend ÷ conversions (computed by us).',
    ],
    verifyUrl: (ctx) =>
      ctx.accountId ? `https://ads.google.com/aw/overview?ocid=${encodeURIComponent(ctx.accountId)}` : 'https://ads.google.com/',
  },
  meta: {
    key: 'meta', label: 'Meta Ads', providers: [...META_PROVIDERS], kpis: metaKpis,
    caveats: [
      'Attribution window is 7-day click + 1-day view; 7d/28d-view were removed Jan 2026.',
      'Recent days are provisional while Meta re-settles the 28-day window.',
    ],
    verifyUrl: (ctx) =>
      ctx.accountId ? `https://business.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(ctx.accountId)}` : 'https://business.facebook.com/adsmanager',
  },
  local: {
    key: 'local', label: 'Local (Google Business Profile)', providers: ['gbp'], kpis: localKpis,
    caveats: [
      'Total impressions sum desktop+mobile across maps+search.',
      'GBP data lags ~5 days; recent days are provisional. Reviews are a daily snapshot.',
    ],
    verifyUrl: () => 'https://business.google.com/',
  },
  leads: {
    key: 'leads', label: 'Leads', providers: ['leads'], kpis: leadsKpis,
    caveats: [
      'Leads are de-duplicated across sources (phone E.164, then email).',
      'GBP/GA4 lead signals are modeled/aggregate and excluded from the contact-bearing list.',
    ],
    verifyUrl: () => '/leads',
  },
}

/** Channels shown on the per-client dashboard, in order. */
export const CHANNEL_ORDER: ChannelKey[] = ['website', 'search', 'google_ads', 'meta', 'local', 'leads']

/** Headline KPIs (key per channel) used in the cross-client overview table. */
export const OVERVIEW_KPIS: { channel: ChannelKey; kpi: string; label: string }[] = [
  { channel: 'website', kpi: 'sessions', label: 'Sessions' },
  { channel: 'search', kpi: 'clicks', label: 'Search clicks' },
  { channel: 'google_ads', kpi: 'spend', label: 'Ads spend' },
  { channel: 'google_ads', kpi: 'roas', label: 'ROAS' },
  { channel: 'leads', kpi: 'leads', label: 'Leads' },
  { channel: 'local', kpi: 'impressions_total', label: 'Local impressions' },
]

/** All metric names a channel reads from metric_daily (excludes derived KPIs). */
export function channelMetricNames(channel: ChannelKey): string[] {
  const set = new Set<string>()
  for (const k of CHANNELS[channel].kpis) for (const m of k.metrics) set.add(m)
  // include derived KPI inputs so they get fetched
  for (const k of CHANNELS[channel].kpis) {
    if (k.derivedFrom) {
      const num = CHANNELS[channel].kpis.find((x) => x.key === k.derivedFrom!.numerator)
      const den = CHANNELS[channel].kpis.find((x) => x.key === k.derivedFrom!.denominator)
      num?.metrics.forEach((m) => set.add(m))
      den?.metrics.forEach((m) => set.add(m))
    }
  }
  return [...set]
}

/** All provider tags read across all channels (for a single batched query). */
export function allProviders(): string[] {
  const set = new Set<string>()
  for (const c of CHANNEL_ORDER) for (const p of CHANNELS[c].providers) set.add(p)
  return [...set]
}
```

- [ ] **Step 3: Write the test `tests/analytics/channels.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { CHANNELS, CHANNEL_ORDER, channelMetricNames, allProviders, META_PROVIDERS } from '@/lib/analytics/channels'

describe('channel registry', () => {
  it('maps Meta to BOTH provider tags (meta + meta_ads drift)', () => {
    expect(CHANNELS.meta.providers).toEqual([...META_PROVIDERS])
    expect(CHANNELS.meta.providers).toContain('meta')
    expect(CHANNELS.meta.providers).toContain('meta_ads')
  })

  it('website channel reads ga4 sessions/users/keyEvents', () => {
    const metrics = channelMetricNames('website')
    expect(metrics).toContain('sessions')
    expect(metrics).toContain('users')
    expect(metrics).toContain('keyEvents')
  })

  it('google ads derived KPIs pull their input metrics (roas needs conversions_value + spend)', () => {
    const metrics = channelMetricNames('google_ads')
    expect(metrics).toContain('spend')
    expect(metrics).toContain('conversions_value')
    expect(metrics).toContain('conversions')
  })

  it('verify-in-platform link includes the account id when present', () => {
    const url = CHANNELS.google_ads.verifyUrl({ accountId: '123-456' })
    expect(url).toContain('123-456')
    const fallback = CHANNELS.google_ads.verifyUrl({ accountId: null })
    expect(fallback).toBe('https://ads.google.com/')
  })

  it('allProviders covers every channel provider incl. both meta tags', () => {
    const ps = allProviders()
    for (const p of ['ga4', 'gsc', 'google_ads', 'meta', 'meta_ads', 'gbp', 'leads']) {
      expect(ps).toContain(p)
    }
  })

  it('CHANNEL_ORDER lists all six PRD §5.6 channels once', () => {
    expect([...CHANNEL_ORDER].sort()).toEqual(['google_ads', 'leads', 'local', 'meta', 'search', 'website'])
  })
})
```

- [ ] **Step 4: Run it and confirm it FAILS**

Run: `pnpm test tests/analytics/channels.test.ts`
Expected: FAIL — `@/lib/analytics/channels` and `@/lib/analytics/types` do not exist yet (module-resolution error).

- [ ] **Step 5: Re-run after the files above are in place and confirm it PASSES**

Run: `pnpm test tests/analytics/channels.test.ts`
Expected: PASS — all six assertions green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analytics): channel registry + view-model types (provider-tag drift resolved)"
```

---

## Task 2: Date-range + MoM + provisional math

**Files:**
- Create: `src/lib/analytics/dateRange.ts`
- Create: `tests/analytics/dateRange.test.ts`

The date-range selector drives both views. We need: parse a `{from,to}` period (default: current calendar month), compute the **equal-length previous period** for MoM deltas, and compute the **provisional cutoff** (last ~3 days). All dates are `yyyy-mm-dd` strings in UTC to match `metric_daily.date` (a SQL `date`).

- [ ] **Step 1: Write the test `tests/analytics/dateRange.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parsePeriod, previousPeriod, provisionalCutoff, eachDay, defaultPeriod } from '@/lib/analytics/dateRange'

describe('date range math', () => {
  it('parses explicit from/to', () => {
    const p = parsePeriod({ from: '2026-06-01', to: '2026-06-30' })
    expect(p).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('falls back to the current calendar month when params are missing/invalid', () => {
    const p = parsePeriod({ from: 'nope', to: undefined }, new Date('2026-06-29T00:00:00Z'))
    expect(p).toEqual({ from: '2026-06-01', to: '2026-06-29' })
  })

  it('previous period is the immediately-preceding equal-length window', () => {
    // June 1–30 (30 days) -> previous is May 2–31 (30 days, ending the day before from)
    const prev = previousPeriod({ from: '2026-06-01', to: '2026-06-30' })
    expect(prev).toEqual({ from: '2026-05-02', to: '2026-05-31' })
  })

  it('previous period for a 7-day window is the prior 7 days', () => {
    const prev = previousPeriod({ from: '2026-06-23', to: '2026-06-29' })
    expect(prev).toEqual({ from: '2026-06-16', to: '2026-06-22' })
  })

  it('provisional cutoff = to minus (window-1) days inclusive', () => {
    // last 3 days provisional for to=2026-06-29 => 2026-06-27 .. 2026-06-29
    expect(provisionalCutoff('2026-06-29', 3)).toBe('2026-06-27')
  })

  it('eachDay enumerates inclusive yyyy-mm-dd days', () => {
    expect(eachDay('2026-06-27', '2026-06-29')).toEqual(['2026-06-27', '2026-06-28', '2026-06-29'])
  })

  it('defaultPeriod is the month-to-date for the given clock', () => {
    expect(defaultPeriod(new Date('2026-06-29T12:00:00Z'))).toEqual({ from: '2026-06-01', to: '2026-06-29' })
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/analytics/dateRange.test.ts`
Expected: FAIL — `@/lib/analytics/dateRange` not found.

- [ ] **Step 3: Implement `src/lib/analytics/dateRange.ts`**

```ts
import 'server-only'

export type Period = { from: string; to: string }

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(iso: string, n: number): string {
  const d = toUtc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}
function isValid(iso: unknown): iso is string {
  return typeof iso === 'string' && ISO_RE.test(iso) && !Number.isNaN(toUtc(iso).getTime())
}

/** Current calendar month-to-date. */
export function defaultPeriod(now: Date = new Date()): Period {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const from = fmt(new Date(Date.UTC(y, m, 1)))
  const to = fmt(new Date(Date.UTC(y, m, now.getUTCDate())))
  return { from, to }
}

/** Parse from/to search params, defaulting to month-to-date; clamps from<=to. */
export function parsePeriod(
  params: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): Period {
  const def = defaultPeriod(now)
  const from = isValid(params.from) ? params.from : def.from
  const to = isValid(params.to) ? params.to : def.to
  if (toUtc(from).getTime() > toUtc(to).getTime()) return { from: to, to: from }
  return { from, to }
}

/** Number of inclusive days in a period. */
export function periodLength(p: Period): number {
  return Math.round((toUtc(p.to).getTime() - toUtc(p.from).getTime()) / 86_400_000) + 1
}

/** Immediately-preceding window of equal length, ending the day before `from`. */
export function previousPeriod(p: Period): Period {
  const len = periodLength(p)
  const to = addDays(p.from, -1)
  const from = addDays(to, -(len - 1))
  return { from, to }
}

/** First provisional day: `to` minus (windowDays-1). */
export function provisionalCutoff(to: string, windowDays: number): string {
  return addDays(to, -(windowDays - 1))
}

/** Inclusive list of yyyy-mm-dd days from `from` to `to`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  while (toUtc(cur).getTime() <= toUtc(to).getTime()) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/analytics/dateRange.test.ts`
Expected: PASS — all seven assertions green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(analytics): period parsing, MoM previous-period, provisional cutoff"
```

---

## Task 3: Aggregation library (rows → KPI view-models, deltas, series)

**Files:**
- Create: `src/lib/analytics/aggregate.ts`
- Create: `tests/analytics/aggregate.test.ts`

This is the deterministic core: pure functions that turn `MetricRow[]` (current + previous period) into `ChannelKpi[]`, `DailyPoint[]` series, and `OverviewRow` headline cells — with no DB or network. Testing it in isolation guarantees the "every KPI traces to a stored dated row" property structurally.

- [ ] **Step 1: Write the test `tests/analytics/aggregate.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildChannelView, buildKpi, dailySeries } from '@/lib/analytics/aggregate'
import type { MetricRow } from '@/lib/analytics/types'

const row = (over: Partial<MetricRow>): MetricRow => ({
  organizationId: 'org', provider: 'ga4', accountId: 'p1', entity: 'property',
  date: '2026-06-01', metric: 'sessions', value: 0, isProvisional: false, ...over,
})

describe('aggregate', () => {
  it('sums a KPI across days and computes MoM delta vs previous period', () => {
    const cur = [row({ value: 10, date: '2026-06-01' }), row({ value: 20, date: '2026-06-02' })]
    const prev = [row({ value: 10, date: '2026-05-01' }), row({ value: 10, date: '2026-05-02' })]
    const kpi = buildKpi(
      { key: 'sessions', label: 'Sessions', providers: ['ga4'], metrics: ['sessions'], agg: 'sum', format: 'integer' },
      cur, prev, [],
    )
    expect(kpi.value).toBe(30)
    expect(kpi.previous).toBe(20)
    expect(kpi.deltaPct).toBeCloseTo(0.5) // +50%
  })

  it('avg KPI averages daily values (engagement rate)', () => {
    const cur = [
      row({ metric: 'engagementRate', value: 0.6, date: '2026-06-01' }),
      row({ metric: 'engagementRate', value: 0.8, date: '2026-06-02' }),
    ]
    const kpi = buildKpi(
      { key: 'engagementRate', label: 'Engagement', providers: ['ga4'], metrics: ['engagementRate'], agg: 'avg', format: 'percent' },
      cur, [], [],
    )
    expect(kpi.value).toBeCloseTo(0.7)
    expect(kpi.deltaPct).toBeNull() // no previous data
  })

  it('derived cost_per KPI = numerator/denominator (CPA = spend/conversions)', () => {
    const cur = [
      row({ provider: 'google_ads', metric: 'spend', value: 100 }),
      row({ provider: 'google_ads', metric: 'conversions', value: 4 }),
    ]
    const kpis = [
      { key: 'spend', label: 'Spend', providers: ['google_ads'], metrics: ['spend'], agg: 'sum' as const, format: 'currency' as const },
      { key: 'conversions', label: 'Conv', providers: ['google_ads'], metrics: ['conversions'], agg: 'sum' as const, format: 'decimal' as const },
      { key: 'cpa', label: 'CPA', providers: ['google_ads'], metrics: [], agg: 'sum' as const, format: 'currency' as const, derivedFrom: { numerator: 'spend', denominator: 'conversions', kind: 'cost_per' as const } },
    ]
    const cpa = buildKpi(kpis[2]!, cur, [], kpis)
    expect(cpa.value).toBe(25) // 100 / 4
  })

  it('derived ratio KPI guards divide-by-zero (ROAS with zero spend = 0)', () => {
    const cur = [row({ provider: 'google_ads', metric: 'conversions_value', value: 50 })]
    const kpis = [
      { key: 'conversions_value', label: 'Value', providers: ['google_ads'], metrics: ['conversions_value'], agg: 'sum' as const, format: 'currency' as const },
      { key: 'spend', label: 'Spend', providers: ['google_ads'], metrics: ['spend'], agg: 'sum' as const, format: 'currency' as const },
      { key: 'roas', label: 'ROAS', providers: ['google_ads'], metrics: [], agg: 'sum' as const, format: 'decimal' as const, derivedFrom: { numerator: 'conversions_value', denominator: 'spend', kind: 'ratio' as const } },
    ]
    const roas = buildKpi(kpis[2]!, cur, [], kpis)
    expect(roas.value).toBe(0)
  })

  it('flags hasProvisional when any contributing row is provisional', () => {
    const cur = [row({ value: 5, isProvisional: true })]
    const kpi = buildKpi(
      { key: 'sessions', label: 'Sessions', providers: ['ga4'], metrics: ['sessions'], agg: 'sum', format: 'integer' },
      cur, [], [],
    )
    expect(kpi.hasProvisional).toBe(true)
  })

  it('dailySeries fills missing days with zero and preserves provisional flags', () => {
    const rows = [row({ value: 10, date: '2026-06-27', isProvisional: true })]
    const series = dailySeries(rows, ['sessions'], ['ga4'], '2026-06-27', '2026-06-29')
    expect(series).toEqual([
      { date: '2026-06-27', value: 10, isProvisional: true },
      { date: '2026-06-28', value: 0, isProvisional: false },
      { date: '2026-06-29', value: 0, isProvisional: false },
    ])
  })

  it('buildChannelView marks a channel empty when no rows match', () => {
    const view = buildChannelView('meta', [], [], '2026-06-01', '2026-06-30', { accountId: null })
    expect(view.empty).toBe(true)
    expect(view.kpis.every((k) => k.value === 0)).toBe(true)
  })

  it('buildChannelView reads BOTH meta and meta_ads provider rows', () => {
    const cur = [
      row({ provider: 'meta', metric: 'spend', value: 12 }),
      row({ provider: 'meta_ads', metric: 'spend', value: 8 }),
    ]
    const view = buildChannelView('meta', cur, [], '2026-06-01', '2026-06-30', { accountId: '999' })
    const spend = view.kpis.find((k) => k.key === 'spend')!
    expect(spend.value).toBe(20)
    expect(view.empty).toBe(false)
    expect(view.verifyUrl).toContain('999')
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/analytics/aggregate.test.ts`
Expected: FAIL — `@/lib/analytics/aggregate` not found.

- [ ] **Step 3: Implement `src/lib/analytics/aggregate.ts`**

```ts
import 'server-only'
import { CHANNELS } from './channels'
import { eachDay } from './dateRange'
import type { ChannelKey, ChannelKpi, ChannelView, DailyPoint, KpiDef, MetricRow } from './types'

/** Rows matching any of the given providers + metrics. */
function matching(rows: MetricRow[], providers: string[], metrics: string[]): MetricRow[] {
  const ps = new Set(providers)
  const ms = new Set(metrics)
  return rows.filter((r) => ps.has(r.provider) && ms.has(r.metric))
}

/** Aggregate a set of rows by the KPI's agg strategy. */
function aggregate(rows: MetricRow[], agg: KpiDef['agg']): number {
  if (rows.length === 0) return 0
  if (agg === 'sum') return rows.reduce((s, r) => s + r.value, 0)
  if (agg === 'latest') {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    return sorted[sorted.length - 1]!.value
  }
  // avg: mean over distinct days (values are per-day already)
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.value)
  const vals = [...byDay.values()]
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

/** Raw aggregated value for a non-derived KPI key (used by derived KPIs). */
function rawValue(def: KpiDef, rows: MetricRow[]): number {
  return aggregate(matching(rows, def.providers, def.metrics), def.agg)
}

/** Build one KPI (handles sum/avg/latest and derived ratio/cost_per). */
export function buildKpi(
  def: KpiDef,
  current: MetricRow[],
  previous: MetricRow[],
  siblingDefs: KpiDef[],
): ChannelKpi {
  const compute = (rows: MetricRow[]): number => {
    if (!def.derivedFrom) return rawValue(def, rows)
    const num = siblingDefs.find((d) => d.key === def.derivedFrom!.numerator)
    const den = siblingDefs.find((d) => d.key === def.derivedFrom!.denominator)
    const n = num ? rawValue(num, rows) : 0
    const d = den ? rawValue(den, rows) : 0
    if (d === 0) return 0
    return n / d
  }

  const value = compute(current)
  const prev = previous.length > 0 ? compute(previous) : null
  const deltaPct = prev != null && prev !== 0 ? (value - prev) / prev : null
  const hasProvisional = (def.derivedFrom ? collectDerivedRows(def, current, siblingDefs) : matching(current, def.providers, def.metrics))
    .some((r) => r.isProvisional)

  return { key: def.key, label: def.label, format: def.format, value, previous: prev, deltaPct, hasProvisional }
}

function collectDerivedRows(def: KpiDef, rows: MetricRow[], siblingDefs: KpiDef[]): MetricRow[] {
  if (!def.derivedFrom) return matching(rows, def.providers, def.metrics)
  const num = siblingDefs.find((d) => d.key === def.derivedFrom!.numerator)
  const den = siblingDefs.find((d) => d.key === def.derivedFrom!.denominator)
  const out: MetricRow[] = []
  if (num) out.push(...matching(rows, num.providers, num.metrics))
  if (den) out.push(...matching(rows, den.providers, den.metrics))
  return out
}

/** Daily series for a metric set, zero-filled across the period. */
export function dailySeries(
  rows: MetricRow[],
  metrics: string[],
  providers: string[],
  from: string,
  to: string,
): DailyPoint[] {
  const ps = new Set(providers)
  const ms = new Set(metrics)
  const byDay = new Map<string, { value: number; isProvisional: boolean }>()
  for (const r of rows) {
    if (!ps.has(r.provider) || !ms.has(r.metric)) continue
    const cell = byDay.get(r.date) ?? { value: 0, isProvisional: false }
    cell.value += r.value
    cell.isProvisional = cell.isProvisional || r.isProvisional
    byDay.set(r.date, cell)
  }
  return eachDay(from, to).map((date) => {
    const cell = byDay.get(date)
    return { date, value: cell?.value ?? 0, isProvisional: cell?.isProvisional ?? false }
  })
}

/** Build a full channel view-model from current + previous period rows. */
export function buildChannelView(
  channel: ChannelKey,
  current: MetricRow[],
  previous: MetricRow[],
  from: string,
  to: string,
  ctx: { accountId?: string | null },
): ChannelView {
  const def = CHANNELS[channel]
  const kpis = def.kpis.map((k) => buildKpi(k, current, previous, def.kpis))
  // primary series = the first non-derived KPI's first metric
  const primary = def.kpis.find((k) => !k.derivedFrom && k.metrics.length > 0)
  const seriesMetric = primary?.metrics[0] ?? ''
  const series = primary
    ? dailySeries(current, primary.metrics, def.providers, from, to)
    : []
  const empty = current.length === 0
  return {
    key: channel,
    label: def.label,
    kpis,
    series,
    seriesMetric,
    caveats: def.caveats,
    verifyUrl: def.verifyUrl({ accountId: ctx.accountId ?? null }),
    empty,
  }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/analytics/aggregate.test.ts`
Expected: PASS — all eight assertions green (sum/avg/derived/divide-by-zero/provisional/zero-fill/empty/dual-meta-tag).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(analytics): pure aggregation lib (KPIs, MoM deltas, daily series)"
```

---

## Task 4: Freshness, CSV, and the store-read queries (staff + portal)

**Files:**
- Create: `src/lib/analytics/freshness.ts`
- Create: `src/lib/analytics/csv.ts`
- Create: `src/lib/analytics/queries.ts`

These wire the pure library to the database. Reads use the natural key columns of `metric_daily` and never call any external API (PRD §6.1 / §11). Staff reads (`getOrgAnalytics` with the service-role `db`) pass an explicit `organizationId`; portal reads must run under the caller's JWT so RLS applies — Task 6 proves the isolation.

- [ ] **Step 1: Implement `src/lib/analytics/freshness.ts`**

```ts
import 'server-only'
import { provisionalCutoff, eachDay } from './dateRange'
import type { Freshness, Period } from './types'

const SLA_HOURS = 24 // PRD §11: external metrics <= 24h stale

/**
 * Compute freshness from the latest successful sync across the shown channels.
 * `lastSuccessAts` are connection.lastSuccessAt ISO strings (nulls allowed).
 */
export function computeFreshness(
  lastSuccessAts: (string | null)[],
  period: Period,
  provisionalWindowDays = 3,
  now: Date = new Date(),
): Freshness {
  const valid = lastSuccessAts.filter((x): x is string => !!x)
  const asOf = valid.length > 0 ? valid.sort().slice(-1)[0]! : null
  const stale = asOf ? now.getTime() - new Date(asOf).getTime() > SLA_HOURS * 3_600_000 : true
  const cutoff = provisionalCutoff(period.to, provisionalWindowDays)
  // count provisional days that fall inside the selected period
  const days = eachDay(period.from, period.to)
  const provisionalDays = days.filter((d) => d >= cutoff).length
  return { asOf, stale, provisionalDays }
}
```

- [ ] **Step 2: Implement `src/lib/analytics/csv.ts`**

```ts
import 'server-only'
import type { ChannelView } from './types'

function esc(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Flatten channel views into a CSV (one row per KPI). */
export function channelsToCsv(
  clientName: string,
  period: { from: string; to: string },
  views: ChannelView[],
): string {
  const lines: string[] = []
  lines.push(`Client,${esc(clientName)}`)
  lines.push(`Period,${esc(period.from)} to ${esc(period.to)}`)
  lines.push('')
  lines.push(['Channel', 'KPI', 'Value', 'Previous', 'Delta %', 'Provisional'].join(','))
  for (const v of views) {
    for (const k of v.kpis) {
      lines.push(
        [
          esc(v.label),
          esc(k.label),
          esc(k.value),
          k.previous == null ? '' : esc(k.previous),
          k.deltaPct == null ? '' : esc((k.deltaPct * 100).toFixed(1)),
          k.hasProvisional ? 'yes' : 'no',
        ].join(','),
      )
    }
  }
  return lines.join('\n')
}
```

- [ ] **Step 3: Implement `src/lib/analytics/queries.ts`**

```ts
import 'server-only'
import { and, gte, lte, eq, inArray, sql as dsql } from 'drizzle-orm'
import { db } from '@/db'
import { metricDaily, connection, clients } from '@/db/schema'
import { CHANNELS, CHANNEL_ORDER, channelMetricNames, allProviders, OVERVIEW_KPIS } from './channels'
import { buildChannelView, buildKpi, dailySeries } from './aggregate'
import { computeFreshness } from './freshness'
import { previousPeriod } from './dateRange'
import type { ChannelKey, ChannelView, Freshness, MetricRow, OverviewRow, Period } from './types'

type Drizzle = typeof db

/** Map a metric_daily DB row (numeric comes back as string) to MetricRow. */
function toRow(r: {
  organizationId: string; provider: string; accountId: string; entity: string
  date: string; metric: string; value: string; isProvisional: boolean
}): MetricRow {
  return {
    organizationId: r.organizationId,
    provider: r.provider,
    accountId: r.accountId,
    entity: r.entity,
    date: r.date,
    metric: r.metric,
    value: Number(r.value),
    isProvisional: r.isProvisional,
  }
}

/** Fetch metric_daily rows for one org across a date range (all channels). */
async function fetchRows(client: Drizzle, organizationId: string, from: string, to: string): Promise<MetricRow[]> {
  const rows = await client
    .select({
      organizationId: metricDaily.organizationId,
      provider: metricDaily.provider,
      accountId: metricDaily.accountId,
      entity: metricDaily.entity,
      date: metricDaily.date,
      metric: metricDaily.metric,
      value: metricDaily.value,
      isProvisional: metricDaily.isProvisional,
    })
    .from(metricDaily)
    .where(
      and(
        eq(metricDaily.organizationId, organizationId),
        inArray(metricDaily.provider, allProviders() as string[]),
        gte(metricDaily.date, from),
        lte(metricDaily.date, to),
      ),
    )
  return rows.map((r) => toRow(r as never))
}

/** Latest successful sync time per provider for one org (for the "as of" badge). */
async function fetchLastSuccess(client: Drizzle, organizationId: string): Promise<(string | null)[]> {
  const rows = await client
    .select({ lastSuccessAt: connection.lastSuccessAt })
    .from(connection)
    .where(eq(connection.organizationId, organizationId))
  return rows.map((r) => (r.lastSuccessAt ? new Date(r.lastSuccessAt).toISOString() : null))
}

/** Optionally resolve a verify-link accountId per channel from the latest entity seen. */
function accountIdFor(rows: MetricRow[], channel: ChannelKey): string | null {
  const providers = new Set(CHANNELS[channel].providers)
  const hit = rows.find((r) => providers.has(r.provider))
  return hit?.accountId ?? null
}

export type OrgAnalytics = {
  organizationId: string
  period: Period
  views: ChannelView[]
  freshness: Freshness
}

/**
 * Build the full per-client channel dashboard for one org.
 * Pass `client = db` for staff (service role); pass an RLS-bound client for the
 * portal (Task 5 supplies it) so the caller can only read their own org.
 */
export async function getOrgAnalytics(
  organizationId: string,
  period: Period,
  client: Drizzle = db,
): Promise<OrgAnalytics> {
  const prev = previousPeriod(period)
  const [curRows, prevRows, lastSuccess] = await Promise.all([
    fetchRows(client, organizationId, period.from, period.to),
    fetchRows(client, organizationId, prev.from, prev.to),
    fetchLastSuccess(client, organizationId),
  ])
  const views = CHANNEL_ORDER.map((ch) =>
    buildChannelView(ch, curRows, prevRows, period.from, period.to, { accountId: accountIdFor(curRows, ch) }),
  )
  const freshness = computeFreshness(lastSuccess, period)
  return { organizationId, period, views, freshness }
}

/**
 * Cross-client overview (staff only). One OverviewRow per active client, with
 * headline KPIs + a sessions sparkline. Uses the service-role `db` client and
 * is app-scoped to all client orgs (the page itself is guarded staff-only).
 */
export async function getCrossClientOverview(period: Period): Promise<OverviewRow[]> {
  const prev = previousPeriod(period)
  const clientRows = await db.select({ id: clients.id, organizationId: clients.organizationId, name: clients.name }).from(clients)

  const out: OverviewRow[] = []
  for (const c of clientRows) {
    const [cur, prv] = await Promise.all([
      fetchRows(db, c.organizationId, period.from, period.to),
      fetchRows(db, c.organizationId, prev.from, prev.to),
    ])
    const kpis: Record<string, ReturnType<typeof buildKpi>> = {}
    for (const { channel, kpi } of OVERVIEW_KPIS) {
      const def = CHANNELS[channel].kpis.find((k) => k.key === kpi)
      if (!def) continue
      kpis[`${channel}.${kpi}`] = buildKpi(def, cur, prv, CHANNELS[channel].kpis)
    }
    const spark = dailySeries(cur, ['sessions'], ['ga4'], period.from, period.to)
    out.push({ organizationId: c.organizationId, clientId: c.id, clientName: c.name, kpis, spark })
  }
  return out
}
```

> Note on the RLS-bound client for the portal: Task 5 builds a request-scoped Drizzle client (`createRlsDb()` in `src/db/rls.ts`) that sets `request.jwt.claims` per the Plan 01 `asUser()` pattern, so portal reads are double-enforced (explicit `organizationId` + RLS). If your codebase already exposes such a helper from an earlier plan, import it instead of re-creating it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(analytics): freshness, CSV, and store-read queries (staff + org-scoped)"
```

---

## Task 5: RLS-bound DB client + portal Performance page (reused channel dashboard)

**Files:**
- Create: `src/db/rls.ts`
- Create: `src/components/analytics/AsOfBadge.tsx`
- Create: `src/components/analytics/KpiCard.tsx`
- Create: `src/components/analytics/Sparkline.tsx`
- Create: `src/components/analytics/ChannelChart.tsx`
- Create: `src/components/analytics/CaveatFootnotes.tsx`
- Create: `src/components/analytics/VerifyInPlatformLink.tsx`
- Create: `src/components/analytics/DateRangeSelector.tsx`
- Create: `src/components/analytics/ChannelDashboard.tsx`
- Create: `src/app/(portal)/performance/page.tsx`

- [ ] **Step 1: Add the shadcn primitives used by this plan**

```bash
pnpm dlx shadcn@latest add table select tabs badge chart
```
Expected: `src/components/ui/{table,select,tabs,badge,chart}.tsx` exist (`card`/`button` already added in Plan 01).

- [ ] **Step 2: Request-scoped RLS Drizzle client `src/db/rls.ts`**

```ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * A Drizzle client that runs as the `authenticated` role with the caller's
 * Supabase user id stamped into request.jwt.claims, so Postgres RLS applies
 * (mirrors the Plan 01 test harness asUser()). Use for client-portal reads.
 * The connection is short-lived (one request) and must be closed by the caller.
 */
export async function withRlsDb<T>(userId: string, fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  const db = drizzle(client, { schema })
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local role authenticated`)
      const claims = JSON.stringify({ sub: userId, role: 'authenticated' })
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
      return fn(tx as unknown as ReturnType<typeof drizzle<typeof schema>>)
    })
  } finally {
    await client.end({ timeout: 5 })
  }
}
```

- [ ] **Step 3: `AsOfBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { Freshness } from '@/lib/analytics/types'

export function AsOfBadge({ freshness }: { freshness: Freshness }) {
  const asOf = freshness.asOf ? new Date(freshness.asOf).toLocaleString('en-GB', { timeZone: 'UTC' }) : 'never synced'
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge variant={freshness.stale ? 'destructive' : 'secondary'}>
        {freshness.stale ? 'Data may be stale' : 'Up to date'}
      </Badge>
      <span>as of {asOf} UTC</span>
      {freshness.provisionalDays > 0 && (
        <span title="Recent days are still settling and may change.">
          · last {freshness.provisionalDays} day(s) provisional
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `KpiCard.tsx`, `Sparkline.tsx`, `ChannelChart.tsx`, `CaveatFootnotes.tsx`, `VerifyInPlatformLink.tsx`**

`src/components/analytics/KpiCard.tsx`:
```tsx
import { Card } from '@/components/ui/card'
import type { ChannelKpi } from '@/lib/analytics/types'

function formatValue(k: ChannelKpi): string {
  if (k.format === 'percent') return `${(k.value * 100).toFixed(1)}%`
  if (k.format === 'currency') return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(k.value)
  if (k.format === 'decimal') return k.value.toFixed(2)
  return Math.round(k.value).toLocaleString('en-GB')
}

export function KpiCard({ kpi }: { kpi: ChannelKpi }) {
  const up = kpi.deltaPct != null && kpi.deltaPct >= 0
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">{kpi.label}</p>
        {kpi.hasProvisional && <span className="text-[10px] text-amber-600">provisional</span>}
      </div>
      <p className="mt-1 text-2xl font-semibold">{formatValue(kpi)}</p>
      {kpi.deltaPct != null ? (
        <p className={`mt-1 text-xs ${up ? 'text-emerald-600' : 'text-red-600'}`}>
          {up ? '▲' : '▼'} {Math.abs(kpi.deltaPct * 100).toFixed(1)}% vs prev. period
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">no prior data</p>
      )}
    </Card>
  )
}
```

`src/components/analytics/Sparkline.tsx`:
```tsx
'use client'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { DailyPoint } from '@/lib/analytics/types'

export function Sparkline({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

`src/components/analytics/ChannelChart.tsx`:
```tsx
'use client'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyPoint } from '@/lib/analytics/types'

export function ChannelChart({ data, metric }: { data: DailyPoint[]; metric: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            formatter={(v: number, _n, p) => [v, (p?.payload as DailyPoint)?.isProvisional ? `${metric} (provisional)` : metric]}
          />
          <Area type="monotone" dataKey="value" stroke="currentColor" fill="currentColor" fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

`src/components/analytics/CaveatFootnotes.tsx`:
```tsx
export function CaveatFootnotes({ caveats }: { caveats: string[] }) {
  if (caveats.length === 0) return null
  return (
    <ul className="mt-2 list-disc pl-4 text-[11px] text-muted-foreground">
      {caveats.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  )
}
```

`src/components/analytics/VerifyInPlatformLink.tsx`:
```tsx
export function VerifyInPlatformLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">
      Verify in {label} ↗
    </a>
  )
}
```

- [ ] **Step 5: `DateRangeSelector.tsx` (client component, updates query string)**

```tsx
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export function DateRangeSelector({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function update(key: 'from' | 'to', value: string) {
    const next = new URLSearchParams(params.toString())
    next.set(key, value)
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1">
        From
        <input type="date" value={from} onChange={(e) => update('from', e.target.value)} className="rounded border p-1" />
      </label>
      <label className="flex items-center gap-1">
        To
        <input type="date" value={to} onChange={(e) => update('to', e.target.value)} className="rounded border p-1" />
      </label>
    </div>
  )
}
```

- [ ] **Step 6: `ChannelDashboard.tsx` (shared by internal drilldown + portal)**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from './KpiCard'
import { ChannelChart } from './ChannelChart'
import { CaveatFootnotes } from './CaveatFootnotes'
import { VerifyInPlatformLink } from './VerifyInPlatformLink'
import { AsOfBadge } from './AsOfBadge'
import type { OrgAnalytics } from '@/lib/analytics/queries'

export function ChannelDashboard({ data }: { data: OrgAnalytics }) {
  return (
    <div className="flex flex-col gap-4">
      <AsOfBadge freshness={data.freshness} />
      <Tabs defaultValue={data.views[0]?.key ?? 'website'}>
        <TabsList className="flex-wrap">
          {data.views.map((v) => (
            <TabsTrigger key={v.key} value={v.key}>
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {data.views.map((v) => (
          <TabsContent key={v.key} value={v.key} className="flex flex-col gap-4">
            {v.empty ? (
              <p className="text-sm text-muted-foreground">No data for this channel in the selected period. Connect the source in onboarding.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {v.kpis.map((k) => (
                    <KpiCard key={k.key} kpi={k} />
                  ))}
                </div>
                <ChannelChart data={v.series} metric={v.seriesMetric} />
              </>
            )}
            <div className="flex items-center justify-between">
              <VerifyInPlatformLink href={v.verifyUrl} label={v.label} />
            </div>
            <CaveatFootnotes caveats={v.caveats} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 7: Portal Performance page `src/app/(portal)/performance/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { withRlsDb } from '@/db/rls'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { ChannelDashboard } from '@/components/analytics/ChannelDashboard'
import { DateRangeSelector } from '@/components/analytics/DateRangeSelector'
import { ExportButtons } from '@/components/analytics/ExportButtons'

export const dynamic = 'force-dynamic' // never cache tenant data (PRD §9 caching safety)

export default async function Performance({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  if (!session.orgId) redirect('/overview')

  const sp = await searchParams
  const period = parsePeriod({ from: sp.from, to: sp.to })

  // Double-enforced: explicit orgId AND RLS via the authenticated-role connection.
  const data = await withRlsDb(session.userId, (db) => getOrgAnalytics(session.orgId!, period, db))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Performance</h1>
        <div className="flex items-center gap-3">
          <DateRangeSelector from={period.from} to={period.to} />
          <ExportButtons surface="portal" from={period.from} to={period.to} />
        </div>
      </div>
      <ChannelDashboard data={data} />
    </div>
  )
}
```

- [ ] **Step 8: Build check**

Run: `pnpm build`
Expected: compiles with no type errors. (`ExportButtons` is created in Task 7; if running this step before Task 7, temporarily comment its import/usage, then restore — or implement Task 7 first.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(analytics): RLS-bound db client + shared channel dashboard + portal Performance page"
```

---

## Task 6: KEYSTONE — portal view is own-org only, and every KPI traces to a stored row

**Files:**
- Create: `tests/analytics/traces-to-store.test.ts`

This is the release-gate test for PRD §5.6 acceptance criteria: "Every KPI traces to a stored, dated row (no live API call on page load)" and "Client view is strictly scoped to own org (RLS test)." We seed `metric_daily` rows directly (mimicking what the Plan 06 sync would land), then assert (a) `getOrgAnalytics` run under a client user's JWT returns only that org's numbers, equal to the sum of the seeded rows; and (b) a client user cannot read another client's metric rows at all.

- [ ] **Step 1: Write `tests/analytics/traces-to-store.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql as dsql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../../src/db/schema'
import { getOrgAnalytics } from '../../src/lib/analytics/queries'
import type { Period } from '../../src/lib/analytics/types'

const PERIOD: Period = { from: '2026-06-01', to: '2026-06-30' }

async function orgIdBySlug(slug: string): Promise<string> {
  const rows = await sql`select id from public.organizations where slug = ${slug}`
  return rows[0]!.id as string
}

describe('analytics traces to the metrics store + portal own-org isolation', () => {
  let clientOneOrg: string
  let clientTwoOrg: string
  let clientOneUser: string

  beforeAll(async () => {
    clientOneOrg = await orgIdBySlug('client-one')
    clientTwoOrg = await orgIdBySlug('client-two')
    clientOneUser = await userIdByEmail('user1@clientone.com')

    // Seed two ga4 'sessions' rows for client-one and one for client-two.
    await sql`delete from public.metric_daily where provider = 'ga4' and metric = 'sessions'
              and organization_id in (${clientOneOrg}, ${clientTwoOrg})`
    await sql`insert into public.metric_daily
        (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
      values
        (${clientOneOrg}, 'ga4', 'p1', 'property', '2026-06-10', 'sessions', 100, false),
        (${clientOneOrg}, 'ga4', 'p1', 'property', '2026-06-11', 'sessions', 50, false),
        (${clientTwoOrg}, 'ga4', 'p2', 'property', '2026-06-10', 'sessions', 999, false)`
  })

  afterAll(async () => {
    await sql`delete from public.metric_daily where provider = 'ga4' and metric = 'sessions'
              and organization_id in (${clientOneOrg}, ${clientTwoOrg})`
    await sql.end()
  })

  it('every KPI value equals the sum of the seeded dated rows (no live API)', async () => {
    // Service-role read (staff path) sums client-one's two rows = 150.
    const data = await getOrgAnalytics(clientOneOrg, PERIOD)
    const website = data.views.find((v) => v.key === 'website')!
    const sessions = website.kpis.find((k) => k.key === 'sessions')!
    expect(sessions.value).toBe(150)
    // the series sums to the same total (traceability)
    const seriesTotal = website.series.reduce((s, p) => s + p.value, 0)
    expect(seriesTotal).toBe(150)
  })

  it('a client user reading under RLS sees ONLY their own org rows', async () => {
    // Run getOrgAnalytics with a tx bound to client-one's JWT (RLS active).
    const rows = await asUser(clientOneUser, async (tx) => {
      // sanity: raw RLS read returns only client-one rows
      const own = await tx`select organization_id, value from public.metric_daily where provider = 'ga4' and metric = 'sessions'`
      return own
    })
    expect(rows.every((r) => r.organization_id === clientOneOrg)).toBe(true)
    const total = rows.reduce((s, r) => s + Number(r.value), 0)
    expect(total).toBe(150) // never sees client-two's 999
  })

  it('a client user cannot read another org via getOrgAnalytics under RLS', async () => {
    // Build an authenticated-role connection (mirrors withRlsDb) and try to read client-two.
    const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
    const db = drizzle(client, { schema })
    try {
      const leaked = await db.transaction(async (tx) => {
        await tx.execute(dsql`set local role authenticated`)
        const claims = JSON.stringify({ sub: clientOneUser, role: 'authenticated' })
        await tx.execute(dsql`select set_config('request.jwt.claims', ${claims}, true)`)
        // Ask the library for client-TWO while authenticated as client-one.
        return getOrgAnalytics(clientTwoOrg, PERIOD, tx as never)
      })
      const sessions = leaked.views.find((v) => v.key === 'website')!.kpis.find((k) => k.key === 'sessions')!
      // RLS filters out all of client-two's rows => 0, no leak of the 999.
      expect(sessions.value).toBe(0)
    } finally {
      await client.end({ timeout: 5 })
    }
  })
})
```

- [ ] **Step 2: Ensure the seed + migrations are applied, then run the test**

Run:
```bash
pnpm db:migrate
pnpm db:seed
pnpm test tests/analytics/traces-to-store.test.ts
```
Expected: PASS — staff sum = 150; client-one under RLS sees only 150 (never 999); requesting client-two while authenticated as client-one returns 0 (RLS strips the rows). This proves both acceptance criteria.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(analytics): KEYSTONE — KPIs trace to stored rows; portal is strictly own-org (RLS)"
```

---

## Task 7: Export — CSV server actions + PDF route handlers + audit table

**Files:**
- Modify: `src/db/schema.ts` (add `analytics_export_log`)
- Modify: `src/db/types.ts` (add types)
- Create: `tests/rls/analytics-export-log.test.ts` (KEYSTONE RLS isolation — write FIRST)
- Create: `drizzle/00NN_analytics_export_log_rls.sql` (custom migration)
- Create: `src/lib/pdf/AnalyticsReport.tsx`
- Create: `src/components/analytics/ExportButtons.tsx`
- Create: `src/app/(internal)/analytics/actions.ts`
- Create: `src/app/(portal)/performance/actions.ts`
- Create: `src/app/(internal)/analytics/export/pdf/route.ts`
- Create: `src/app/(portal)/performance/export/pdf/route.ts`

`analytics_export_log` is a new **tenant-scoped** table (who exported which org's analytics, when, in what format) — so per shared conventions it needs `organization_id` leading a composite index, RLS reusing the Plan 01 helpers, and an RLS isolation test written first.

- [ ] **Step 1: Write the RLS isolation test FIRST `tests/rls/analytics-export-log.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

async function orgIdBySlug(slug: string): Promise<string> {
  const rows = await sql`select id from public.organizations where slug = ${slug}`
  return rows[0]!.id as string
}

describe('analytics_export_log tenant isolation (RLS)', () => {
  let clientOneOrg: string
  let clientTwoOrg: string
  let clientOneUser: string
  let founder: string

  beforeAll(async () => {
    clientOneOrg = await orgIdBySlug('client-one')
    clientTwoOrg = await orgIdBySlug('client-two')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    founder = await userIdByEmail('founder@milktreeagency.com')

    await sql`delete from public.analytics_export_log where organization_id in (${clientOneOrg}, ${clientTwoOrg})`
    await sql`insert into public.analytics_export_log (organization_id, exported_by, format, period_from, period_to)
              values
                (${clientOneOrg}, ${clientOneUser}, 'csv', '2026-06-01', '2026-06-30'),
                (${clientTwoOrg}, ${founder}, 'pdf', '2026-06-01', '2026-06-30')`
  })

  afterAll(async () => {
    await sql`delete from public.analytics_export_log where organization_id in (${clientOneOrg}, ${clientTwoOrg})`
    await sql.end()
  })

  it('a client user sees ONLY their own org export rows', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select organization_id from public.analytics_export_log`)
    expect(rows.every((r) => r.organization_id === clientOneOrg)).toBe(true)
    expect(rows.length).toBe(1)
  })

  it('agency staff (founder) sees export rows for all orgs', async () => {
    const rows = await asUser(founder, (tx) => tx`select organization_id from public.analytics_export_log`)
    const orgs = new Set(rows.map((r) => r.organization_id))
    expect(orgs.has(clientOneOrg)).toBe(true)
    expect(orgs.has(clientTwoOrg)).toBe(true)
  })

  it('a client user cannot insert an export row for another org', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.analytics_export_log (organization_id, exported_by, format, period_from, period_to)
           values (${clientTwoOrg}, ${clientOneUser}, 'csv', '2026-06-01', '2026-06-30')`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/rls/analytics-export-log.test.ts`
Expected: FAIL — relation `public.analytics_export_log` does not exist yet.

- [ ] **Step 3: Add the table to `src/db/schema.ts`**

Append (the `pgTable, uuid, text, date, timestamp, index` imports already exist from Plans 01/06):

```ts
// analytics_export_log: audit of analytics CSV/PDF exports (PRD §5.6 export + §5.14 audit).
export const analyticsExportFormat = pgEnum('analytics_export_format', ['csv', 'pdf'])

export const analyticsExportLog = pgTable(
  'analytics_export_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    exportedBy: uuid('exported_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    format: analyticsExportFormat('format').notNull(),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule).
    idxOrgCreated: index('idx_analytics_export_org_created').on(t.organizationId, t.createdAt),
  }),
)
```

- [ ] **Step 4: Add types to `src/db/types.ts`**

```ts
import type { analyticsExportLog } from './schema'

export type AnalyticsExportLog = typeof analyticsExportLog.$inferSelect
export type NewAnalyticsExportLog = typeof analyticsExportLog.$inferInsert
export type AnalyticsExportFormat = AnalyticsExportLog['format']
```

- [ ] **Step 5: Generate + apply the table migration, then the RLS custom migration**

Run:
```bash
pnpm db:generate
pnpm db:migrate
pnpm db:generate --custom --name=analytics_export_log_rls
```
Expected: a table migration applies; then an empty `drizzle/00NN_analytics_export_log_rls.sql` is registered. Fill it:

```sql
-- Plan 11: RLS for analytics_export_log. Reuses Plan 01 helpers.
alter table public.analytics_export_log enable row level security;

-- Read: tenant-scoped (staff cross-client; client own org).
create policy analytics_export_select on public.analytics_export_log
  for select using (public.has_org_access(organization_id));

-- Insert: must be for an org the caller can access (staff or own-org client).
create policy analytics_export_insert on public.analytics_export_log
  for insert with check (public.has_org_access(organization_id) and exported_by = auth.uid());
```

Apply it:
```bash
pnpm db:migrate
```

- [ ] **Step 6: Run the RLS test and confirm it PASSES**

Run: `pnpm test tests/rls/analytics-export-log.test.ts`
Expected: PASS — client sees only their row; founder sees all; cross-org insert is rejected by the `with check`.

- [ ] **Step 7: PDF document `src/lib/pdf/AnalyticsReport.tsx`**

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ChannelView } from '@/lib/analytics/types'

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10 },
  h1: { fontSize: 16, marginBottom: 4 },
  meta: { color: '#666', marginBottom: 12 },
  channel: { marginBottom: 12 },
  channelTitle: { fontSize: 12, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingVertical: 2 },
  caveat: { color: '#888', fontSize: 8, marginTop: 2 },
})

function fmt(v: number, f: string): string {
  if (f === 'percent') return `${(v * 100).toFixed(1)}%`
  if (f === 'currency') return `£${v.toFixed(2)}`
  if (f === 'decimal') return v.toFixed(2)
  return Math.round(v).toLocaleString('en-GB')
}

export function AnalyticsReport({
  clientName,
  period,
  asOf,
  views,
}: {
  clientName: string
  period: { from: string; to: string }
  asOf: string | null
  views: ChannelView[]
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{clientName} — Performance</Text>
        <Text style={styles.meta}>
          {period.from} to {period.to} · as of {asOf ? new Date(asOf).toISOString().slice(0, 16).replace('T', ' ') : 'n/a'} UTC
        </Text>
        {views.map((v) => (
          <View key={v.key} style={styles.channel}>
            <Text style={styles.channelTitle}>{v.label}</Text>
            {v.empty ? (
              <Text style={styles.caveat}>No data for this channel in the selected period.</Text>
            ) : (
              v.kpis.map((k) => (
                <View key={k.key} style={styles.row}>
                  <Text>{k.label}{k.hasProvisional ? ' (provisional)' : ''}</Text>
                  <Text>
                    {fmt(k.value, k.format)}
                    {k.deltaPct != null ? `  (${k.deltaPct >= 0 ? '+' : ''}${(k.deltaPct * 100).toFixed(1)}%)` : ''}
                  </Text>
                </View>
              ))
            )}
            {v.caveats.map((c) => (
              <Text key={c} style={styles.caveat}>• {c}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  )
}
```

> If `@react-pdf/renderer` is not yet installed (it is a PRD §10/§7 dependency, typically added by the AI-report plan), run `pnpm add @react-pdf/renderer`.

- [ ] **Step 8: CSV server actions (record audit row + return CSV)**

`src/app/(portal)/performance/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { withRlsDb } from '@/db/rls'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { channelsToCsv } from '@/lib/analytics/csv'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { db } from '@/db'
import { analyticsExportLog, clients } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function exportPortalCsv(formData: FormData): Promise<{ filename: string; csv: string }> {
  const session = await getSession()
  if (!session || isStaff(session.role) || !session.orgId) redirect('/login')
  const period = parsePeriod({ from: String(formData.get('from') ?? ''), to: String(formData.get('to') ?? '') })

  const data = await withRlsDb(session.userId, (rls) => getOrgAnalytics(session.orgId!, period, rls))
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.organizationId, session.orgId))
  const csv = channelsToCsv(client?.name ?? 'Client', period, data.views)

  await db.insert(analyticsExportLog).values({
    organizationId: session.orgId,
    exportedBy: session.userId,
    format: 'csv',
    periodFrom: period.from,
    periodTo: period.to,
  })

  return { filename: `analytics-${period.from}_${period.to}.csv`, csv }
}
```

`src/app/(internal)/analytics/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { channelsToCsv } from '@/lib/analytics/csv'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { db } from '@/db'
import { analyticsExportLog, clients } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function exportStaffCsv(formData: FormData): Promise<{ filename: string; csv: string }> {
  const session = await getSession()
  if (!session || !isStaff(session.role)) redirect('/login')
  const organizationId = String(formData.get('organizationId') ?? '')
  const period = parsePeriod({ from: String(formData.get('from') ?? ''), to: String(formData.get('to') ?? '') })

  const data = await getOrgAnalytics(organizationId, period) // service-role read (staff)
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.organizationId, organizationId))
  const csv = channelsToCsv(client?.name ?? 'Client', period, data.views)

  await db.insert(analyticsExportLog).values({
    organizationId,
    exportedBy: session.userId,
    format: 'csv',
    periodFrom: period.from,
    periodTo: period.to,
  })

  return { filename: `analytics-${client?.name ?? 'client'}-${period.from}_${period.to}.csv`, csv }
}
```

- [ ] **Step 9: PDF route handlers (stream the document)**

`src/app/(portal)/performance/export/pdf/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getSession, isStaff } from '@/lib/auth'
import { withRlsDb } from '@/db/rls'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { AnalyticsReport } from '@/lib/pdf/AnalyticsReport'
import { db } from '@/db'
import { analyticsExportLog, clients } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || isStaff(session.role) || !session.orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sp = request.nextUrl.searchParams
  const period = parsePeriod({ from: sp.get('from'), to: sp.get('to') })
  const data = await withRlsDb(session.userId, (rls) => getOrgAnalytics(session.orgId!, period, rls))
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.organizationId, session.orgId))

  const buffer = await renderToBuffer(
    AnalyticsReport({ clientName: client?.name ?? 'Client', period, asOf: data.freshness.asOf, views: data.views }),
  )
  await db.insert(analyticsExportLog).values({
    organizationId: session.orgId,
    exportedBy: session.userId,
    format: 'pdf',
    periodFrom: period.from,
    periodTo: period.to,
  })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="analytics-${period.from}_${period.to}.pdf"`,
    },
  })
}
```

`src/app/(internal)/analytics/export/pdf/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getSession, isStaff } from '@/lib/auth'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { AnalyticsReport } from '@/lib/pdf/AnalyticsReport'
import { db } from '@/db'
import { analyticsExportLog, clients } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || !isStaff(session.role)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sp = request.nextUrl.searchParams
  const organizationId = sp.get('organizationId') ?? ''
  const period = parsePeriod({ from: sp.get('from'), to: sp.get('to') })
  const data = await getOrgAnalytics(organizationId, period)
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.organizationId, organizationId))

  const buffer = await renderToBuffer(
    AnalyticsReport({ clientName: client?.name ?? 'Client', period, asOf: data.freshness.asOf, views: data.views }),
  )
  await db.insert(analyticsExportLog).values({
    organizationId,
    exportedBy: session.userId,
    format: 'pdf',
    periodFrom: period.from,
    periodTo: period.to,
  })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="analytics-${period.from}_${period.to}.pdf"`,
    },
  })
}
```

- [ ] **Step 10: `ExportButtons.tsx` (client component; CSV via action download, PDF via route link)**

```tsx
'use client'
import { Button } from '@/components/ui/button'
import { exportPortalCsv } from '@/app/(portal)/performance/actions'
import { exportStaffCsv } from '@/app/(internal)/analytics/actions'

export function ExportButtons({
  surface,
  from,
  to,
  organizationId,
}: {
  surface: 'portal' | 'internal'
  from: string
  to: string
  organizationId?: string
}) {
  async function downloadCsv() {
    const fd = new FormData()
    fd.set('from', from)
    fd.set('to', to)
    if (organizationId) fd.set('organizationId', organizationId)
    const { filename, csv } = surface === 'portal' ? await exportPortalCsv(fd) : await exportStaffCsv(fd)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const pdfBase = surface === 'portal' ? '/performance/export/pdf' : '/analytics/export/pdf'
  const pdfHref = `${pdfBase}?from=${from}&to=${to}${organizationId ? `&organizationId=${organizationId}` : ''}`

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={downloadCsv}>
        Export CSV
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={pdfHref}>Export PDF</a>
      </Button>
    </div>
  )
}
```

- [ ] **Step 11: Build + full test run**

Run: `pnpm build && pnpm test tests/analytics tests/rls/analytics-export-log.test.ts`
Expected: build clean; all analytics + export-log RLS tests pass.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(analytics): CSV/PDF export + analytics_export_log table with RLS (tests pass)"
```

---

## Task 8: Cross-client overview page + per-client staff drilldown

**Files:**
- Create: `src/components/analytics/OverviewTable.tsx`
- Create: `src/app/(internal)/analytics/page.tsx`
- Create: `src/app/(internal)/analytics/[clientId]/page.tsx`

- [ ] **Step 1: `OverviewTable.tsx` (sortable, client component)**

```tsx
'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sparkline } from './Sparkline'
import { OVERVIEW_KPIS } from '@/lib/analytics/channels'
import type { OverviewRow } from '@/lib/analytics/types'

function formatKpi(format: string, value: number): string {
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'currency') return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
  if (format === 'decimal') return value.toFixed(2)
  return Math.round(value).toLocaleString('en-GB')
}

export function OverviewTable({ rows }: { rows: OverviewRow[] }) {
  const [sortKey, setSortKey] = useState<string>('name')
  const [dir, setDir] = useState<1 | -1>(1)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      if (sortKey === 'name') return a.clientName.localeCompare(b.clientName) * dir
      const av = a.kpis[sortKey]?.value ?? 0
      const bv = b.kpis[sortKey]?.value ?? 0
      return (av - bv) * dir
    })
    return copy
  }, [rows, sortKey, dir])

  function sortBy(key: string) {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setDir(1)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead onClick={() => sortBy('name')} className="cursor-pointer">Client</TableHead>
          {OVERVIEW_KPIS.map((k) => (
            <TableHead key={`${k.channel}.${k.kpi}`} onClick={() => sortBy(`${k.channel}.${k.kpi}`)} className="cursor-pointer">
              {k.label}
            </TableHead>
          ))}
          <TableHead>Traffic trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.clientId}>
            <TableCell>
              <Link href={`/analytics/${r.clientId}`} className="font-medium underline">
                {r.clientName}
              </Link>
            </TableCell>
            {OVERVIEW_KPIS.map((k) => {
              const cell = r.kpis[`${k.channel}.${k.kpi}`]
              return (
                <TableCell key={`${r.clientId}-${k.channel}.${k.kpi}`}>
                  <div>{cell ? formatKpi(cell.format, cell.value) : '—'}</div>
                  {cell?.deltaPct != null && (
                    <div className={`text-[11px] ${cell.deltaPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {cell.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(cell.deltaPct * 100).toFixed(0)}%
                    </div>
                  )}
                </TableCell>
              )
            })}
            <TableCell>
              <Sparkline data={r.spark} />
            </TableCell>
          </TableRow>
        ))}
        {sorted.length === 0 && (
          <TableRow>
            <TableCell colSpan={OVERVIEW_KPIS.length + 2} className="text-muted-foreground">
              No clients yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 2: Cross-client overview page `src/app/(internal)/analytics/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { getCrossClientOverview } from '@/lib/analytics/queries'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { OverviewTable } from '@/components/analytics/OverviewTable'
import { DateRangeSelector } from '@/components/analytics/DateRangeSelector'

export const dynamic = 'force-dynamic'

export default async function AnalyticsOverview({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')

  const sp = await searchParams
  const period = parsePeriod({ from: sp.from, to: sp.to })
  const rows = await getCrossClientOverview(period)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Analytics — all clients</h1>
        <DateRangeSelector from={period.from} to={period.to} />
      </div>
      <p className="text-xs text-muted-foreground">
        All figures read from the metrics store (synced nightly). Recent days may be provisional.
      </p>
      <OverviewTable rows={rows} />
    </div>
  )
}
```

- [ ] **Step 3: Per-client staff drilldown `src/app/(internal)/analytics/[clientId]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getOrgAnalytics } from '@/lib/analytics/queries'
import { parsePeriod } from '@/lib/analytics/dateRange'
import { ChannelDashboard } from '@/components/analytics/ChannelDashboard'
import { DateRangeSelector } from '@/components/analytics/DateRangeSelector'
import { ExportButtons } from '@/components/analytics/ExportButtons'

export const dynamic = 'force-dynamic'

export default async function ClientAnalytics({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')

  const { clientId } = await params
  const [client] = await db
    .select({ name: clients.name, organizationId: clients.organizationId })
    .from(clients)
    .where(eq(clients.id, clientId))
  if (!client) notFound()

  const sp = await searchParams
  const period = parsePeriod({ from: sp.from, to: sp.to })
  const data = await getOrgAnalytics(client.organizationId, period)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{client.name} — Analytics</h1>
        <div className="flex items-center gap-3">
          <DateRangeSelector from={period.from} to={period.to} />
          <ExportButtons surface="internal" from={period.from} to={period.to} organizationId={client.organizationId} />
        </div>
      </div>
      <ChannelDashboard data={data} />
    </div>
  )
}
```

- [ ] **Step 4: Wire the "Analytics" nav link (Plan 01 internal shell already lists "Analytics" as static text)**

In `src/app/(internal)/layout.tsx`: add `import Link from 'next/link'` at the top of the file, then replace the existing static nav entry `<span>Analytics</span>` with a link. Concretely, change the nav block from:
```tsx
          <span>Cockpit</span><span>Tasks</span><span>Pipeline</span>
          <span>Clients</span><span>Analytics</span><span>Finance</span>
```
to:
```tsx
          <span>Cockpit</span><span>Tasks</span><span>Pipeline</span>
          <span>Clients</span><Link href="/analytics">Analytics</Link><span>Finance</span>
```
Leave the other nav items as static text; later plans wire theirs.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm db:seed` then `pnpm dev`, and (optionally) seed a few `metric_daily` rows via psql for a client org. Then:
1. Sign in as `founder@milktreeagency.com` → open `/analytics` → the cross-client table renders, columns sort on click, client names link to `/analytics/<id>`.
2. Open a client drilldown → channel tabs render KPI cards + chart; "as of" badge + provisional note show; "verify in platform" links open the right platform; Export CSV downloads, Export PDF opens a PDF.
3. Sign in as `user1@clientone.com` → `/analytics` redirects to `/overview`; `/performance` shows only that client's channels.

Expected: all behave as described.

- [ ] **Step 6: Build + commit**

```bash
pnpm build
git add -A
git commit -m "feat(analytics): cross-client overview table + per-client staff drilldown + nav link"
```

---

## Task 9: Final verification — full suite + spec gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm lint && pnpm test`
Expected: lint clean; ALL tests pass, including:
- `tests/analytics/channels.test.ts`, `tests/analytics/dateRange.test.ts`, `tests/analytics/aggregate.test.ts` (pure-lib correctness),
- `tests/analytics/traces-to-store.test.ts` (KEYSTONE: KPIs trace to stored rows + portal own-org isolation),
- `tests/rls/analytics-export-log.test.ts` (KEYSTONE: new tenant table isolation),
- plus all prior plans' RLS isolation tests remain green.

- [ ] **Step 2: Confirm no external API calls on render (PRD §6.1/§11)**

Grep the analytics surface for any forbidden network client; expect zero matches:
```bash
grep -REn "googleapis|graph.facebook|fetch\(|axios|GoogleAdsApi|BetaAnalyticsDataClient" src/lib/analytics src/app/\(internal\)/analytics src/app/\(portal\)/performance src/components/analytics || echo "OK: no external API calls on the analytics path"
```
Expected: prints `OK: no external API calls on the analytics path` (the only data source is `metric_daily`/`metric_monthly_rollup`/`connection` via Drizzle).

- [ ] **Step 3: Commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore(analytics): final lint + verification gate" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (vs PRD §5.6 Client Analytics Aggregator, §6.5 Data-trust rules, §8 Data Model):**
- **Reads ONLY from the metrics store, never live APIs** (§5.6 / §6.1 / §11) → `src/lib/analytics/queries.ts` reads `metric_daily` / `metric_monthly_rollup` / `connection` only; Task 9 Step 2 greps to prove zero external clients on the path. ✅
- **Cross-client overview (internal): sortable table, headline KPIs, MoM deltas, sparklines** (§5.6) → `getCrossClientOverview` + `OverviewTable` (click-to-sort, delta arrows, `Sparkline`). ✅
- **Per-client channel dashboards: Website/Search/Google Ads/Meta/Local/Leads** (§5.6) → `CHANNEL_ORDER` + `CHANNELS` registry + `ChannelDashboard` tabs; metric/entity names match Plans 07 (`sessions`,`users`,`newUsers`,`engagementRate`,`keyEvents`; `clicks`,`impressions`,`ctr`,`position`), 08 (`spend`,`impressions`,`clicks`,`conversions`,`conversions_value`,`leads`; CPA/ROAS/CPL derived), 09 (`impressions_total`,`call_clicks`,`direction_requests`,`website_clicks`,`conversations`). ✅
- **Reused in the client portal, RLS-scoped** (§5.6 / §9) → `(portal)/performance/page.tsx` reuses `ChannelDashboard` + `getOrgAnalytics` via the RLS-bound `withRlsDb`; KEYSTONE `traces-to-store.test.ts` proves own-org-only under RLS (client-two's 999 never leaks). ✅
- **"as of" timestamps + last-3-days provisional + data-quality footnotes** (§6.5) → `computeFreshness` (from `connection.lastSuccessAt`, 24h SLA), `AsOfBadge` (provisional-days note), `is_provisional` propagated through `aggregate.ts` to `hasProvisional`/series flags, `CaveatFootnotes` per channel. ✅
- **Date-range selector** (§5.6) → `DateRangeSelector` (updates `?from&to`); `parsePeriod`/`previousPeriod` drive MoM. ✅
- **CSV/PDF export** (§5.6) → `csv.ts` + CSV server actions; `AnalyticsReport.tsx` + PDF route handlers (`@react-pdf/renderer`, the PRD §10/§7 choice). ✅
- **"verify in platform" deep links** (§6.5) → `VerifyInPlatformLink` + per-channel `verifyUrl(ctx.accountId)`. ✅
- **Every KPI traces to a stored, dated row** (§5.6 acceptance) → KEYSTONE `traces-to-store.test.ts` asserts KPI value == sum of seeded `metric_daily` rows and series total matches. ✅
- **New tenant-scoped table gets RLS + isolation test** (shared conventions / §9) → `analytics_export_log` with `organization_id`-leading index, RLS reusing `public.has_org_access`, written-first failing test `tests/rls/analytics-export-log.test.ts`. ✅
- **No-cache on tenant data** (§9 caching safety) → `export const dynamic = 'force-dynamic'` on every analytics page. ✅
- **`service_role` never user-facing** (§9) → staff pages use the server-only Drizzle `db` (which connects with the configured DB role for app reads and is guarded staff-only at the page layer); portal pages use the authenticated-role `withRlsDb`. The cross-client overview is app-scoped and page-guarded to staff. ✅

**Out of scope for this plan (correctly deferred):** running the syncs / connectors (Plans 06–09 own writing `metric_daily`); the Leads ingestion pipeline (Plan 10 — this plan only *reads* a `provider='leads'` daily series and renders empty if absent); the AI monthly report (PRD §7, separate plan); optional Looker Studio embeds (PRD §5.6, Phase 3). ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. The two environment notes (install `@react-pdf/renderer` if absent; reuse an existing RLS-db helper if one exists) are explicit setup instructions, not code placeholders. ✅

**Type consistency:** `ChannelKey`/`KpiDef`/`ChannelKpi`/`DailyPoint`/`ChannelView`/`OverviewRow`/`Freshness`/`MetricRow` from `src/lib/analytics/types.ts` are used uniformly across `channels.ts`, `aggregate.ts`, `queries.ts`, `freshness.ts`, `csv.ts`, the components, and the PDF doc. `OrgAnalytics` is the single shared shape between `queries.ts`, `ChannelDashboard`, and the export paths. `metric_daily` numeric `value` (returned as string by postgres.js) is coerced via `Number(...)` in `toRow`. Provider-tag drift `meta`/`meta_ads` is centralized in `META_PROVIDERS` and exercised by `channels.test.ts` + `aggregate.test.ts`. `analytics_export_log` enum `analytics_export_format` values `csv|pdf` are consistent across schema, migration, actions, and routes. ✅

**Definition of done for Plan 11:** `pnpm lint && pnpm test` green (all analytics unit tests + the two KEYSTONE tests + prior RLS suites), the Task 9 grep prints the no-external-API confirmation, and the Task 8 manual smoke test behaves correctly for a staff user (cross-client + drilldown + export) and a client user (own-org-only Performance).
