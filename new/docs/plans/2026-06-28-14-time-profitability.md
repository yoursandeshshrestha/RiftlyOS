# Agency OS — Plan 14: Time Reporting & Per-Client Profitability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Time reporting** and **per-client Profitability** layer on top of the existing time-entry engine (Plan 03) and finance backbone (Plan 04). Introduce a Founder-only **`cost_rate`** table (effective-dated `£/hr` per user) and a derived **`profitability_rollup`** table; compute **profitability per client = client revenue (active retainer MRR + recognised one-off income for the period) − Σ(hours × effective cost rate)** with full drill-down to the underlying time entries. Ship the **Timesheet ("my week")** view, **team reports** (by user / client / period), and **utilisation**. Hours feed profitability + reports only — **invoices stay MANUAL** (no auto hours→invoice, per the owner decision in PRD §5.9). Clients have **ZERO access** to any time/cost data, and **cost rates are visible only to the Founder** — both enforced by Postgres RLS and proven by tests.

**Architecture:** Two new tables — `cost_rates` (effective-dated internal cost per user; **Founder-only** via a new `public.is_founder()` SECURITY DEFINER helper) and `profitability_rollups` (a tenant-scoped derived cache keyed on `(organization_id, period)`). Both carry their tenant/scoping column as the leading column of a composite index and have RLS enabled. `cost_rates` is **not** tenant-scoped to a client org (cost is an agency-internal, person-level fact) so it uses `is_founder()` for both read and write; `profitability_rollups` is keyed on the **client** `organization_id` and reuses the Plan 01 helpers `public.has_org_access(uuid)` / `public.is_agency_staff()` — but its policy ALSO requires `is_agency_staff()` for reads so a client never sees margin data even for their own org. The compute layer (`src/lib/time/profitability.ts`) resolves each user's **effective** cost rate for an entry's date (latest `effective_from <= entry date`), multiplies by hours, sums per client, subtracts that labour cost from finance revenue (per-org variants of Plan 04's `getMrr` + recognised one-off), and persists a rollup row. Reporting queries (`src/lib/time/reports.ts`) aggregate `time_entries` (Plan 03) by user / client / period and compute utilisation against a configurable working-hours capacity. All reads/writes go through the RLS-scoped Supabase server client (defense in depth); only the rollup recompute job uses `service_role` (admin/Inngest), never user-facing queries. An Inngest nightly cron recomputes the current-period rollups so the Founder's profitability view is a cached read (PRD §11: no heavy compute on page load).

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions) · TypeScript strict · pnpm · Supabase Postgres + RLS · Drizzle ORM + drizzle-kit · postgres.js · Inngest (nightly rollup recompute cron) · Tailwind + shadcn/ui · Recharts (utilisation + margin charts) · Vitest (unit + RLS isolation + role-guard tests). Reuses Plan 01 helpers/harness, Plan 03 `time_entries`, Plan 04 finance tables + `src/lib/finance/money.ts`.

**Dependencies (assumed already built — do NOT re-spec):** Plan 01 (tenancy, RLS helpers `has_org_access`/`is_agency_staff`, custom-access-token hook, seed, `tests/helpers/db.ts`), Plan 03 (`time_entries` + `tasks` + `boards`), Plan 04 (`subscriptions`, `invoices`, `line_items`, `revenue_targets`, `src/lib/finance/money.ts`, `src/lib/finance/metrics.ts`).

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                              # (modify) append cost_rates + profitability_rollups
│  │  └─ types.ts                               # (modify) append inferred types
│  ├─ lib/
│  │  └─ time/
│  │     ├─ rates.ts                            # effective cost-rate resolution + CRUD (Founder-only)
│  │     ├─ profitability.ts                    # compute + persist per-client profitability rollups
│  │     └─ reports.ts                          # timesheet / team reports / utilisation queries
│  ├─ inngest/
│  │  └─ functions/
│  │     └─ recompute-profitability.ts          # nightly cron: recompute current-period rollups
│  └─ app/(internal)/time/
│     ├─ page.tsx                               # Timesheet — "my week"
│     ├─ reports/page.tsx                       # team reports (by user/client/period) + utilisation
│     ├─ profitability/page.tsx                 # per-client profitability (Founder-only) + drill-down
│     ├─ rates/page.tsx                         # cost-rate admin (Founder-only)
│     ├─ actions.ts                             # server actions: set cost rate, set capacity, recompute
│     └─ _components/
│        ├─ week-grid.tsx                       # my-week timesheet grid
│        ├─ utilisation-chart.tsx               # Recharts utilisation bars
│        └─ margin-table.tsx                    # per-client revenue/cost/margin table
└─ tests/
   ├─ time/
   │  ├─ rates.test.ts                          # effective-rate resolution unit tests
   │  ├─ profitability.test.ts                  # revenue − labour cost = margin (drill-down)
   │  └─ reports.test.ts                        # timesheet/team/utilisation aggregation
   └─ rls/
      ├─ cost_rates_isolation.test.ts           # ONLY the Founder can read/write cost_rates
      └─ profitability_isolation.test.ts        # clients have ZERO access to margin rollups
```

---

## Task 1: Define the schema (`cost_rates` + `profitability_rollups`)

**Files:**
- Modify: `src/db/schema.ts` (append two tables)
- Modify: `src/db/types.ts` (append inferred types)
- Create: `drizzle/00XX_time_profitability_schema.sql` (generated)

- [ ] **Step 1: Append the two tables to `src/db/schema.ts`**

Append at the end of `src/db/schema.ts` (the existing imports already include `pgTable`, `uuid`, `text`, `integer`, `timestamp`, `date`, `index`, `unique` from Plans 01/03/04; if `date` is not yet imported, add it to the `drizzle-orm/pg-core` import line):

```ts
// ─── cost_rate (internal £/hr per user; effective-dated; FOUNDER-ONLY) ─────────
// NOT scoped to a client org — cost is an agency-internal, person-level fact.
// `rate` is minor units per hour (e.g. £45.00/hr = 4500). Effective-dated:
// the rate applied to an entry is the latest row with effective_from <= entry date.
export const costRates = pgTable(
  'cost_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    rate: integer('rate').notNull(), // minor units per hour
    currency: text('currency').notNull().default('gbp'),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Leading column = userId (the scoping dimension for this person-level table).
    userIdx: index('idx_cost_rates_user').on(t.userId, t.effectiveFrom),
    // At most one rate per user per effective date.
    uniqUserDate: unique('uniq_cost_rate_user_date').on(t.userId, t.effectiveFrom),
  }),
)

