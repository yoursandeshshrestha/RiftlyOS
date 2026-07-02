# Agency OS — Plan 19: Founder Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Founder/exec home screen (PRD §5.1) at `src/app/(internal)/cockpit/page.tsx`, replacing Plan 01's placeholder. It surfaces business health on one screen: KPI cards (Active clients, MRR, New deals value / open pipeline, Leads MTD across all clients, Outstanding invoices £ + count, Renewals due in the next 30/60 days, At-risk accounts), a revenue-vs-target gauge (MRR + recognised one-off income vs a configurable `revenue_target`) rendered with Recharts, and a time-range selector. The centerpiece is a **rule-based at-risk engine** implemented as a **pure, unit-tested** function (rules: no activity in N days, falling key metric, overdue invoice, renewal < 30 days, broken data connection) that returns **which rule(s) fired** so the UI can explain each flag on hover. **Every figure is read from already-stored tables** (`client`, `deal`, `invoice`, `subscription`, `revenue_target`, `lead`, `metric_daily`, `connection`) — never live external APIs (PRD §11). Team members get a reduced version (no finance edit). The cockpit is **progressively enhanced**: a basic version works after Plan 04 (finance) and gains the leads/metrics cards once Plans 10/11 exist — each card is gated on data availability.

**Architecture:** A read-only presentation + aggregation layer over the agency's data plane (PRD §6.1 Plane A). All reads come from our Postgres store via Drizzle; the page issues no external API calls on render (PRD §11) and is `export const dynamic = 'force-dynamic'` so tenant data is never statically cached (PRD §9). A new data-access library `src/lib/cockpit/*` holds: (a) pure, framework-free aggregation/at-risk functions (`atRisk.ts`, `range.ts`) that are exhaustively unit-tested; and (b) thin DB query functions (`queries.ts`) that read the canonical tables. KPI aggregation reuses the Plan 04 finance metrics (`getMrr`, `getOutstanding`, `getRecognisedRevenue`, `getRevenueTarget`) and the Plan 11 analytics queries where present, and **falls back gracefully** when a later-plan table is empty (the leads/metrics cards render a "not yet available" state instead of crashing). The cockpit is staff-only via the Plan 01 `(internal)` layout guard; the **reduced Team view** hides finance edit affordances (the cockpit is read-only for everyone, but the "Set revenue target" control is Founder-only). One new tenant-scoped table — `cockpit_setting` (agency-org-scoped, staff-only) — stores the configurable at-risk thresholds and the default time range; it carries `organization_id` as the leading column of a composite index and reuses the Plan 01 RLS helpers, with its own RLS isolation test.

**Tech Stack:** Next.js 16 (App Router, TS strict) · Drizzle ORM + postgres.js (read existing `client`/`deal`/`invoice`/`subscription`/`revenue_target`/`lead`/`metric_daily`/`connection` tables) · Supabase Postgres + RLS (Plan 01 helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`) · Tailwind + shadcn/ui (`card`, `badge`, `select`, `tooltip`, `button`) · **Recharts** (already present from Plans 02/04) · Vitest (pure at-risk + range unit tests, query integration test, RLS isolation test) using the Plan 01 harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`, `sql`).

**Dependencies (assume built; do NOT re-spec):**
- **Plan 01** — tenancy (`organizations`, `profiles`, `memberships`), RLS helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`, custom-access-token hook, `src/lib/auth.ts` (`getSession()`, `isStaff()`), the `(internal)` shell + role guard, and the test harness `tests/helpers/db.ts`.
- **Plan 1.5 (Shared Platform Services)** — `src/lib/audit/record.ts` exporting `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })`; the `audit_event` table.
- **Plan 02** — `client` (`organizationId`, `name`, `health`, `renewalDate`, `accountManagerId`), `deal`, `deal_stage` (`isWon`/`isLost`/`probability`), `deal_activity`.
- **Plan 04** — `customer`, `invoice`, `subscription`, `revenue_target` (table `revenue_targets`), and `src/lib/finance/metrics.ts` (`getMrr`, `getOutstanding`, `getRecognisedRevenue`, `getRevenueTarget`) + `src/lib/finance/money.ts` (`formatMoney`).
- **Plan 06/11** — `connection` (`status`, `lastSuccessAt`, `lastError`), `metric_daily` (`provider`, `metric`, `date`, `value`, `isProvisional`); `src/lib/integrations/health.ts` `evaluateHealth()`.
- **Plan 10** — `lead` (`organizationId`, `occurredAt`, `source`, `isSpam`), `lead_definition` (`countedSources`, `includeSpam`).

> **Progressive enhancement contract:** Plans 10/11 land later than Plan 04. This plan must build and pass its tests when only `client`/`deal`/`invoice`/`subscription`/`revenue_target`/`connection` carry data and `lead`/`metric_daily` are empty. Each card therefore consults a small "data availability" probe (`isCardAvailable`) and renders a neutral "No data yet" tile rather than a zero or an error when its source table is empty. The `lead`/`metric_daily`/`connection` tables themselves are assumed to exist in the schema (they are created by Plans 06/10); only their *rows* may be absent.

---

## File Structure (created / modified by this plan)

```
.
├─ src/
│  ├─ app/
│  │  └─ (internal)/
│  │     └─ cockpit/
│  │        ├─ page.tsx                       # REPLACE Plan 01 placeholder — the cockpit
│  │        └─ actions.ts                     # Founder-only: set revenue target (audited)
│  ├─ components/
│  │  └─ cockpit/
│  │     ├─ kpi-card.tsx                      # generic KPI tile (value / sublabel / unavailable state)
│  │     ├─ revenue-gauge.tsx                 # Recharts radial gauge (MRR + one-off vs target)
│  │     ├─ time-range-select.tsx             # client time-range selector (updates ?range=)
│  │     ├─ at-risk-list.tsx                  # at-risk accounts with per-flag hover explanation
│  │     └─ set-target-dialog.tsx             # Founder-only revenue-target editor
│  ├─ db/
│  │  ├─ schema.ts                            # MODIFY: add cockpit_setting table + enum
│  │  └─ types.ts                             # MODIFY: add CockpitSetting types
│  └─ lib/
│     └─ cockpit/
│        ├─ range.ts                          # pure: parse time range -> {from,to,prev,label}
│        ├─ atRisk.ts                         # pure: at-risk rule engine (which rules fired)
│        └─ queries.ts                        # DB reads (KPIs + at-risk inputs), no external APIs
├─ drizzle/
│  └─ 19xx_cockpit_setting.sql               # generated + custom RLS migration
└─ tests/
   ├─ cockpit/range.test.ts                   # pure range unit tests
   ├─ cockpit/atRisk.test.ts                  # KEYSTONE: pure at-risk engine unit tests
   ├─ cockpit/queries.test.ts                 # query integration test (reads stored rows only)
   └─ rls/cockpit-setting.isolation.test.ts   # RLS isolation for the new tenant table
```

---

## Task 1: Add the `cockpit_setting` table (configurable at-risk thresholds + default range)

The cockpit reads existing tables for all KPIs, but the at-risk rule thresholds (the "N days" of no activity, the falling-metric percentage, the renewal-window days) and the default time range must be **configurable** (PRD §5.1: "Configurable monthly revenue target"; "no activity N days" implies a tunable N). We store these once per **agency** org in a new `cockpit_setting` table. It is tenant-scoped (carries `organization_id`), staff-only, and follows the Plan 01 RLS rules.

**Files:**
- Modify: `src/db/schema.ts`, `src/db/types.ts`
- Create: `drizzle/19xx_cockpit_setting.sql` (generated)

- [ ] **Step 1: Append the table to `src/db/schema.ts`**

The imports `pgTable, uuid, text, integer, timestamp, jsonb, index, unique` already exist from Plans 01/02/06. Append at the **bottom** of `src/db/schema.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Plan 19 — Founder Cockpit
// ─────────────────────────────────────────────────────────────────────────────

// cockpit_setting: one row per agency org. Holds the configurable at-risk rule
// thresholds and the default cockpit time range. Staff-only (PRD §5.1).
export const cockpitSettings = pgTable(
  'cockpit_setting',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // "no activity in N days" threshold for the at-risk engine.
    noActivityDays: integer('no_activity_days').notNull().default(14),
    // a key metric dropping by >= this fraction (0..1) vs the previous period fires.
    fallingMetricPct: integer('falling_metric_pct').notNull().default(25), // percent
    // renewal-within-N-days threshold (PRD §5.1 uses < 30).
    renewalSoonDays: integer('renewal_soon_days').notNull().default(30),
    // default time range key for the cockpit ('mtd' | '30d' | '60d' | '90d').
    defaultRange: text('default_range').notNull().default('mtd'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule).
    idxOrg: index('idx_cockpit_setting_org').on(t.organizationId, t.id),
    // one settings row per agency org.
    uniqOrg: unique('uniq_cockpit_setting_org').on(t.organizationId),
  }),
)
```

- [ ] **Step 2: Add inferred types to `src/db/types.ts`**

Append:

```ts
import type { cockpitSettings } from './schema'

export type CockpitSetting = typeof cockpitSettings.$inferSelect
export type NewCockpitSetting = typeof cockpitSettings.$inferInsert
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/19xx_cockpit_setting.sql` is created containing the `cockpit_setting` table with its unique constraint and composite index.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Then verify:
```bash
psql "$DATABASE_URL" -c "\dt public.cockpit_setting"
```
Expected: `cockpit_setting` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): cockpit_setting table (configurable at-risk thresholds + default range)"
```

---

## Task 2: KEYSTONE — RLS isolation test for `cockpit_setting`, then enable RLS

`cockpit_setting` is a new tenant-scoped table. Per shared conventions every new tenant table needs an RLS isolation test using the Plan 01 harness. It is **staff-only** (clients never see cockpit settings). RLS is not enabled yet, so the test FAILS first; Step 3 enables RLS to make it PASS.

**Files:**
- Create: `tests/rls/cockpit-setting.isolation.test.ts`
- Create: `drizzle/19xx_cockpit_setting_rls.sql` (custom SQL)

- [ ] **Step 1: Write the failing isolation test `tests/rls/cockpit-setting.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): cockpit_setting (staff-only)', () => {
  let founder: string
  let clientOneUser: string
  let agencyOrg: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const [org] = await sql`select id from public.organizations where slug = 'milktree'`
    agencyOrg = org!.id as string
    // Seed a settings row for the agency org (service-role bypasses RLS in tests).
    await sql`
      insert into public.cockpit_setting (organization_id)
      values (${agencyOrg})
      on conflict (organization_id) do nothing
    `
  })

  afterAll(async () => {
    await sql`delete from public.cockpit_setting where organization_id = ${agencyOrg}`
    await sql.end()
  })

  it('agency staff (founder) can read cockpit_setting', async () => {
    const rows = await asUser(founder, (tx) => tx`select id from public.cockpit_setting`)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('a client user sees NO cockpit_setting rows', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select id from public.cockpit_setting`)
    expect(rows.length).toBe(0)
  })

  it('a client user cannot insert a cockpit_setting row', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.cockpit_setting (organization_id) values (${agencyOrg})`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/rls/cockpit-setting.isolation.test.ts`
Expected: FAIL — RLS is not enabled, so the client user reads/inserts the row. This proves the test is real.

- [ ] **Step 3: Create and fill the RLS migration**

Run: `pnpm db:generate --custom --name=cockpit_setting_rls`
Then fill the new `drizzle/19xx_cockpit_setting_rls.sql`:

```sql
-- cockpit_setting is staff-only (PRD §5.1: Founder home; Team get a reduced view).
-- Reuse the Plan 01 helper public.is_agency_staff(). Clients get zero rows.
alter table public.cockpit_setting enable row level security;

create policy cockpit_setting_select on public.cockpit_setting
  for select using (public.is_agency_staff());

create policy cockpit_setting_insert on public.cockpit_setting
  for insert with check (public.is_agency_staff());

create policy cockpit_setting_update on public.cockpit_setting
  for update using (public.is_agency_staff()) with check (public.is_agency_staff());

create policy cockpit_setting_delete on public.cockpit_setting
  for delete using (public.is_agency_staff());
```

- [ ] **Step 4: Apply and re-run the test → PASS**

Run:
```bash
pnpm db:migrate
pnpm test tests/rls/cockpit-setting.isolation.test.ts
```
Expected: all three assertions PASS — the founder reads the row; the client sees none and cannot insert.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): RLS isolation for cockpit_setting (staff-only; tests pass)"
```

---

## Task 3: Pure time-range library (`src/lib/cockpit/range.ts`)

The time-range selector drives the gauge (recognised one-off income period) and the leads/metrics cards. This is a **pure** function (no DB, no `Date.now()` leakage — `now` is injectable) so it is trivially unit-tested. Ranges: `mtd` (month-to-date), `30d`, `60d`, `90d`. We also compute the equal-length **previous** period for MoM-style deltas used by the at-risk falling-metric rule.

**Files:**
- Create: `tests/cockpit/range.test.ts`, `src/lib/cockpit/range.ts`

- [ ] **Step 1: Write the failing test `tests/cockpit/range.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveRange, type RangeKey } from '@/lib/cockpit/range'

const now = new Date('2026-06-29T10:00:00.000Z')