// ─── profitability_rollup (derived per-client margin cache) ───────────────────
// organization_id = the CLIENT org. period = first day of the month (date).
// All amounts minor units. revenue = active retainer MRR + recognised one-off
// income for the period; labourCost = Σ(hours × effective cost rate); margin =
// revenue − labourCost. Recomputed by the nightly Inngest job (Task 6).
export const profitabilityRollups = pgTable(
  'profitability_rollups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    period: date('period').notNull(), // first day of the month
    currency: text('currency').notNull().default('gbp'),
    revenue: integer('revenue').notNull().default(0), // minor units
    labourCost: integer('labour_cost').notNull().default(0), // minor units
    margin: integer('margin').notNull().default(0), // revenue - labourCost
    billableMinutes: integer('billable_minutes').notNull().default(0),
    totalMinutes: integer('total_minutes').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgPeriodIdx: index('idx_profitability_org_period').on(t.organizationId, t.period),
    uniqOrgPeriod: unique('uniq_profitability_org_period').on(t.organizationId, t.period),
  }),
)
```

If the schema's central `export` of tables (the object passed to `drizzle(client, { schema })`) is an explicit list, also register `costRates` and `profitabilityRollups` there; if `schema.ts` exports each table individually (Plan 01 style), no change is needed beyond the two `export const` blocks above.

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type { costRates, profitabilityRollups } from './schema'

export type CostRate = typeof costRates.$inferSelect
export type NewCostRate = typeof costRates.$inferInsert
export type ProfitabilityRollup = typeof profitabilityRollups.$inferSelect
export type NewProfitabilityRollup = typeof profitabilityRollups.$inferInsert
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00XX_time_profitability_schema.sql` is created containing the `cost_rates` and `profitability_rollups` tables with their indexes and unique constraints. Note the exact filename printed.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies with no errors. Verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*"
```
Expected: `cost_rates` and `profitability_rollups` are listed alongside the Plan 01/03/04 tables.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): time-profitability schema (cost_rates, profitability_rollups)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: KEYSTONE — RLS isolation/role-guard tests for the two new tables (watch them FAIL)

**Files:**
- Create: `tests/rls/cost_rates_isolation.test.ts`
- Create: `tests/rls/profitability_isolation.test.ts`

RLS is not enabled on the two new tables yet, so any authenticated user can currently read both. We write the tests first, confirm they FAIL, then add policies in Task 3 to make them PASS. These reuse the Plan 01 harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail`, `sql`) and the seed users (`founder@milktreeagency.com`, `user1@clientone.com`).

> The seed (Plan 01) only creates a founder + two client users. These tests need a **team** (non-founder staff) user to prove cost rates are Founder-only even for staff. Step 1 below adds that seed user idempotently via a small inline helper using the existing service-role `sql` connection (RLS-bypassing), so the test is self-contained and does not require editing `scripts/seed.ts`.

- [ ] **Step 1: Write `tests/rls/cost_rates_isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

// Cost rates are FOUNDER-ONLY: not a team member, not a client.
describe('cost_rates role guard (RLS)', () => {
  let founder: string
  let teamUser: string
  let clientOneUser: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')

    // Ensure a TEAM staff user exists (agency org, role='team'), idempotently.
    const [agency] = await sql`select id from public.organizations where slug = 'milktree'`
    const existing = await sql`select id from public.profiles where email = 'teammate@milktreeagency.com'`
    if (existing[0]) {
      teamUser = existing[0].id as string
    } else {
      // Insert directly via service-role (RLS bypassed) for a deterministic test fixture.
      const [p] = await sql`
        insert into public.profiles (id, email, full_name)
        values (gen_random_uuid(), 'teammate@milktreeagency.com', 'Team Mate')
        returning id`
      teamUser = p!.id as string
      await sql`
        insert into public.memberships (user_id, organization_id, role)
        values (${teamUser}, ${agency!.id}, 'team')
        on conflict do nothing`
    }

    // Seed one cost rate for the team user (service-role bypasses RLS).
    await sql`delete from public.cost_rates where user_id = ${teamUser}`
    await sql`
      insert into public.cost_rates (user_id, rate, currency, effective_from)
      values (${teamUser}, 4500, 'gbp', '2026-01-01')`
  })

  afterAll(async () => {
    await sql`delete from public.cost_rates where user_id = ${teamUser}`
    await sql.end()
  })

  it('the FOUNDER can read cost_rates', async () => {
    const rows = await asUser(founder, (tx) => tx`select rate from public.cost_rates`)
    expect(rows.map((r) => r.rate)).toContain(4500)
  })

  it('a TEAM staff member CANNOT read cost_rates', async () => {
    const rows = await asUser(teamUser, (tx) => tx`select rate from public.cost_rates`)
    expect(rows.length).toBe(0)
  })

  it('a CLIENT user CANNOT read cost_rates', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select rate from public.cost_rates`)
    expect(rows.length).toBe(0)
  })

  it('a TEAM staff member CANNOT insert a cost_rate', async () => {
    await expect(
      asUser(teamUser, (tx) =>
        tx`insert into public.cost_rates (user_id, rate, currency, effective_from)
           values (${teamUser}, 9999, 'gbp', '2026-06-01')`,
      ),
    ).rejects.toThrow()
  })

  it('the FOUNDER can insert a cost_rate', async () => {
    await asUser(founder, (tx) =>
      tx`insert into public.cost_rates (user_id, rate, currency, effective_from)
         values (${founder}, 6000, 'gbp', '2026-06-01')`,
    )
    const rows = await asUser(founder, (tx) => tx`select rate from public.cost_rates where user_id = ${founder}`)
    expect(rows.map((r) => r.rate)).toContain(6000)
    await sql`delete from public.cost_rates where user_id = ${founder}`
  })
})
```

- [ ] **Step 2: Write `tests/rls/profitability_isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