describe('resolveRange (pure)', () => {
  it('mtd spans the first of the month to now', () => {
    const r = resolveRange('mtd', now)
    expect(r.from).toBe('2026-06-01')
    expect(r.to).toBe('2026-06-29')
    expect(r.label).toBe('Month to date')
  })

  it('30d is a 30-day trailing window ending today (inclusive)', () => {
    const r = resolveRange('30d', now)
    expect(r.to).toBe('2026-06-29')
    expect(r.from).toBe('2026-05-31') // 30 days inclusive
    expect(r.label).toBe('Last 30 days')
  })

  it('computes an equal-length previous period for deltas', () => {
    const r = resolveRange('30d', now)
    // previous window is the 30 days immediately before `from`
    expect(r.prevTo).toBe('2026-05-30')
    expect(r.prevFrom).toBe('2026-05-01')
  })

  it('60d and 90d windows are sized correctly', () => {
    expect(resolveRange('60d', now).from).toBe('2026-05-01')
    expect(resolveRange('90d', now).from).toBe('2026-04-01')
  })

  it('falls back to mtd for an unknown key', () => {
    const r = resolveRange('bogus' as RangeKey, now)
    expect(r.key).toBe('mtd')
  })

  it('exposes Date objects for callers that need them (UTC midnight bounds)', () => {
    const r = resolveRange('mtd', now)
    expect(r.fromDate.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    // toDateExclusive is the day AFTER `to`, for half-open [from, toExclusive) queries
    expect(r.toDateExclusive.toISOString()).toBe('2026-06-30T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/cockpit/range.test.ts`
Expected: FAIL — `@/lib/cockpit/range` not found.

- [ ] **Step 3: Implement `src/lib/cockpit/range.ts`**

```ts
export const RANGE_KEYS = ['mtd', '30d', '60d', '90d'] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

export interface ResolvedRange {
  key: RangeKey
  label: string
  /** inclusive yyyy-mm-dd bounds (UTC) */
  from: string
  to: string
  /** equal-length previous period (inclusive yyyy-mm-dd) */
  prevFrom: string
  prevTo: string
  /** Date helpers (UTC midnight). toDateExclusive = day after `to`. */
  fromDate: Date
  toDateExclusive: Date
}

const LABELS: Record<RangeKey, string> = {
  mtd: 'Month to date',
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

/** Normalise an arbitrary string to a known RangeKey (default 'mtd'). */
export function asRangeKey(value: string | null | undefined): RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(value ?? '')
    ? (value as RangeKey)
    : 'mtd'
}

/**
 * Pure: resolve a range key into inclusive yyyy-mm-dd bounds plus an
 * equal-length previous period. `now` is injectable for testing.
 */
export function resolveRange(rawKey: RangeKey, now: Date = new Date()): ResolvedRange {
  const key = asRangeKey(rawKey)
  const today = utcMidnight(now)

  let fromDate: Date
  if (key === 'mtd') {
    fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  } else {
    const span = key === '30d' ? 30 : key === '60d' ? 60 : 90
    fromDate = addDays(today, -(span - 1)) // inclusive trailing window
  }

  const to = ymd(today)
  const from = ymd(fromDate)

  // equal-length previous period immediately before `from`
  const lengthDays = Math.round((today.getTime() - fromDate.getTime()) / 86_400_000) + 1
  const prevTo = ymd(addDays(fromDate, -1))
  const prevFrom = ymd(addDays(fromDate, -lengthDays))

  return {
    key,
    label: LABELS[key],
    from,
    to,
    prevFrom,
    prevTo,
    fromDate,
    toDateExclusive: addDays(today, 1),
  }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/cockpit/range.test.ts`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cockpit): pure time-range resolver (mtd/30d/60d/90d + prev period)"
```

---

## Task 4: KEYSTONE — the pure, unit-tested at-risk rule engine (`src/lib/cockpit/atRisk.ts`)

This is the core deliverable of PRD §5.1: "At-risk = rule-based flag" and "At-risk list is explainable (hover shows which rule fired)." The engine is a **pure function** over already-fetched inputs (no DB, no external APIs). It evaluates five rules and returns, per client, **which rules fired** with a human-readable reason for each — so the UI can show them on hover. We write the tests first.

The five rules (PRD §5.1):
1. **No activity in N days** — most recent activity timestamp older than `noActivityDays`.
2. **Falling key metric** — the client's headline metric dropped by ≥ `fallingMetricPct`% vs the previous equal-length period.
3. **Overdue invoice** — at least one invoice in `past_due` (or open + past due date).
4. **Renewal < 30 days** — `renewalDate` within `renewalSoonDays` (and not already past).
5. **Broken data connection** — any connection evaluates to `error`/`expired` health (reuses Plan 06 `evaluateHealth`).

**Files:**
- Create: `tests/cockpit/atRisk.test.ts`, `src/lib/cockpit/atRisk.ts`

- [ ] **Step 1: Write the failing test `tests/cockpit/atRisk.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  evaluateAtRisk,
  type AtRiskInput,
  type AtRiskThresholds,
  type AtRiskRule,
} from '@/lib/cockpit/atRisk'

const now = new Date('2026-06-29T00:00:00.000Z')

const thresholds: AtRiskThresholds = {
  noActivityDays: 14,
  fallingMetricPct: 25,
  renewalSoonDays: 30,
}

function base(overrides: Partial<AtRiskInput> = {}): AtRiskInput {
  return {
    clientId: 'c1',
    clientName: 'Client One',
    lastActivityAt: new Date('2026-06-28T00:00:00.000Z'), // 1 day ago — fresh
    headlineMetricCurrent: 100,
    headlineMetricPrevious: 100, // flat
    hasOverdueInvoice: false,
    renewalDate: null,
    connections: [], // no broken connections
    ...overrides,
  }
}

function rulesOf(input: AtRiskInput): AtRiskRule[] {
  return evaluateAtRisk(input, thresholds, now).firedRules.map((r) => r.rule)
}

describe('evaluateAtRisk (pure)', () => {
  it('a healthy client fires no rules and is not at risk', () => {
    const res = evaluateAtRisk(base(), thresholds, now)
    expect(res.atRisk).toBe(false)
    expect(res.firedRules).toEqual([])
  })

  it('fires no_activity when last activity is older than N days', () => {
    const res = evaluateAtRisk(
      base({ lastActivityAt: new Date('2026-06-10T00:00:00.000Z') }), // 19 days ago
      thresholds,
      now,
    )
    expect(res.atRisk).toBe(true)
    expect(rulesOf(base({ lastActivityAt: new Date('2026-06-10T00:00:00.000Z') }))).toContain(
      'no_activity',
    )
    expect(res.firedRules[0]!.reason).toMatch(/19 days/)
  })

  it('treats a null lastActivityAt as no_activity', () => {
    expect(rulesOf(base({ lastActivityAt: null }))).toContain('no_activity')
  })

  it('fires falling_metric when the headline metric drops >= threshold', () => {
    // 100 -> 70 is a 30% drop, >= 25% threshold.
    expect(rulesOf(base({ headlineMetricCurrent: 70, headlineMetricPrevious: 100 }))).toContain(
      'falling_metric',
    )
  })

  it('does NOT fire falling_metric for a small dip below threshold', () => {
    // 100 -> 90 is a 10% drop, < 25%.
    expect(rulesOf(base({ headlineMetricCurrent: 90, headlineMetricPrevious: 100 }))).not.toContain(
      'falling_metric',
    )
  })

  it('does NOT fire falling_metric when there is no previous baseline (avoids false positives)', () => {
    expect(
      rulesOf(base({ headlineMetricCurrent: 0, headlineMetricPrevious: 0 })),
    ).not.toContain('falling_metric')
    expect(
      rulesOf(base({ headlineMetricCurrent: null, headlineMetricPrevious: null })),
    ).not.toContain('falling_metric')
  })

  it('fires overdue_invoice when there is an overdue invoice', () => {
    expect(rulesOf(base({ hasOverdueInvoice: true }))).toContain('overdue_invoice')
  })

  it('fires renewal_soon when the renewal is within N days', () => {
    expect(rulesOf(base({ renewalDate: '2026-07-10' }))).toContain('renewal_soon') // 11 days out
  })

  it('does NOT fire renewal_soon for a renewal far in the future', () => {
    expect(rulesOf(base({ renewalDate: '2026-12-01' }))).not.toContain('renewal_soon')
  })

  it('fires renewal_soon for an already-overdue renewal (past date)', () => {
    expect(rulesOf(base({ renewalDate: '2026-06-01' }))).toContain('renewal_soon')
  })

  it('fires broken_connection when any connection is error/expired', () => {
    const res = evaluateAtRisk(
      base({
        connections: [
          { provider: 'ga4', status: 'connected', lastSuccessAt: now, lastError: null },
          { provider: 'meta_ads', status: 'error', lastSuccessAt: null, lastError: 'invalid_grant' },
        ],
      }),
      thresholds,
      now,
    )
    expect(res.atRisk).toBe(true)
    const broken = res.firedRules.find((r) => r.rule === 'broken_connection')
    expect(broken).toBeDefined()
    expect(broken!.reason).toMatch(/meta_ads/)
  })

  it('does NOT fire broken_connection for healthy connections', () => {
    expect(
      rulesOf(
        base({
          connections: [
            { provider: 'ga4', status: 'connected', lastSuccessAt: now, lastError: null },
          ],
        }),
      ),
    ).not.toContain('broken_connection')
  })

  it('accumulates MULTIPLE fired rules and stays explainable', () => {
    const res = evaluateAtRisk(
      base({
        lastActivityAt: null,
        hasOverdueInvoice: true,
        renewalDate: '2026-07-05',
      }),
      thresholds,
      now,
    )
    const set = res.firedRules.map((r) => r.rule)
    expect(set).toEqual(
      expect.arrayContaining(['no_activity', 'overdue_invoice', 'renewal_soon']),
    )
    // every fired rule carries a non-empty human reason for the hover tooltip
    expect(res.firedRules.every((r) => r.reason.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/cockpit/atRisk.test.ts`
Expected: FAIL — `@/lib/cockpit/atRisk` not found.

- [ ] **Step 3: Implement `src/lib/cockpit/atRisk.ts`**

```ts
import { evaluateHealth } from '@/lib/integrations/health'
import type { ConnectionStatus } from '@/db/types'

export type AtRiskRule =
  | 'no_activity'
  | 'falling_metric'
  | 'overdue_invoice'
  | 'renewal_soon'
  | 'broken_connection'

export interface FiredRule {
  rule: AtRiskRule
  /** human-readable explanation shown on hover (PRD §5.1). */
  reason: string
}

export interface AtRiskThresholds {
  noActivityDays: number
  /** percent (e.g. 25 = 25%) drop vs previous period that fires falling_metric. */
  fallingMetricPct: number
  renewalSoonDays: number
}

export interface AtRiskConnection {
  provider: string
  status: ConnectionStatus
  lastSuccessAt: Date | null
  lastError: string | null
}

export interface AtRiskInput {
  clientId: string
  clientName: string
  /** most recent activity across the client (task/deal/lead/metric); null = none. */
  lastActivityAt: Date | null
  /** headline metric for the current period (e.g. leads or sessions); null = unknown. */
  headlineMetricCurrent: number | null
  /** same metric for the previous equal-length period; null/0 = no baseline. */
  headlineMetricPrevious: number | null
  hasOverdueInvoice: boolean
  /** yyyy-mm-dd renewal date or null. */
  renewalDate: string | null
  connections: AtRiskConnection[]
}

export interface AtRiskResult {
  clientId: string
  clientName: string
  atRisk: boolean
  firedRules: FiredRule[]
}

const MS_PER_DAY = 86_400_000

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY)
}

/** Days from `now` until a yyyy-mm-dd date (negative = past). */
function daysUntil(dateStr: string, now: Date): number {
  const target = new Date(`${dateStr}T00:00:00.000Z`)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/**
 * Pure at-risk rule engine (PRD §5.1). Evaluates five rules over already-fetched
 * inputs and returns which rule(s) fired with a reason each, so the UI can
 * explain the flag on hover. `now` is injectable for deterministic tests.
 */
export function evaluateAtRisk(
  input: AtRiskInput,
  thresholds: AtRiskThresholds,
  now: Date = new Date(),
): AtRiskResult {
  const fired: FiredRule[] = []

  // Rule 1 — no activity in N days (null = never => fire).
  if (input.lastActivityAt === null) {
    fired.push({ rule: 'no_activity', reason: 'No recorded activity yet.' })
  } else {
    const idle = daysBetween(now, input.lastActivityAt)
    if (idle >= thresholds.noActivityDays) {
      fired.push({
        rule: 'no_activity',
        reason: `No activity for ${idle} days (threshold ${thresholds.noActivityDays}).`,
      })
    }
  }

  // Rule 2 — falling key metric vs previous period. Needs a positive baseline.
  const prev = input.headlineMetricPrevious
  const cur = input.headlineMetricCurrent
  if (prev !== null && prev > 0 && cur !== null) {
    const dropPct = Math.round(((prev - cur) / prev) * 100)
    if (dropPct >= thresholds.fallingMetricPct) {
      fired.push({
        rule: 'falling_metric',
        reason: `Key metric down ${dropPct}% vs the previous period (threshold ${thresholds.fallingMetricPct}%).`,
      })
    }
  }

  // Rule 3 — overdue invoice.
  if (input.hasOverdueInvoice) {
    fired.push({ rule: 'overdue_invoice', reason: 'Has at least one overdue invoice.' })
  }

  // Rule 4 — renewal within N days (or already past).
  if (input.renewalDate) {
    const until = daysUntil(input.renewalDate, now)
    if (until <= thresholds.renewalSoonDays) {
      fired.push({
        rule: 'renewal_soon',
        reason:
          until < 0
            ? `Renewal is ${Math.abs(until)} days overdue.`
            : `Renewal due in ${until} days (threshold ${thresholds.renewalSoonDays}).`,
      })
    }
  }

  // Rule 5 — broken data connection (reuse Plan 06 health evaluation).
  const broken = input.connections.filter((c) => {
    const h = evaluateHealth(
      { status: c.status, lastSuccessAt: c.lastSuccessAt, lastError: c.lastError },
      now,
    )
    return h.status === 'error' || h.status === 'expired'
  })
  if (broken.length > 0) {
    const names = broken.map((c) => c.provider).join(', ')
    fired.push({
      rule: 'broken_connection',
      reason: `Broken data connection(s): ${names}.`,
    })
  }

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    atRisk: fired.length > 0,
    firedRules: fired,
  }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/cockpit/atRisk.test.ts`
Expected: all assertions PASS — healthy clients fire nothing; each rule fires under the right condition; multiple rules accumulate; every fired rule has a non-empty reason.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cockpit): pure rule-based at-risk engine (5 rules, explainable; tested)"
```

---

## Task 5: Cockpit data-access layer (`src/lib/cockpit/queries.ts`)

These functions read **only** the already-stored tables (PRD §6.1/§11). They build the KPI numbers and the per-client inputs the at-risk engine consumes. Finance numbers reuse Plan 04's `src/lib/finance/metrics.ts`. The leads and metrics reads are **gated**: they return `null` (card "not available") when their table is empty, satisfying the progressive-enhancement contract. Reads use the Drizzle `db` client (server-only); the cockpit page is staff-only so app-level scoping plus the staff RLS path apply.

**Files:**
- Create: `tests/cockpit/queries.test.ts`, `src/lib/cockpit/queries.ts`

- [ ] **Step 1: Write the integration test `tests/cockpit/queries.test.ts`**

This seeds rows directly (service-role / superuser, like the other integration tests) and asserts the queries read stored values and degrade gracefully when leads/metrics are empty.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import {
  getActiveClientCount,
  getOpenPipelineValue,
  getRenewalsDue,
  getLeadsMtd,
  getOutstandingInvoiceSummary,
} from '@/lib/cockpit/queries'

let agencyOrg: string
let clientOrg: string

beforeAll(async () => {
  const [a] = await sql`select id from public.organizations where slug = 'milktree'`
  agencyOrg = a!.id as string
  const [c] = await sql`select id from public.organizations where slug = 'client-one'`
  clientOrg = c!.id as string

  // A client profile with a renewal 10 days out (within 30) for the renewals KPI.
  await sql`
    insert into public.client (organization_id, name, renewal_date)
    values (${clientOrg}, 'Client One Ltd', (current_date + 10))
    on conflict (organization_id) do update set renewal_date = excluded.renewal_date
  `
  // An active subscription => counts as an active client + MRR (via Plan 04 metrics).
  await sql`
    insert into public.subscriptions (organization_id, amount, status)
    values (${clientOrg}, 250000, 'active')
  `
  // An open invoice => outstanding balance.
  await sql`
    insert into public.invoices (organization_id, type, status, total, amount_paid)
    values (${clientOrg}, 'retainer', 'open', 90000, 18000)
  `
})

afterAll(async () => {
  await sql`delete from public.invoices where organization_id = ${clientOrg}`
  await sql`delete from public.subscriptions where organization_id = ${clientOrg}`
  await sql.end()
})

describe('cockpit queries (read stored rows only)', () => {
  it('counts active clients from active subscriptions', async () => {
    expect(await getActiveClientCount()).toBeGreaterThanOrEqual(1)
  })

  it('summarises outstanding invoices (£ + count)', async () => {
    const s = await getOutstandingInvoiceSummary()
    expect(s.amount).toBeGreaterThanOrEqual(72000) // 90000 - 18000
    expect(s.count).toBeGreaterThanOrEqual(1)
  })

  it('lists renewals due within the window', async () => {
    const due30 = await getRenewalsDue(30)
    expect(due30.some((r) => r.organizationId === clientOrg)).toBe(true)
    const due5 = await getRenewalsDue(5)
    expect(due5.some((r) => r.organizationId === clientOrg)).toBe(false)
  })

  it('open pipeline value is a number (zero when no open deals)', async () => {
    expect(typeof (await getOpenPipelineValue())).toBe('number')
  })

  it('leads MTD returns null when the lead table is empty (card unavailable)', async () => {
    await sql`delete from public.lead`
    expect(await getLeadsMtd('2026-06-01', '2026-06-30')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/cockpit/queries.test.ts`
Expected: FAIL — `@/lib/cockpit/queries` not found.

- [ ] **Step 3: Implement `src/lib/cockpit/queries.ts`**

```ts
import 'server-only'
import { and, eq, gte, lte, inArray, sql as dsql } from 'drizzle-orm'
import { db } from '@/db'
import {
  clients,
  subscriptions,
  invoices,
  deals,
  dealStages,
  lead,
  leadDefinition,
  connection,
  metricDaily,
} from '@/db/schema'
import type { ConnectionStatus } from '@/db/types'

/** Active clients = client orgs with at least one active subscription (PRD §5.1). */
export async function getActiveClientCount(): Promise<number> {
  const [row] = await db
    .select({
      n: dsql<number>`count(distinct ${subscriptions.organizationId})::int`,
    })
    .from(subscriptions)
    .where(eq(subscriptions.status, 'active'))
  return row?.n ?? 0
}

/** Open pipeline value = Σ deal.value for deals in non-terminal stages (minor units). */
export async function getOpenPipelineValue(): Promise<number> {
  const [row] = await db
    .select({ total: dsql<number>`coalesce(sum(${deals.value}), 0)::int` })
    .from(deals)
    .innerJoin(dealStages, eq(deals.stageId, dealStages.id))
    .where(and(eq(dealStages.isWon, false), eq(dealStages.isLost, false)))
  return row?.total ?? 0
}

export interface OutstandingSummary {
  amount: number
  count: number
}

/** Outstanding invoices: £ (total - amountPaid) + count for open/past_due. */
export async function getOutstandingInvoiceSummary(): Promise<OutstandingSummary> {
  const [row] = await db
    .select({
      amount: dsql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)::int`,
      count: dsql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(inArray(invoices.status, ['open', 'past_due']))
  return { amount: row?.amount ?? 0, count: row?.count ?? 0 }
}

export interface RenewalRow {
  organizationId: string
  name: string
  renewalDate: string
}

/** Clients whose renewalDate is within `days` from today (inclusive). */
export async function getRenewalsDue(days: number): Promise<RenewalRow[]> {
  const rows = await db
    .select({
      organizationId: clients.organizationId,
      name: clients.name,
      renewalDate: clients.renewalDate,
    })
    .from(clients)
    .where(
      and(
        dsql`${clients.renewalDate} is not null`,
        dsql`${clients.renewalDate} <= (current_date + ${days})`,
        dsql`${clients.renewalDate} >= current_date`,
      ),
    )
  return rows
    .filter((r): r is RenewalRow => r.renewalDate !== null)
    .map((r) => ({ organizationId: r.organizationId, name: r.name, renewalDate: r.renewalDate }))
}

/**
 * Leads MTD across ALL clients (PRD §5.1). Returns null when the lead table is
 * empty so the card renders "not available" (progressive enhancement: Plan 10).
 * Respects each client's lead_definition (counted sources + spam handling).
 */
export async function getLeadsMtd(fromYmd: string, toYmd: string): Promise<number | null> {
  const [exists] = await db.select({ n: dsql<number>`count(*)::int` }).from(lead).limit(1)
  if (!exists || exists.n === 0) return null

  // Pull per-org lead-definition config to honour countedSources/includeSpam.
  const defs = await db.select().from(leadDefinition)
  const defByOrg = new Map(defs.map((d) => [d.organizationId, d]))

  const rows = await db
    .select({
      organizationId: lead.organizationId,
      source: lead.source,
      isSpam: lead.isSpam,
    })
    .from(lead)
    .where(
      and(
        gte(lead.occurredAt, new Date(`${fromYmd}T00:00:00.000Z`)),
        lte(lead.occurredAt, new Date(`${toYmd}T23:59:59.999Z`)),
      ),
    )

  let total = 0
  for (const r of rows) {
    const def = defByOrg.get(r.organizationId)
    const counted = def?.countedSources ?? [
      'web_form',
      'meta_ads',
      'google_ads',
      'callrail',
      'whatconverts',
      'manual',
    ]
    const includeSpam = def?.includeSpam ?? false
    if (!counted.includes(r.source)) continue
    if (r.isSpam && !includeSpam) continue
    total += 1
  }
  return total
}

export interface ConnRow {
  organizationId: string
  provider: string
  status: ConnectionStatus
  lastSuccessAt: Date | null
  lastError: string | null
}

/** All connection health rows (for the broken_connection at-risk rule). */
export async function getConnectionHealthRows(): Promise<ConnRow[]> {
  const rows = await db
    .select({
      organizationId: connection.organizationId,
      provider: connection.provider,
      status: connection.status,
      lastSuccessAt: connection.lastSuccessAt,
      lastError: connection.lastError,
    })
    .from(connection)
  return rows as ConnRow[]
}

/**
 * Headline metric (current + previous period) per client for the falling_metric
 * rule. Sums metric_daily 'leads' (preferred) else 'sessions'. Returns an empty
 * map when metric_daily is empty (rule then never fires — progressive: Plan 11).
 */
export async function getHeadlineMetricByOrg(
  cur: { from: string; to: string },
  prev: { from: string; to: string },
): Promise<Map<string, { current: number; previous: number }>> {
  const [exists] = await db.select({ n: dsql<number>`count(*)::int` }).from(metricDaily).limit(1)
  const out = new Map<string, { current: number; previous: number }>()
  if (!exists || exists.n === 0) return out

  async function sumByOrg(from: string, to: string) {
    return db
      .select({
        organizationId: metricDaily.organizationId,
        total: dsql<number>`coalesce(sum(${metricDaily.value}), 0)::float`,
      })
      .from(metricDaily)
      .where(
        and(
          inArray(metricDaily.metric, ['leads', 'sessions']),
          gte(metricDaily.date, from),
          lte(metricDaily.date, to),
        ),
      )
      .groupBy(metricDaily.organizationId)
  }

  for (const r of await sumByOrg(cur.from, cur.to)) {
    out.set(r.organizationId, { current: r.total, previous: 0 })
  }
  for (const r of await sumByOrg(prev.from, prev.to)) {
    const e = out.get(r.organizationId) ?? { current: 0, previous: 0 }
    e.previous = r.total
    out.set(r.organizationId, e)
  }
  return out
}

export interface LastActivityRow {
  organizationId: string
  lastActivityAt: Date | null
}

/**
 * Most recent activity timestamp per client org, taken as the max across
 * deals.updatedAt, invoices.createdAt, and (when present) lead.occurredAt.
 */
export async function getLastActivityByOrg(): Promise<Map<string, Date | null>> {
  const rows = await db.execute(dsql`
    select organization_id, max(ts) as last_activity_at
    from (
      select organization_id, updated_at as ts from public.deal
      union all
      select organization_id, created_at as ts from public.invoices
      union all
      select organization_id, occurred_at as ts from public.lead
    ) acts
    group by organization_id
  `)
  const out = new Map<string, Date | null>()
  for (const r of rows as unknown as Array<{ organization_id: string; last_activity_at: string | null }>) {
    out.set(r.organization_id, r.last_activity_at ? new Date(r.last_activity_at) : null)
  }
  return out
}

/** Client orgs with at least one overdue invoice (status past_due). */
export async function getOverdueInvoiceOrgs(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ organizationId: invoices.organizationId })
    .from(invoices)
    .where(eq(invoices.status, 'past_due'))
  return new Set(rows.map((r) => r.organizationId))
}

export interface ClientRow {
  organizationId: string
  name: string
  renewalDate: string | null
}

/** All client profiles (id/name/renewal) for the at-risk pass. */
export async function getClientRows(): Promise<ClientRow[]> {
  const rows = await db
    .select({
      organizationId: clients.organizationId,
      name: clients.name,
      renewalDate: clients.renewalDate,
    })
    .from(clients)
  return rows as ClientRow[]
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/cockpit/queries.test.ts`
Expected: all assertions PASS — active client count, outstanding summary, renewals window, pipeline value all read stored rows; leads MTD returns `null` when `lead` is empty.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cockpit): data-access layer (KPIs + at-risk inputs; gated leads/metrics)"
```

---

## Task 6: Cockpit settings resolver + Founder-only target action

The cockpit reads the agency org's `cockpit_setting` (creating a default row lazily) and exposes a Founder-only server action to set the configurable monthly revenue target (PRD §5.1) — wired to the Plan 04 `revenue_targets` table and audited via Plan 1.5's `recordAuditEvent`. Team members get the **reduced view**: they can read the cockpit but the action rejects non-founders (no finance edit, PRD §3.3).

**Files:**
- Create: `src/app/(internal)/cockpit/actions.ts`
- Modify: `src/lib/cockpit/queries.ts` (add `getCockpitSetting`)

- [ ] **Step 1: Add `getCockpitSetting` to `src/lib/cockpit/queries.ts`**

Append to the file:

```ts
import { cockpitSettings } from '@/db/schema'
import type { CockpitSetting } from '@/db/types'

/**
 * Read the agency org's cockpit settings, creating a default row on first use.
 * Returns the row's threshold fields (defaults if the table is unreachable).
 */
export async function getCockpitSetting(agencyOrgId: string): Promise<CockpitSetting> {
  const existing = await db
    .select()
    .from(cockpitSettings)
    .where(eq(cockpitSettings.organizationId, agencyOrgId))
    .limit(1)
  if (existing[0]) return existing[0]

  const [created] = await db
    .insert(cockpitSettings)
    .values({ organizationId: agencyOrgId })
    .onConflictDoNothing({ target: cockpitSettings.organizationId })
    .returning()
  if (created) return created

  // Race: another request created it — read again.
  const [row] = await db
    .select()
    .from(cockpitSettings)
    .where(eq(cockpitSettings.organizationId, agencyOrgId))
    .limit(1)
  return row!
}
```

- [ ] **Step 2: Implement the Founder-only target action `src/app/(internal)/cockpit/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { revenueTargets } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { recordAuditEvent } from '@/lib/audit/record'

/**
 * Set the agency's monthly revenue target (minor units). Founder-only
 * (PRD §3.3: Team gets no finance edit). Upserts the revenue_targets row for
 * the current month and writes an audit event (PRD §5.14 money/security).
 */
export async function setRevenueTarget(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.orgId || session.role !== 'founder') {
    throw new Error('Forbidden: only the Founder can set the revenue target.')
  }

  const amountMinor = Number(formData.get('amount'))
  if (!Number.isFinite(amountMinor) || amountMinor < 0) {
    throw new Error('Invalid target amount.')
  }

  const now = new Date()
  const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10) // YYYY-MM-01

  const existing = await db
    .select({ id: revenueTargets.id, targetAmount: revenueTargets.targetAmount })
    .from(revenueTargets)
    .where(and(eq(revenueTargets.organizationId, session.orgId), eq(revenueTargets.period, period)))
    .limit(1)

  await db
    .insert(revenueTargets)
    .values({ organizationId: session.orgId, period, targetAmount: Math.round(amountMinor) })
    .onConflictDoUpdate({
      target: [revenueTargets.organizationId, revenueTargets.period],
      set: { targetAmount: Math.round(amountMinor) },
    })

  await recordAuditEvent({
    actorId: session.userId,
    organizationId: session.orgId,
    action: 'revenue_target.set',
    targetType: 'revenue_target',
    targetId: period,
    metadata: { period, from: existing[0]?.targetAmount ?? null, to: Math.round(amountMinor) },
  })

  revalidatePath('/cockpit')
}
```

> **Audit-helper seam:** the canonical signature is `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })` (Plan 1.5). If your built helper uses `before`/`after` instead of `metadata` (the Plan 05 variant), pass `{ before: existing[0]?.targetAmount ?? null, after: Math.round(amountMinor) }` instead — the requirement (PRD §5.14) is that the write produces one immutable audit row.

- [ ] **Step 3: Typecheck**

Run: `pnpm build` (or `pnpm tsc --noEmit` if configured)
Expected: no type errors — `getCockpitSetting`/`setRevenueTarget` compile against the existing schema and helpers.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cockpit): settings resolver + Founder-only revenue-target action (audited)"
```

---

## Task 7: Presentation components (KPI card, gauge, time-range select, at-risk list)

All components are presentational; they receive already-computed numbers and never fetch external data. The gauge is a Recharts radial chart (same pattern as Plan 04's finance gauge). The at-risk list shows each flagged client with a hover tooltip listing the fired rules and their reasons (PRD §5.1 acceptance criterion). KPI cards support an "unavailable" state for the progressive-enhancement gate.

**Files:**
- Create: `src/components/cockpit/kpi-card.tsx`, `src/components/cockpit/revenue-gauge.tsx`, `src/components/cockpit/time-range-select.tsx`, `src/components/cockpit/at-risk-list.tsx`, `src/components/cockpit/set-target-dialog.tsx`

- [ ] **Step 1: Ensure the shadcn primitives exist**

Run:
```bash
pnpm dlx shadcn@latest add tooltip select badge dialog
```
Expected: `src/components/ui/{tooltip,select,badge,dialog}.tsx` exist (no-op if already added by earlier plans).

- [ ] **Step 2: KPI card `src/components/cockpit/kpi-card.tsx`**

```tsx
import { Card } from '@/components/ui/card'

export function KpiCard({
  label,
  value,
  sublabel,
  unavailable,
}: {
  label: string
  value?: string
  sublabel?: string
  unavailable?: boolean
}) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {unavailable ? (
        <p className="mt-1 text-sm italic text-muted-foreground">No data yet</p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
        </>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Revenue gauge `src/components/cockpit/revenue-gauge.tsx`**

```tsx
'use client'
import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/finance/money'

export function RevenueGauge({
  current,
  target,
  currency,
}: {
  current: number
  target: number
  currency: string
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  const data = [{ name: 'progress', value: pct, fill: 'var(--chart-1, #2563eb)' }]
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">Revenue vs target</p>
      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <p className="text-center text-lg font-semibold">
        {formatMoney(current, currency)}{' '}
        <span className="text-muted-foreground">/ {target > 0 ? formatMoney(target, currency) : 'no target set'}</span>
      </p>
      <p className="text-center text-sm text-muted-foreground">{target > 0 ? `${pct}% of target` : 'Set a target to track pacing'}</p>
    </Card>
  )
}
```

- [ ] **Step 4: Time-range select `src/components/cockpit/time-range-select.tsx`**

```tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RANGE_KEYS, type RangeKey } from '@/lib/cockpit/range'

const LABELS: Record<RangeKey, string> = {
  mtd: 'Month to date',
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
}

export function TimeRangeSelect({ value }: { value: RangeKey }) {
  const router = useRouter()
  const params = useSearchParams()

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString())
    sp.set('range', next)
    router.push(`/cockpit?${sp.toString()}`)
    router.refresh()
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 5: At-risk list `src/components/cockpit/at-risk-list.tsx`**

```tsx
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AtRiskResult } from '@/lib/cockpit/atRisk'

const RULE_LABELS: Record<string, string> = {
  no_activity: 'No activity',
  falling_metric: 'Falling metric',
  overdue_invoice: 'Overdue invoice',
  renewal_soon: 'Renewal soon',
  broken_connection: 'Broken connection',
}

export function AtRiskList({ results }: { results: AtRiskResult[] }) {
  const flagged = results.filter((r) => r.atRisk)
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-medium">At-risk accounts ({flagged.length})</p>
      {flagged.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts are currently flagged.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          <TooltipProvider>
            {flagged.map((r) => (
              <li key={r.clientId} className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{r.clientName}</span>
                <div className="flex flex-wrap gap-1">
                  {r.firedRules.map((fr) => (
                    <Tooltip key={fr.rule}>
                      <TooltipTrigger asChild>
                        <Badge variant="destructive" className="cursor-help">
                          {RULE_LABELS[fr.rule] ?? fr.rule}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{fr.reason}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </li>
            ))}
          </TooltipProvider>
        </ul>
      )}
    </Card>
  )
}
```

- [ ] **Step 6: Founder-only target dialog `src/components/cockpit/set-target-dialog.tsx`**

```tsx
'use client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { setRevenueTarget } from '@/app/(internal)/cockpit/actions'

/** Rendered only for the Founder (PRD §3.3 — Team has no finance edit). */
export function SetTargetDialog({ currentMinor }: { currentMinor: number }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Set revenue target
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Monthly revenue target</DialogTitle>
        </DialogHeader>
        <form action={setRevenueTarget} className="flex flex-col gap-3">
          <label className="text-sm text-muted-foreground" htmlFor="amount">
            Target (in pence — e.g. 5000000 for £50,000)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min={0}
            defaultValue={currentMinor || ''}
            className="rounded border p-2"
            required
          />
          <Button type="submit">Save target</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm build`
Expected: components compile; Recharts/shadcn imports resolve.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cockpit): KPI card, revenue gauge, range select, at-risk list, target dialog"
```

---

## Task 8: Assemble the cockpit page (replace Plan 01 placeholder)

This composes everything into `src/app/(internal)/cockpit/page.tsx`. It is staff-only (the `(internal)` layout from Plan 01 already redirects clients) and `force-dynamic` (tenant data, never cached — PRD §9). It resolves the time range from `?range=`, reads the settings, builds the KPI numbers (reusing Plan 04 finance metrics), runs the at-risk engine over all clients, and renders the reduced view for Team (no "Set revenue target" control). Cards that depend on Plans 10/11 render the "No data yet" state when those tables are empty.

**Files:**
- Replace: `src/app/(internal)/cockpit/page.tsx`

- [ ] **Step 1: Replace `src/app/(internal)/cockpit/page.tsx`**

```tsx
import { getSession } from '@/lib/auth'
import { getMrr, getOutstanding, getRecognisedRevenue, getRevenueTarget } from '@/lib/finance/metrics'
import { formatMoney } from '@/lib/finance/money'
import {
  asRangeKey,
  resolveRange,
  type RangeKey,
} from '@/lib/cockpit/range'
import {
  getActiveClientCount,
  getOpenPipelineValue,
  getOutstandingInvoiceSummary,
  getRenewalsDue,
  getLeadsMtd,
  getClientRows,
  getConnectionHealthRows,
  getHeadlineMetricByOrg,
  getLastActivityByOrg,
  getOverdueInvoiceOrgs,
  getCockpitSetting,
} from '@/lib/cockpit/queries'
import { evaluateAtRisk, type AtRiskInput, type AtRiskResult } from '@/lib/cockpit/atRisk'
import { KpiCard } from '@/components/cockpit/kpi-card'
import { RevenueGauge } from '@/components/cockpit/revenue-gauge'
import { TimeRangeSelect } from '@/components/cockpit/time-range-select'
import { AtRiskList } from '@/components/cockpit/at-risk-list'
import { SetTargetDialog } from '@/components/cockpit/set-target-dialog'

export const dynamic = 'force-dynamic' // tenant data must never be statically cached (PRD §9)

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await getSession()
  const agencyOrgId = session?.orgId ?? null
  const isFounder = session?.role === 'founder'

  // Settings (default range + at-risk thresholds), created lazily on first load.
  const setting = agencyOrgId ? await getCockpitSetting(agencyOrgId) : null
  const sp = await searchParams
  const rangeKey: RangeKey = asRangeKey(sp.range ?? setting?.defaultRange ?? 'mtd')
  const range = resolveRange(rangeKey)

  // Month-to-date period for the revenue gauge (recognised one-off income).
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const period = monthStart.toISOString().slice(0, 10)

  const thresholds = {
    noActivityDays: setting?.noActivityDays ?? 14,
    fallingMetricPct: setting?.fallingMetricPct ?? 25,
    renewalSoonDays: setting?.renewalSoonDays ?? 30,
  }

  // Read all stored figures in parallel (PRD §11 — no external API calls).
  const [
    activeClients,
    mrr,
    pipeline,
    outstandingSummary,
    recognised,
    target,
    renewals30,
    renewals60,
    leadsMtd,
    clientRows,
    connRows,
    headlineByOrg,
    lastActivityByOrg,
    overdueOrgs,
  ] = await Promise.all([
    getActiveClientCount(),
    getMrr(),
    getOpenPipelineValue(),
    getOutstandingInvoiceSummary(),
    getRecognisedRevenue(monthStart, nextMonth),
    agencyOrgId ? getRevenueTarget(agencyOrgId, period) : Promise.resolve(null),
    getRenewalsDue(30),
    getRenewalsDue(60),
    getLeadsMtd(range.from, range.to),
    getClientRows(),
    getConnectionHealthRows(),
    getHeadlineMetricByOrg(
      { from: range.from, to: range.to },
      { from: range.prevFrom, to: range.prevTo },
    ),
    getLastActivityByOrg(),
    getOverdueInvoiceOrgs(),
  ])

  // Build at-risk inputs per client and run the pure engine.
  const connByOrg = new Map<string, typeof connRows>()
  for (const c of connRows) {
    const arr = connByOrg.get(c.organizationId) ?? []
    arr.push(c)
    connByOrg.set(c.organizationId, arr)
  }

  const atRiskResults: AtRiskResult[] = clientRows.map((c) => {
    const head = headlineByOrg.get(c.organizationId)
    const input: AtRiskInput = {
      clientId: c.organizationId,
      clientName: c.name,
      lastActivityAt: lastActivityByOrg.get(c.organizationId) ?? null,
      headlineMetricCurrent: head ? head.current : null,
      headlineMetricPrevious: head ? head.previous : null,
      hasOverdueInvoice: overdueOrgs.has(c.organizationId),
      renewalDate: c.renewalDate,
      connections: (connByOrg.get(c.organizationId) ?? []).map((x) => ({
        provider: x.provider,
        status: x.status,
        lastSuccessAt: x.lastSuccessAt,
        lastError: x.lastError,
      })),
    }
    return evaluateAtRisk(input, thresholds, now)
  })

  const gaugeCurrent = mrr + recognised

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cockpit</h1>
        <div className="flex items-center gap-2">
          <TimeRangeSelect value={rangeKey} />
          {isFounder && <SetTargetDialog currentMinor={target ?? 0} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RevenueGauge current={gaugeCurrent} target={target ?? 0} currency="gbp" />
        <div className="grid grid-cols-2 gap-4 md:col-span-2">
          <KpiCard label="Active clients" value={String(activeClients)} />
          <KpiCard label="MRR" value={formatMoney(mrr, 'gbp')} />
          <KpiCard label="Open pipeline" value={formatMoney(pipeline, 'gbp')} sublabel="New deals value" />
          <KpiCard
            label="Outstanding invoices"
            value={formatMoney(outstandingSummary.amount, 'gbp')}
            sublabel={`${outstandingSummary.count} open`}
          />
          <KpiCard
            label="Leads (MTD, all clients)"
            value={leadsMtd === null ? undefined : String(leadsMtd)}
            unavailable={leadsMtd === null}
          />
          <KpiCard
            label="Renewals due"
            value={String(renewals30.length)}
            sublabel={`${renewals60.length} within 60 days`}
          />
        </div>
      </div>

      <AtRiskList results={atRiskResults} />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm build`
Expected: the cockpit compiles; no type errors. Confirm there are no external SDK imports on the page path:
```bash
! grep -RInE "googleapis|google-ads-api|facebook|stripe|fetch\(" src/app/\(internal\)/cockpit src/lib/cockpit && echo "OK: no live external API calls on the cockpit path"
```
Expected: prints `OK: no live external API calls on the cockpit path` (the only data sources are our Drizzle tables + Plan 04 finance metrics).

- [ ] **Step 3: Manual smoke test**

Run: `pnpm db:seed` then `pnpm dev`, and:
1. Sign in as `founder@milktreeagency.com` → `/cockpit` shows the gauge, six KPI cards, the time-range selector, and the at-risk list. The "Set revenue target" button is visible.
2. Change the range selector → URL gains `?range=30d` and the page re-renders.
3. Set a revenue target → the gauge updates and an `audit_event` row exists (`select * from public.audit_event where action='revenue_target.set'`).
4. Sign in as a team member (seed one if needed via `pnpm db:seed`): the cockpit loads but the "Set revenue target" button is **absent** (reduced view).
5. With `lead`/`metric_daily` empty, the "Leads (MTD, all clients)" card shows "No data yet" and the falling-metric rule never fires — the page does not error (progressive enhancement).

Expected: all behave as described.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cockpit): assemble Founder cockpit page (KPIs, gauge, range, at-risk; reduced Team view)"
```

---

## Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all cockpit tests (range, at-risk, queries) pass alongside the new RLS isolation test and every prior plan's tests (RLS isolation suite still green).

- [ ] **Step 2: Confirm the at-risk acceptance criterion end-to-end**

Run: `pnpm test tests/cockpit/atRisk.test.ts tests/cockpit/range.test.ts tests/cockpit/queries.test.ts tests/rls/cockpit-setting.isolation.test.ts`
Expected: all PASS — proving (PRD §5.1) the at-risk list is explainable (each fired rule carries a reason), figures read from stored tables only, and the new table is tenant-isolated.

- [ ] **Step 3: Commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore(cockpit): lint + full-suite green"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.1 Founder Cockpit, §4.1 nav, §12 phasing):**
- Single exec screen at `(internal)/cockpit/page.tsx`, replacing Plan 01's placeholder → Task 8. ✅
- KPI cards — Active clients, MRR, New deals value (open pipeline), Leads MTD (all clients), Outstanding invoices (£ + count), Renewals due (30/60), At-risk accounts → Tasks 5, 7, 8. ✅
- Configurable monthly revenue target + visual progress gauge (MRR + recognised one-off income vs target) as a Recharts component → `revenue-gauge.tsx` + `setRevenueTarget` action (Tasks 6, 7, 8). ✅
- Time-range selector → `time-range-select.tsx` driven by the pure `resolveRange` (Tasks 3, 7, 8). ✅
- Rule-based, explainable at-risk engine as a PURE, UNIT-TESTED function returning which rules fired (no activity N days / falling metric / overdue invoice / renewal < 30 days / broken connection) → KEYSTONE `atRisk.ts` + exhaustive tests (Task 4); hover explanation via `at-risk-list.tsx` tooltips (Task 7). ✅
- All figures from already-stored tables, NEVER live external APIs (PRD §11) → `queries.ts` reads only `client`/`deal`/`invoice`/`subscription`/`revenue_target`/`lead`/`metric_daily`/`connection`; Task 8 Step 2 greps to prove no external SDK/`fetch` on the path. ✅
- Reduced Team view (no finance edit) → `(internal)` staff guard (Plan 01) + Founder-only `SetTargetDialog`/`setRevenueTarget` (PRD §3.3) (Tasks 6, 8). ✅
- Data-access layer with tested aggregation + RLS-safe queries → `src/lib/cockpit/*` + Task 5 integration test (reads run under the staff path; the one new tenant table has an RLS isolation test). ✅
- Progressive enhancement — basic cockpit after Plan 04, leads/metrics cards after Plans 10/11, each gated on data availability → `getLeadsMtd` returns `null`, `getHeadlineMetricByOrg` returns an empty map, the leads card renders "No data yet", and the falling-metric rule never false-fires without a baseline (Tasks 4, 5, 8). ✅
- Acceptance: gauge reflects MRR + recognised one-off for the period; at-risk list explainable on hover → gauge (Task 8) + tooltips (Task 7). ✅ (The "< 1.5s cached reads" target is a runtime/caching concern: all reads are single indexed Postgres queries with tenant-leading indexes; no external calls — consistent with PRD §11.)

**Shared-conventions compliance:**
- New tenant-scoped table `cockpit_setting` carries `organization_id` as the leading column of a composite index (`idx_cockpit_setting_org`), enables RLS, and REUSES `public.is_agency_staff()` (Tasks 1–2). It has its own RLS isolation test (Task 2, KEYSTONE). ✅
- Canonical paths/names consumed, never recreated: Plan 04 `src/lib/finance/metrics.ts` + `money.ts`; Plan 06 `src/lib/integrations/health.ts` `evaluateHealth`; Plan 1.5 `src/lib/audit/record.ts` `recordAuditEvent`; Plan 01 `src/lib/auth.ts` `getSession`/`isStaff` + harness `tests/helpers/db.ts`. Table names match PRD §8 / the reconciled suite exactly (`client`, `deal`, `deal_stage`, `invoices`, `subscriptions`, `revenue_targets`, `lead`, `lead_definition`, `connection`, `metric_daily`). Provider tag `meta_ads` used (matches the `integrationProvider` enum). ✅
- `service_role` not used for user-facing reads: the cockpit reads via the server Drizzle `db`; the only privileged write is the audited target action and `recordAuditEvent` (service-role insert by design, PRD §9). ✅
- Caching safety: `export const dynamic = 'force-dynamic'` on the cockpit page (PRD §9). ✅

**Placeholder scan:** No TBD/TODO; every code step has complete, runnable code. The audit-helper `metadata` vs `before/after` note is an explicit integration seam against the named Plan 1.5/Plan 05 helper, not a code gap. ✅

**Type consistency:** `RangeKey`/`ResolvedRange` (range.ts) shared between the resolver, the select component, and the page; `AtRiskInput`/`AtRiskResult`/`FiredRule`/`AtRiskRule` shared between the engine, the page assembly, and the list component; `ConnectionStatus` (from `src/db/types.ts`) reused in `atRisk.ts` and `queries.ts`; `CockpitSetting` inferred type used by the resolver and page; enum string unions (`invoiceStatus`, `lead_source`) referenced exactly as defined upstream. ✅

**Definition of done for Plan 19:** `pnpm lint && pnpm test` green (pure range + KEYSTONE at-risk unit tests, queries integration test, and the `cockpit_setting` RLS isolation test all pass, with the prior-plan RLS suite still green), and the Task 8 manual smoke test behaves correctly for a Founder (full view + target editing) and a Team member (reduced view), including the "No data yet" leads card when Plans 10/11 data is absent.