// Profitability rollups carry margin data: agency staff see them; a CLIENT has
// ZERO access EVEN to their own org's row (margin is not client-facing).
describe('profitability_rollups isolation (RLS)', () => {
  let founder: string
  let clientOneUser: string
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1!.id as string
    orgTwo = o2!.id as string

    // Seed one rollup per client org (service-role bypasses RLS).
    await sql`delete from public.profitability_rollups where organization_id in (${orgOne}, ${orgTwo})`
    await sql`
      insert into public.profitability_rollups
        (organization_id, period, currency, revenue, labour_cost, margin, billable_minutes, total_minutes)
      values
        (${orgOne}, '2026-06-01', 'gbp', 200000, 80000, 120000, 600, 720),
        (${orgTwo}, '2026-06-01', 'gbp', 500000, 150000, 350000, 1200, 1440)`
  })

  afterAll(async () => {
    await sql`delete from public.profitability_rollups where organization_id in (${orgOne}, ${orgTwo})`
    await sql.end()
  })

  it('agency staff (founder) sees ALL profitability rollups', async () => {
    const rows = await asUser(founder, (tx) => tx`select margin from public.profitability_rollups order by margin`)
    expect(rows.map((r) => r.margin)).toEqual([120000, 350000])
  })

  it('a CLIENT user sees ZERO profitability rollups (not even their own org)', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select margin from public.profitability_rollups`)
    expect(rows.length).toBe(0)
  })

  it('a CLIENT user cannot INSERT a profitability rollup', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.profitability_rollups (organization_id, period, margin)
           values (${orgOne}, '2026-07-01', 1)`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run the tests and confirm they FAIL**

Run: `pnpm test tests/rls/cost_rates_isolation.test.ts tests/rls/profitability_isolation.test.ts`
Expected: FAIL — without RLS, the team/client users read `cost_rates` rows (so "CANNOT read" assertions fail) and clients read `profitability_rollups` rows; the INSERT assertions also fail because inserts succeed. This proves the tests are real.

- [ ] **Step 4: Commit the failing tests**

```bash
git add -A
git commit -m "test(rls): cost_rate founder-only + profitability client-zero-access (failing, RLS not enabled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Enable RLS + `is_founder()` helper + policies → make the tests PASS

**Files:**
- Create: `drizzle/00XX_time_profitability_rls.sql` (custom SQL migration)

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=time_profitability_rls`
Expected: an empty `drizzle/00XX_time_profitability_rls.sql` is created and registered in the journal. Note the exact filename.

- [ ] **Step 2: Fill in the migration**

```sql
-- Helper: is the current user the FOUNDER (founder role in an agency-type org)?
-- Mirrors the Plan 01 is_agency_staff() pattern but narrowed to role='founder'.
create or replace function public.is_founder()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and o.type = 'agency'
      and m.role = 'founder'
  );
$$;

-- Enable RLS on both new tables.
alter table public.cost_rates             enable row level security;
alter table public.profitability_rollups  enable row level security;

-- ── cost_rates (FOUNDER-ONLY: read + write) ──────────────────────────────────
-- Cost rates expose individual pay/cost; only the Founder may ever see or edit.
create policy cost_rates_select on public.cost_rates
  for select using (public.is_founder());

create policy cost_rates_insert on public.cost_rates
  for insert with check (public.is_founder());

create policy cost_rates_update on public.cost_rates
  for update using (public.is_founder()) with check (public.is_founder());

create policy cost_rates_delete on public.cost_rates
  for delete using (public.is_founder());

-- ── profitability_rollups (agency staff read; clients ZERO access) ───────────
-- has_org_access(id) alone would let a client see THEIR org's row — margin must
-- never be client-facing, so we additionally require is_agency_staff().
create policy profitability_select on public.profitability_rollups
  for select using (public.is_agency_staff() and public.has_org_access(organization_id));

-- Writes are performed by the service-role recompute job (RLS-exempt). Provide
-- a staff-only write policy for any user-facing manual recompute action.
create policy profitability_insert on public.profitability_rollups
  for insert with check (public.is_agency_staff() and public.has_org_access(organization_id));

create policy profitability_update on public.profitability_rollups
  for update using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.is_agency_staff() and public.has_org_access(organization_id));
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies the RLS migration with no errors.

- [ ] **Step 4: Run the isolation tests and confirm they PASS**

Run: `pnpm test tests/rls/cost_rates_isolation.test.ts tests/rls/profitability_isolation.test.ts`
Expected: all tests PASS — the founder reads/inserts `cost_rates`; team and client users read 0 cost rows and cannot insert; agency staff see all rollups; clients see 0 rollups and cannot insert.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): is_founder() + RLS — cost_rates founder-only, profitability staff-only (tests pass)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Effective cost-rate resolution (`src/lib/time/rates.ts`) — TDD

**Files:**
- Create: `tests/time/rates.test.ts`
- Create: `src/lib/time/rates.ts`

The "cost rate that applies to an entry" is the latest `cost_rates` row for that user with `effective_from <= entry date`. This must be a pure, testable function over an in-memory rate list (so the unit test needs no DB), plus a DB-backed loader.

- [ ] **Step 1: Write `tests/time/rates.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { effectiveRateFor, type DatedRate } from '@/lib/time/rates'

const rates: DatedRate[] = [
  { effectiveFrom: '2026-01-01', rate: 4000 },
  { effectiveFrom: '2026-04-01', rate: 4500 },
  { effectiveFrom: '2026-06-01', rate: 5000 },
]

describe('effectiveRateFor', () => {
  it('picks the latest rate at or before the entry date', () => {
    expect(effectiveRateFor(rates, '2026-05-15')).toBe(4500)
    expect(effectiveRateFor(rates, '2026-06-01')).toBe(5000)
    expect(effectiveRateFor(rates, '2026-12-31')).toBe(5000)
  })

  it('returns null when the entry predates every rate', () => {
    expect(effectiveRateFor(rates, '2025-12-31')).toBeNull()
  })

  it('returns null when there are no rates', () => {
    expect(effectiveRateFor([], '2026-06-15')).toBeNull()
  })

  it('handles unsorted input', () => {
    const shuffled: DatedRate[] = [
      { effectiveFrom: '2026-06-01', rate: 5000 },
      { effectiveFrom: '2026-01-01', rate: 4000 },
    ]
    expect(effectiveRateFor(shuffled, '2026-03-01')).toBe(4000)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/time/rates.test.ts`
Expected: FAIL — `@/lib/time/rates` not found.

- [ ] **Step 3: Implement `src/lib/time/rates.ts`**

```ts
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { costRates } from '@/db/schema'

/** A cost rate row reduced to the two fields the resolver needs. */
export type DatedRate = { effectiveFrom: string; rate: number }

/**
 * Resolve the cost rate (minor units/hr) that applies to an entry on `date`
 * (an ISO 'YYYY-MM-DD' string): the latest rate whose effective_from is <= date.
 * Returns null if no rate is effective on/before that date.
 */
export function effectiveRateFor(rates: DatedRate[], date: string): number | null {
  let best: DatedRate | null = null
  for (const r of rates) {
    if (r.effectiveFrom <= date && (best === null || r.effectiveFrom > best.effectiveFrom)) {
      best = r
    }
  }
  return best?.rate ?? null
}

/** Load every cost rate for one user (Founder-scoped; RLS enforces visibility). */
export async function loadRatesForUser(userId: string): Promise<DatedRate[]> {
  const rows = await db
    .select({ effectiveFrom: costRates.effectiveFrom, rate: costRates.rate })
    .from(costRates)
    .where(eq(costRates.userId, userId))
  return rows
}

/** Build a map userId -> sorted DatedRate[] for a set of users (one query). */
export async function loadRatesForUsers(userIds: string[]): Promise<Map<string, DatedRate[]>> {
  const map = new Map<string, DatedRate[]>()
  if (userIds.length === 0) return map
  const rows = await db
    .select({ userId: costRates.userId, effectiveFrom: costRates.effectiveFrom, rate: costRates.rate })
    .from(costRates)
  for (const row of rows) {
    if (!userIds.includes(row.userId)) continue
    const list = map.get(row.userId) ?? []
    list.push({ effectiveFrom: row.effectiveFrom, rate: row.rate })
    map.set(row.userId, list)
  }
  return map
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/time/rates.test.ts`
Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(time): effective cost-rate resolution + loaders (tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Per-client profitability compute (`src/lib/time/profitability.ts`) — TDD

**Files:**
- Create: `tests/time/profitability.test.ts`
- Create: `src/lib/time/profitability.ts`

Profitability for a client over a period = **revenue − labour cost**, where revenue = active retainer MRR (sum of `subscriptions.amount` where `status='active'` for that org) + recognised one-off income (paid `one_off` invoices with `paidAt` in the period) and labour cost = Σ over the org's completed time entries in the period of `(minutes/60) × effectiveRate`. This task implements both the pure aggregation helper (testable in-memory) and the DB-backed `computeProfitability` that persists a `profitability_rollups` row.

- [ ] **Step 1: Write `tests/time/profitability.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { labourCostForEntries, computeProfitability, type EntryForCost } from '@/lib/time/profitability'
import { effectiveRateFor, type DatedRate } from '@/lib/time/rates'

describe('labourCostForEntries (pure)', () => {
  const rates = new Map<string, DatedRate[]>([
    ['u1', [{ effectiveFrom: '2026-01-01', rate: 4500 }]], // £45/hr
    ['u2', [{ effectiveFrom: '2026-01-01', rate: 6000 }]], // £60/hr
  ])

  it('sums (minutes/60 * rate) per user, rounded to minor units', () => {
    const entries: EntryForCost[] = [
      { userId: 'u1', minutes: 120, date: '2026-06-02' }, // 2h * 4500 = 9000
      { userId: 'u2', minutes: 90, date: '2026-06-03' }, //  1.5h * 6000 = 9000
    ]
    const cost = labourCostForEntries(entries, rates, effectiveRateFor)
    expect(cost).toBe(18000)
  })

  it('treats entries with no effective rate as zero cost', () => {
    const entries: EntryForCost[] = [{ userId: 'u3', minutes: 60, date: '2026-06-02' }]
    expect(labourCostForEntries(entries, rates, effectiveRateFor)).toBe(0)
  })
})

describe('computeProfitability (DB)', () => {
  let orgOne: string
  let founder: string
  let board: string
  let column: string
  let task: string

  beforeAll(async () => {
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    orgOne = o1!.id as string
    const [f] = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    founder = f!.id as string

    // Clean slate for the period under test.
    await sql`delete from public.profitability_rollups where organization_id = ${orgOne} and period = '2026-06-01'`
    await sql`delete from public.subscriptions where organization_id = ${orgOne}`
    await sql`delete from public.invoices where organization_id = ${orgOne}`
    await sql`delete from public.cost_rates where user_id = ${founder}`

    // Revenue: one active retainer (MRR 200000) + one paid one-off in June (50000).
    await sql`
      insert into public.subscriptions (organization_id, amount, currency, status)
      values (${orgOne}, 200000, 'gbp', 'active')`
    await sql`
      insert into public.invoices (organization_id, type, status, currency, subtotal, tax_total, total, amount_paid, paid_at)
      values (${orgOne}, 'one_off', 'paid', 'gbp', 50000, 0, 50000, 50000, '2026-06-10T00:00:00Z')`

    // Cost: founder rate £50/hr (5000) effective Jan; 4h logged in June on this org.
    await sql`insert into public.cost_rates (user_id, rate, currency, effective_from) values (${founder}, 5000, 'gbp', '2026-01-01')`

    // A board/column/task to attach time to (Plan 03 schema).
    const [b] = await sql`insert into public.boards (organization_id, name) values (${orgOne}, 'Ops') returning id`
    board = b!.id as string
    const [c] = await sql`insert into public.board_columns (organization_id, board_id, name, position) values (${orgOne}, ${board}, 'To Do', 0) returning id`
    column = c!.id as string
    const [t] = await sql`insert into public.tasks (organization_id, board_id, column_id, title, origin, created_by, position) values (${orgOne}, ${board}, ${column}, 'Work', 'agency', ${founder}, 0) returning id`
    task = t!.id as string

    // 240 minutes (4h) of completed time in June.
    await sql`
      insert into public.time_entries (organization_id, task_id, user_id, minutes, billable, source, started_at, ended_at)
      values (${orgOne}, ${task}, ${founder}, 240, true, 'manual', '2026-06-05T09:00:00Z', '2026-06-05T13:00:00Z')`
  })

  afterAll(async () => {
    await sql`delete from public.time_entries where task_id = ${task}`
    await sql`delete from public.tasks where id = ${task}`
    await sql`delete from public.board_columns where id = ${column}`
    await sql`delete from public.boards where id = ${board}`
    await sql`delete from public.cost_rates where user_id = ${founder}`
    await sql`delete from public.subscriptions where organization_id = ${orgOne}`
    await sql`delete from public.invoices where organization_id = ${orgOne}`
    await sql`delete from public.profitability_rollups where organization_id = ${orgOne} and period = '2026-06-01'`
    await sql.end()
  })

  it('computes revenue − labour cost and persists a rollup with drill-down totals', async () => {
    const result = await computeProfitability(orgOne, '2026-06-01')
    // revenue = 200000 (MRR) + 50000 (one-off) = 250000
    // labour  = 4h * 5000 = 20000
    // margin  = 230000
    expect(result.revenue).toBe(250000)
    expect(result.labourCost).toBe(20000)
    expect(result.margin).toBe(230000)
    expect(result.totalMinutes).toBe(240)
    expect(result.billableMinutes).toBe(240)

    const [persisted] = await sql`
      select revenue, labour_cost, margin from public.profitability_rollups
      where organization_id = ${orgOne} and period = '2026-06-01'`
    expect(persisted!.revenue).toBe(250000)
    expect(persisted!.labour_cost).toBe(20000)
    expect(persisted!.margin).toBe(230000)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/time/profitability.test.ts`
Expected: FAIL — `@/lib/time/profitability` not found.

- [ ] **Step 3: Implement `src/lib/time/profitability.ts`**

```ts
import 'server-only'
import { and, eq, gte, lt, inArray, sql as dsql } from 'drizzle-orm'
import { db } from '@/db'
import { subscriptions, invoices, timeEntries, tasks, profitabilityRollups } from '@/db/schema'
import { effectiveRateFor, loadRatesForUsers, type DatedRate } from '@/lib/time/rates'

/** A completed time entry reduced to the fields the cost calc needs. */
export type EntryForCost = { userId: string; minutes: number; date: string }

export type ProfitabilityResult = {
  organizationId: string
  period: string
  currency: string
  revenue: number
  labourCost: number
  margin: number
  billableMinutes: number
  totalMinutes: number
}

/**
 * Pure labour-cost aggregation: for each entry, find the user's effective rate
 * on the entry date and add (minutes/60 * rate), rounded to integer minor units.
 * `resolve` is injected so this is unit-testable without the DB.
 */
export function labourCostForEntries(
  entries: EntryForCost[],
  ratesByUser: Map<string, DatedRate[]>,
  resolve: (rates: DatedRate[], date: string) => number | null,
): number {
  let total = 0
  for (const e of entries) {
    const rate = resolve(ratesByUser.get(e.userId) ?? [], e.date)
    if (rate === null) continue
    total += Math.round((e.minutes / 60) * rate)
  }
  return total
}

/** First day of the month after `period` (ISO 'YYYY-MM-01'). */
function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const year = m === 12 ? y! + 1 : y!
  const month = m === 12 ? 1 : m! + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** Active retainer MRR for one org (minor units). */
async function orgMrr(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: dsql<number>`coalesce(sum(${subscriptions.amount}), 0)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, 'active')))
  return row?.total ?? 0
}

/** Recognised one-off income for one org in the period (paid one_off invoices). */
async function orgOneOffRevenue(organizationId: string, periodStart: string, periodEnd: string): Promise<number> {
  const [row] = await db
    .select({ total: dsql<number>`coalesce(sum(${invoices.amountPaid}), 0)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.type, 'one_off'),
        eq(invoices.status, 'paid'),
        dsql`${invoices.paidAt} >= ${periodStart}`,
        dsql`${invoices.paidAt} < ${periodEnd}`,
      ),
    )
  return row?.total ?? 0
}

/**
 * Compute and PERSIST the profitability rollup for one client org + month.
 * period is the first day of the month, ISO 'YYYY-MM-01'.
 * Runs under service-role (Inngest/admin); never on a user request path.
 */
export async function computeProfitability(
  organizationId: string,
  period: string,
  currency = 'gbp',
): Promise<ProfitabilityResult> {
  const periodEnd = nextPeriod(period)

  // Revenue.
  const mrr = await orgMrr(organizationId)
  const oneOff = await orgOneOffRevenue(organizationId, period, periodEnd)
  const revenue = mrr + oneOff

  // Completed time entries for this org in the period (minutes IS NOT NULL).
  const entries = await db
    .select({
      userId: timeEntries.userId,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
      startedAt: timeEntries.startedAt,
      createdAt: timeEntries.createdAt,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.organizationId, organizationId),
        dsql`${timeEntries.minutes} is not null`,
        dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) >= ${period}`,
        dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) < ${periodEnd}`,
      ),
    )

  const entriesForCost: EntryForCost[] = entries.map((e) => ({
    userId: e.userId,
    minutes: e.minutes ?? 0,
    date: (e.startedAt ?? e.createdAt).toISOString().slice(0, 10),
  }))

  const userIds = [...new Set(entriesForCost.map((e) => e.userId))]
  const ratesByUser = await loadRatesForUsers(userIds)
  const labourCost = labourCostForEntries(entriesForCost, ratesByUser, effectiveRateFor)

  const totalMinutes = entries.reduce((acc, e) => acc + (e.minutes ?? 0), 0)
  const billableMinutes = entries.reduce((acc, e) => acc + (e.billable ? e.minutes ?? 0 : 0), 0)
  const margin = revenue - labourCost

  // Upsert the rollup (unique on organization_id + period).
  await db
    .insert(profitabilityRollups)
    .values({
      organizationId,
      period,
      currency,
      revenue,
      labourCost,
      margin,
      billableMinutes,
      totalMinutes,
    })
    .onConflictDoUpdate({
      target: [profitabilityRollups.organizationId, profitabilityRollups.period],
      set: { revenue, labourCost, margin, billableMinutes, totalMinutes, computedAt: dsql`now()` },
    })

  return { organizationId, period, currency, revenue, labourCost, margin, billableMinutes, totalMinutes }
}

/** Load the persisted rollups for all client orgs for a period (Founder view). */
export async function loadRollupsForPeriod(period: string) {
  return db
    .select()
    .from(profitabilityRollups)
    .where(eq(profitabilityRollups.period, period))
}

/** Drill-down: per-user minutes + cost for one org/period (Founder view). */
export async function profitabilityDrilldown(organizationId: string, period: string) {
  const periodEnd = nextPeriod(period)
  const rows = await db
    .select({
      userId: timeEntries.userId,
      minutes: dsql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.organizationId, organizationId),
        dsql`${timeEntries.minutes} is not null`,
        dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) >= ${period}`,
        dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) < ${periodEnd}`,
      ),
    )
    .groupBy(timeEntries.userId)

  const userIds = rows.map((r) => r.userId)
  const ratesByUser = await loadRatesForUsers(userIds)
  return rows.map((r) => {
    const rate = effectiveRateFor(ratesByUser.get(r.userId) ?? [], period) ?? 0
    return { userId: r.userId, minutes: r.minutes, cost: Math.round((r.minutes / 60) * rate) }
  })
}
```

> Note: `inArray` is imported for future use by callers; the per-user map filter in `rates.ts` keeps the rate query simple. If your linter flags `inArray` as unused, remove it from the import.

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/time/profitability.test.ts`
Expected: revenue 250000, labour 20000, margin 230000, total/billable minutes 240 — all PASS, and the rollup row is persisted.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(time): per-client profitability compute (revenue - labour cost) + drill-down (tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Nightly Inngest cron — recompute current-period rollups

**Files:**
- Create: `src/inngest/functions/recompute-profitability.ts`
- Modify: `src/inngest/functions/index.ts` (register the function — create if Plan 04/06 has not)

The Founder's profitability view must be a cached read (PRD §11: no heavy compute on page render). A nightly Inngest cron recomputes the rollup for the current month for every client org. This runs under `service_role` (admin/jobs), never on a user request.

> This assumes the Inngest client (`src/lib/inngest/client.ts`) and the Next.js `serve` route handler exist from Plan 04/06 (the finance webhook fan-out introduced Inngest). The Inngest client and serve route are owned by Plan 1.5 - import `inngest` from `@/lib/inngest/client`; do NOT recreate them. Register the exported function in the array passed to `serve({ functions: [...] })`.

- [ ] **Step 1: Write `src/inngest/functions/recompute-profitability.ts`**

```ts
import { inngest } from '@/inngest/client'
import { db } from '@/db'
import { eq } from 'drizzle-orm'
import { organizations } from '@/db/schema'
import { computeProfitability } from '@/lib/time/profitability'

/** First day of the current month as 'YYYY-MM-01'. */
function currentPeriod(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/**
 * Nightly: recompute the current-month profitability rollup for every client org.
 * Cron at 02:30 UTC (after the day's time entries settle). service_role context.
 */
export const recomputeProfitability = inngest.createFunction(
  { id: 'recompute-profitability', name: 'Recompute per-client profitability (nightly)' },
  { cron: '30 2 * * *' },
  async ({ step }) => {
    const period = currentPeriod()
    const clientOrgs = await step.run('load-client-orgs', async () =>
      db.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, 'client')),
    )

    let computed = 0
    for (const org of clientOrgs) {
      await step.run(`compute-${org.id}`, async () => {
        await computeProfitability(org.id, period)
      })
      computed += 1
    }

    return { period, orgs: clientOrgs.length, computed }
  },
)
```

- [ ] **Step 2: Register the function in `src/inngest/functions/index.ts`**

If the file exists (Plan 04/06), add `recomputeProfitability` to the exported `functions` array; otherwise create:

```ts
import { recomputeProfitability } from './recompute-profitability'

// Spread any existing functions from earlier plans first, then append:
export const functions = [recomputeProfitability]
```

> If an array already exists, append `recomputeProfitability` to it rather than overwriting — keep Plan 04's `handleStripeEvent` and any sync jobs registered.

- [ ] **Step 3: Verify it type-checks and the cron expression is valid**

Run: `pnpm build`
Expected: build succeeds; the Inngest dev server (`pnpm dlx inngest-cli@latest dev`, if used locally) lists `recompute-profitability` with cron `30 2 * * *`. (No new unit test: `computeProfitability` is already covered by Task 5; this function is thin orchestration.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(time): nightly Inngest cron to recompute per-client profitability rollups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Reporting queries — timesheet, team reports, utilisation (`src/lib/time/reports.ts`) — TDD

**Files:**
- Create: `tests/time/reports.test.ts`
- Create: `src/lib/time/reports.ts`

Reports aggregate Plan 03 `time_entries`. **My-week timesheet:** one user's completed entries grouped by day for a 7-day window. **Team report:** minutes by user and by client for a period. **Utilisation** = logged minutes / capacity minutes (capacity = working days × hours/day × 60), per user.

- [ ] **Step 1: Write `tests/time/reports.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { utilisation, type UserMinutes } from '@/lib/time/reports'
import { teamReportByUser, timesheetForWeek } from '@/lib/time/reports'

describe('utilisation (pure)', () => {
  it('logged / capacity as a 0..1 ratio, rounded to 4 dp', () => {
    const logged: UserMinutes[] = [{ userId: 'u1', minutes: 1800 }] // 30h
    // capacity: 5 days * 8h * 60 = 2400 min
    const out = utilisation(logged, { workingDays: 5, hoursPerDay: 8 })
    expect(out[0]!.ratio).toBe(0.75)
  })

  it('caps at 1.0 when over capacity and is 0 for no logged time', () => {
    const out = utilisation([{ userId: 'u1', minutes: 3000 }], { workingDays: 5, hoursPerDay: 8 })
    expect(out[0]!.ratio).toBe(1)
    const none = utilisation([{ userId: 'u2', minutes: 0 }], { workingDays: 5, hoursPerDay: 8 })
    expect(none[0]!.ratio).toBe(0)
  })
})

describe('time reports (DB)', () => {
  let orgOne: string
  let founder: string
  let board: string
  let column: string
  let task: string

  beforeAll(async () => {
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    orgOne = o1!.id as string
    const [f] = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    founder = f!.id as string

    const [b] = await sql`insert into public.boards (organization_id, name) values (${orgOne}, 'Rpt') returning id`
    board = b!.id as string
    const [c] = await sql`insert into public.board_columns (organization_id, board_id, name, position) values (${orgOne}, ${board}, 'Doing', 0) returning id`
    column = c!.id as string
    const [t] = await sql`insert into public.tasks (organization_id, board_id, column_id, title, origin, created_by, position) values (${orgOne}, ${board}, ${column}, 'Task', 'agency', ${founder}, 0) returning id`
    task = t!.id as string

    await sql`
      insert into public.time_entries (organization_id, task_id, user_id, minutes, billable, source, started_at, ended_at)
      values
        (${orgOne}, ${task}, ${founder}, 120, true,  'manual', '2026-06-01T09:00:00Z', '2026-06-01T11:00:00Z'),
        (${orgOne}, ${task}, ${founder}, 60,  false, 'manual', '2026-06-02T09:00:00Z', '2026-06-02T10:00:00Z')`
  })

  afterAll(async () => {
    await sql`delete from public.time_entries where task_id = ${task}`
    await sql`delete from public.tasks where id = ${task}`
    await sql`delete from public.board_columns where id = ${column}`
    await sql`delete from public.boards where id = ${board}`
    await sql.end()
  })

  it('teamReportByUser sums minutes per user for the period', async () => {
    const rows = await teamReportByUser('2026-06-01', '2026-07-01')
    const me = rows.find((r) => r.userId === founder)
    expect(me?.minutes).toBe(180)
    expect(me?.billableMinutes).toBe(120)
  })

  it('timesheetForWeek returns the user\'s entries within the window', async () => {
    const rows = await timesheetForWeek(founder, '2026-06-01', '2026-06-08')
    const totalMin = rows.reduce((acc, r) => acc + r.minutes, 0)
    expect(totalMin).toBe(180)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/time/reports.test.ts`
Expected: FAIL — `@/lib/time/reports` not found.

- [ ] **Step 3: Implement `src/lib/time/reports.ts`**

```ts
import 'server-only'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { db } from '@/db'
import { timeEntries } from '@/db/schema'

export type UserMinutes = { userId: string; minutes: number }
export type Capacity = { workingDays: number; hoursPerDay: number }

/** Utilisation ratio (0..1) per user = logged minutes / capacity minutes, capped at 1. */
export function utilisation(logged: UserMinutes[], capacity: Capacity): Array<UserMinutes & { ratio: number }> {
  const capMinutes = capacity.workingDays * capacity.hoursPerDay * 60
  return logged.map((u) => {
    const raw = capMinutes <= 0 ? 0 : u.minutes / capMinutes
    const ratio = Math.min(1, Math.max(0, Math.round(raw * 10000) / 10000))
    return { ...u, ratio }
  })
}

/** Window predicate: completed entries (minutes IS NOT NULL) within [start, end). */
function inWindow(start: string, end: string) {
  return and(
    dsql`${timeEntries.minutes} is not null`,
    dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) >= ${start}`,
    dsql`coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}) < ${end}`,
  )
}

/** Team report: total + billable minutes per user across all client orgs in the period. */
export async function teamReportByUser(
  start: string,
  end: string,
): Promise<Array<{ userId: string; minutes: number; billableMinutes: number }>> {
  return db
    .select({
      userId: timeEntries.userId,
      minutes: dsql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
      billableMinutes: dsql<number>`coalesce(sum(${timeEntries.minutes}) filter (where ${timeEntries.billable}), 0)::int`,
    })
    .from(timeEntries)
    .where(inWindow(start, end))
    .groupBy(timeEntries.userId)
}

/** Team report: total minutes per client org in the period. */
export async function teamReportByClient(
  start: string,
  end: string,
): Promise<Array<{ organizationId: string; minutes: number }>> {
  return db
    .select({
      organizationId: timeEntries.organizationId,
      minutes: dsql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
    })
    .from(timeEntries)
    .where(inWindow(start, end))
    .groupBy(timeEntries.organizationId)
}

/** "My week": one user's completed entries grouped by day within [start, end). */
export async function timesheetForWeek(
  userId: string,
  start: string,
  end: string,
): Promise<Array<{ day: string; minutes: number; billableMinutes: number }>> {
  return db
    .select({
      day: dsql<string>`to_char(coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}), 'YYYY-MM-DD')`,
      minutes: dsql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
      billableMinutes: dsql<number>`coalesce(sum(${timeEntries.minutes}) filter (where ${timeEntries.billable}), 0)::int`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), inWindow(start, end)))
    .groupBy(dsql`to_char(coalesce(${timeEntries.startedAt}, ${timeEntries.createdAt}), 'YYYY-MM-DD')`)
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/time/reports.test.ts`
Expected: utilisation ratios 0.75/1/0 correct; team report 180 total / 120 billable; week total 180 — all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(time): timesheet/team/utilisation reporting queries (tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: UI — Timesheet, team reports, profitability, cost-rate admin + server actions

**Files:**
- Create: `src/app/(internal)/time/actions.ts`
- Create: `src/app/(internal)/time/page.tsx` (Timesheet — my week)
- Create: `src/app/(internal)/time/reports/page.tsx` (team reports + utilisation)
- Create: `src/app/(internal)/time/profitability/page.tsx` (Founder-only)
- Create: `src/app/(internal)/time/rates/page.tsx` (Founder-only)
- Create: `src/app/(internal)/time/_components/week-grid.tsx`
- Create: `src/app/(internal)/time/_components/utilisation-chart.tsx`
- Create: `src/app/(internal)/time/_components/margin-table.tsx`

All pages live under the internal `(internal)` shell (Plan 01) — clients never route here. Profitability and rates pages additionally redirect non-founders. Server actions use the RLS-scoped session helpers from Plan 01 (`getSession`, `isStaff`) for defense in depth.

- [ ] **Step 1: Server actions `src/app/(internal)/time/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { costRates, organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { computeProfitability } from '@/lib/time/profitability'

/** Set (or add an effective-dated) cost rate for a user. FOUNDER-ONLY. */
export async function setCostRate(formData: FormData): Promise<void> {
  const session = await getSession()
  if (session?.role !== 'founder') throw new Error('forbidden')

  const userId = String(formData.get('userId') ?? '')
  const rateMajor = Number(formData.get('rate') ?? 0)
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '')
  if (!userId || !effectiveFrom || !Number.isFinite(rateMajor)) throw new Error('invalid input')

  await db
    .insert(costRates)
    .values({ userId, rate: Math.round(rateMajor * 100), currency: 'gbp', effectiveFrom })
    .onConflictDoUpdate({
      target: [costRates.userId, costRates.effectiveFrom],
      set: { rate: Math.round(rateMajor * 100) },
    })

  revalidatePath('/time/rates')
  revalidatePath('/time/profitability')
}

/** Manually recompute the current-period rollups (Founder action). */
export async function recomputeNow(period: string): Promise<void> {
  const session = await getSession()
  if (session?.role !== 'founder') throw new Error('forbidden')

  const clientOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.type, 'client'))
  for (const org of clientOrgs) {
    await computeProfitability(org.id, period)
  }
  revalidatePath('/time/profitability')
}
```

- [ ] **Step 2: Timesheet page `src/app/(internal)/time/page.tsx`**

```tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { timesheetForWeek } from '@/lib/time/reports'
import { WeekGrid } from './_components/week-grid'

/** Current ISO week window [Mon, next Mon) in UTC. */
function weekWindow(now = new Date()): { start: string; end: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow)
  const start = d.toISOString().slice(0, 10)
  const endDate = new Date(d)
  endDate.setUTCDate(endDate.getUTCDate() + 7)
  return { start, end: endDate.toISOString().slice(0, 10) }
}

export default async function TimesheetPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const { start, end } = weekWindow()
  const days = await timesheetForWeek(session.userId, start, end)
  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">My Week</h1>
      <p className="text-sm text-muted-foreground">{start} → {end}</p>
      <WeekGrid days={days} />
    </section>
  )
}
```

- [ ] **Step 3: Week grid component `src/app/(internal)/time/_components/week-grid.tsx`**

```tsx
import { Card } from '@/components/ui/card'

function fmtHours(minutes: number): string {
  return (minutes / 60).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'h'
}

export function WeekGrid({
  days,
}: {
  days: Array<{ day: string; minutes: number; billableMinutes: number }>
}) {
  const total = days.reduce((acc, d) => acc + d.minutes, 0)
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">Day</th>
            <th className="py-1">Logged</th>
            <th className="py-1">Billable</th>
          </tr>
        </thead>
        <tbody>
          {days.length === 0 && (
            <tr><td colSpan={3} className="py-2 text-muted-foreground">No time logged this week.</td></tr>
          )}
          {days.map((d) => (
            <tr key={d.day} className="border-t">
              <td className="py-1">{d.day}</td>
              <td className="py-1">{fmtHours(d.minutes)}</td>
              <td className="py-1">{fmtHours(d.billableMinutes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="py-1">Total</td>
            <td className="py-1" colSpan={2}>{fmtHours(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  )
}
```

- [ ] **Step 4: Team reports page `src/app/(internal)/time/reports/page.tsx`**

```tsx
import { getSession, isStaff } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { teamReportByUser, utilisation } from '@/lib/time/reports'
import { UtilisationChart } from '../_components/utilisation-chart'

function monthWindow(now = new Date()): { start: string; end: string } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10)
  return { start, end }
}

export default async function TimeReportsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')

  const { start, end } = monthWindow()
  const rows = await teamReportByUser(start, end)
  // Default capacity: ~22 working days * 8h for the month.
  const util = utilisation(
    rows.map((r) => ({ userId: r.userId, minutes: r.minutes })),
    { workingDays: 22, hoursPerDay: 8 },
  )

  return (
    <section className="space-y-6">
      <h1 className="text-lg font-semibold">Team Time Reports</h1>
      <p className="text-sm text-muted-foreground">{start} → {end}</p>
      <UtilisationChart data={util} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">User</th><th className="py-1">Logged (h)</th><th className="py-1">Billable (h)</th><th className="py-1">Utilisation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = util.find((x) => x.userId === r.userId)
            return (
              <tr key={r.userId} className="border-t">
                <td className="py-1">{r.userId.slice(0, 8)}…</td>
                <td className="py-1">{(r.minutes / 60).toFixed(1)}</td>
                <td className="py-1">{(r.billableMinutes / 60).toFixed(1)}</td>
                <td className="py-1">{Math.round((u?.ratio ?? 0) * 100)}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 5: Utilisation chart `src/app/(internal)/time/_components/utilisation-chart.tsx`**

```tsx
'use client'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'

export function UtilisationChart({
  data,
}: {
  data: Array<{ userId: string; minutes: number; ratio: number }>
}) {
  const chart = data.map((d) => ({ user: d.userId.slice(0, 6), percent: Math.round(d.ratio * 100) }))
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart}>
          <XAxis dataKey="user" fontSize={12} />
          <YAxis domain={[0, 100]} unit="%" fontSize={12} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="percent" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 6: Profitability page `src/app/(internal)/time/profitability/page.tsx` (Founder-only)**

```tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { loadRollupsForPeriod } from '@/lib/time/profitability'
import { MarginTable } from '../_components/margin-table'

function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export default async function ProfitabilityPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'founder') redirect('/cockpit') // margin is Founder-only

  const period = currentPeriod()
  const rollups = await loadRollupsForPeriod(period)
  const clients = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.type, 'client'))
  const nameById = new Map(clients.map((c) => [c.id, c.name]))

  const rows = rollups.map((r) => ({
    organizationId: r.organizationId,
    name: nameById.get(r.organizationId) ?? r.organizationId.slice(0, 8),
    currency: r.currency,
    revenue: r.revenue,
    labourCost: r.labourCost,
    margin: r.margin,
  }))

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">Per-Client Profitability</h1>
      <p className="text-sm text-muted-foreground">Period {period} · revenue − labour cost</p>
      <MarginTable rows={rows} />
    </section>
  )
}
```

- [ ] **Step 7: Margin table `src/app/(internal)/time/_components/margin-table.tsx`**

```tsx
import { formatMoney } from '@/lib/finance/money'
import { Card } from '@/components/ui/card'

export function MarginTable({
  rows,
}: {
  rows: Array<{ organizationId: string; name: string; currency: string; revenue: number; labourCost: number; margin: number }>
}) {
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">Client</th><th className="py-1">Revenue</th><th className="py-1">Labour cost</th><th className="py-1">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={4} className="py-2 text-muted-foreground">No rollups for this period yet.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.organizationId} className="border-t">
              <td className="py-1">{r.name}</td>
              <td className="py-1">{formatMoney(r.revenue, r.currency)}</td>
              <td className="py-1">{formatMoney(r.labourCost, r.currency)}</td>
              <td className={`py-1 font-medium ${r.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatMoney(r.margin, r.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
```

- [ ] **Step 8: Cost-rate admin page `src/app/(internal)/time/rates/page.tsx` (Founder-only)**

```tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { costRates, profiles } from '@/db/schema'
import { setCostRate } from '../actions'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/finance/money'

export default async function RatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'founder') redirect('/cockpit') // cost rates are Founder-only

  const staff = await db.select({ id: profiles.id, email: profiles.email, fullName: profiles.fullName }).from(profiles)
  const rates = await db
    .select({ userId: costRates.userId, rate: costRates.rate, effectiveFrom: costRates.effectiveFrom, currency: costRates.currency })
    .from(costRates)

  return (
    <section className="space-y-6">
      <h1 className="text-lg font-semibold">Cost Rates (Founder-only)</h1>

      <Card className="p-4">
        <form action={setCostRate} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-muted-foreground">User</span>
            <select name="userId" className="rounded border p-2" required>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName ?? s.email}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Rate (£/hr)</span>
            <input name="rate" type="number" step="0.01" min="0" className="rounded border p-2" required />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Effective from</span>
            <input name="effectiveFrom" type="date" className="rounded border p-2" required />
          </label>
          <Button type="submit">Save rate</Button>
        </form>
      </Card>

      <Card className="p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground"><th className="py-1">User</th><th className="py-1">Rate/hr</th><th className="py-1">Effective from</th></tr>
          </thead>
          <tbody>
            {rates.length === 0 && (<tr><td colSpan={3} className="py-2 text-muted-foreground">No cost rates set.</td></tr>)}
            {rates.map((r) => (
              <tr key={`${r.userId}-${r.effectiveFrom}`} className="border-t">
                <td className="py-1">{r.userId.slice(0, 8)}…</td>
                <td className="py-1">{formatMoney(r.rate, r.currency)}</td>
                <td className="py-1">{r.effectiveFrom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
```

- [ ] **Step 9: Verify it builds**

Run: `pnpm build`
Expected: build succeeds with no type errors. (`Card`/`Button` are present from Plan 01's shadcn setup; `formatMoney` from Plan 04.)

- [ ] **Step 10: Manual smoke test**

Run: `pnpm dev`
1. Sign in as `founder@milktreeagency.com` → visit `/time` (my week), `/time/reports` (team + utilisation chart), `/time/profitability` (margin table), `/time/rates` (set a rate).
2. On `/time/rates`, save a rate; confirm it appears in the table below.
3. Sign in as `user1@clientone.com` (client) → visiting `/time/profitability` or `/time/rates` redirects away from the internal shell (Plan 01 portal/internal split + the founder-only redirect).

Expected: all behave as described; clients never reach internal time pages.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(time): timesheet, team reports, profitability + cost-rate admin UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests green, including the new `tests/time/*` (rates, profitability, reports) and `tests/rls/*` (cost_rates founder-only, profitability client-zero-access), plus all prior plans' tests (RLS isolation from Plans 01/03/04 still pass — no schema regressions).

- [ ] **Step 2: Lint + build to mirror CI**

Run: `pnpm lint && pnpm build`
Expected: lint clean; build succeeds.

- [ ] **Step 3: Commit (if lint auto-fixed anything)**

```bash
git add -A
git commit -m "chore(time): lint/build clean for time-profitability module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" --allow-empty
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.9 Time Tracking & Profitability and §8 Data Model):**
- `cost_rate` per user with `effective_from`, Founder-only visibility → `cost_rates` table (Task 1) + `is_founder()` helper & policies (Task 3) + role-guard tests (Tasks 2–3) + effective-rate resolver (Task 4) + admin UI (Task 8). ✅
- `profitability_rollup` (derived) → `profitability_rollups` table (Task 1) + compute/persist (Task 5) + nightly recompute (Task 6). ✅
- Profitability = client revenue (retainer MRR + one-off from Plan 04) − Σ(hours × cost rate) for the period, with drill-down → `computeProfitability` + `profitabilityDrilldown` (Task 5) reusing Plan 04 `subscriptions`/`invoices`. ✅
- Timesheet (my week) → `timesheetForWeek` + `WeekGrid` (Tasks 7–8). ✅
- Team reports (by user/client/period) → `teamReportByUser` / `teamReportByClient` (Task 7) + reports page (Task 8). ✅
- Utilisation → `utilisation()` (Task 7) + chart (Task 8). ✅
- Hours feed profitability + reports; invoices stay MANUAL (no auto hours→invoice) → this plan adds ZERO invoice-creation paths; it only reads Plan 04 revenue. ✅ (PRD §5.9 owner decision honoured.)
- Clients have ZERO access to time/cost data → time_entries already client-zero (Plan 03); this plan's `cost_rates` (founder-only) and `profitability_rollups` (staff-only, client-zero) RLS tested in Task 2–3. ✅
- Cost rates visible only to the Founder → `is_founder()` column/row-level role guard, proven a TEAM member sees zero rows and cannot insert (Task 2 test). ✅
- §8 field names: `cost_rate (user_id, rate, effective_from)` and `profitability_rollup` derived → matched (`costRates`, `profitabilityRollups`); revenue/cost columns are additive derived fields, consistent with "derived". ✅

**Shared-conventions coverage:**
- Tenant-leading composite index on every tenant-scoped table: `profitability_rollups` → `idx_profitability_org_period (organization_id, period)`; `cost_rates` is person-level (not client-tenant-scoped) and leads its index with `user_id` (the scoping dimension), guarded by `is_founder()`. ✅
- RLS enabled + policies reuse Plan 01 `has_org_access`/`is_agency_staff` (and add `is_founder()` following the same SECURITY DEFINER/STABLE/`set search_path` pattern). ✅
- RLS isolation test for every new tenant-scoped table, using the Plan 01 harness `tests/helpers/db.ts` (`asUser()`): `cost_rates_isolation.test.ts` + `profitability_isolation.test.ts`. ✅
- `service_role` only for jobs (the nightly Inngest recompute), never user-facing — user pages use the RLS-scoped session/server client; the recompute action also guards `role === 'founder'` in app code (defense in depth). ✅
- Canonical schema names from §8 used exactly; Plan 01 enums/tables/functions not redefined. ✅
- Plan format matches Plan 01: header block (For-agentic-workers line, Goal, Architecture, Tech Stack), File Structure, `## Task N` with **Files:** lists and strict-TDD checkbox steps (failing test → run/expected failure → minimal impl → run/PASS → commit), complete code in every step, Self-Review at the end. ✅

**Placeholder scan:** No TBD/TODO/"similar to above". Every code step contains complete, runnable code. The only conditional instructions are explicit environment branches (register Inngest function if the index exists; add `date` to the import if missing) — not code placeholders. The `inArray` import note in Task 5 is an explicit lint instruction, not an omission. ✅

**Type consistency:** `DatedRate` shared between `rates.ts` and `profitability.ts`; `EntryForCost`/`ProfitabilityResult` consistent across `profitability.ts` and its test; `UserMinutes`/`Capacity` consistent across `reports.ts` and its test; minor-units convention (integer pence) consistent with Plan 04 (`formatMoney`, `subscriptions.amount`, `invoices.amountPaid`); enum literals (`subscriptions.status='active'`, `invoices.type='one_off'`, `invoices.status='paid'`) match Plan 04's `pgEnum` definitions exactly; `is_founder()` name consistent between migration and any future callers; `getSession`/`isStaff` reused from Plan 01 `src/lib/auth.ts`. ✅

**Definition of done for Plan 14:** `pnpm lint && pnpm test && pnpm build` green — new unit tests (rates/profitability/reports), new RLS role-guard tests (cost_rate founder-only; profitability client-zero-access), and all prior plans' suites pass; the manual smoke test in Task 8 confirms the Founder sees timesheet/reports/profitability/rates while clients are fully excluded from time/cost data.
