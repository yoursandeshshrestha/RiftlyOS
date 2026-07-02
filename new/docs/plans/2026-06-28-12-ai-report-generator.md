# Agency OS — Plan 12: AI Monthly Report Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **AI Monthly Report Generator** (PRD §7) — the Plane B AI layer that, at month-end, runs one **tenant-isolated** Inngest job **per retainer client** that gathers **pre-aggregated rows already in our store** (never live external APIs): tasks completed, key metric movements (MoM/YoY), channel performance, leads, spend/ROAS, and local visibility. A model-routed Anthropic pipeline (**`claude-haiku-4-5`** classifies which sections have signal, **`claude-sonnet-4-6`** drafts each section, **`claude-opus-4-8`** synthesises the final narrative) writes "what we did → how the numbers moved (plain English + caveats) → the plan for next month", with **prompt caching** on the shared system/template prompt and the **Batch API** for the monthly fan-out. The narrative is rendered to **PDF** (`@react-pdf/renderer`), stored in **Supabase Storage** behind a signed URL, **emailed via Resend**, and archived in a new tenant-scoped `report` table surfaced in the client portal. A per-client **"draft → review → send"** toggle gates auto-send. We test the gather step (correct, tenant-scoped rows), tenant scoping (the worker only ever sees one client's data per run, proven by RLS), and that **the narrative's numbers match the stored rows exactly** (a deterministic facts contract the model may not invent).

**Architecture:** This is Plane B (PRD §6.1) — the AI layer reads **our already-synced, tenant-scoped database**, not live ad APIs. One new tenant-scoped table, `report` (PRD §8: `client_id`/`organization_id`, `period`, `status`, `pdf_url`, `generated_at`, `model_used`), carries `organization_id` as the leading column of a composite index and is protected by RLS reusing the Plan 01 helpers `public.has_org_access(uuid)` and `public.is_agency_staff()` (clients read **own** reports — but only once `sent`; staff read/write all). The **gather step** (`gatherReportData`) is a pure server-side read that takes exactly one `organizationId` and assembles a strongly-typed `ReportFacts` object from Plan 06's `metric_monthly_rollup` (channel/spend/leads/local) and the retainer/subscription + task tables (Plans 03/04). Every number the narrative is allowed to state lives in `ReportFacts`; a **facts-contract check** re-derives the figures cited in the model output and fails the run if any cited number is absent from `ReportFacts` (the data-trust gate, PRD §7 acceptance "metric movements match the dashboard exactly"). The **Anthropic pipeline** (`src/lib/reports/ai/*`) is model-routed and provider-abstracted behind a thin `anthropic` client wrapper so prompt caching + Batch API are configured in one place. The **Inngest orchestration** is a monthly cron that fans out one `reports/client.generate` event per active retainer org (bounded concurrency), and a per-client function that runs gather → AI → facts-contract → PDF → Storage → (auto-send or hold for review) → archive. **Tenant isolation is enforced in the worker**: the event payload carries a single `organizationId`, every DB read is filtered by it, and the AI pipeline is given only that org's `ReportFacts` — never a cross-tenant query. A `service_role` server context performs the writes (jobs only; never user-facing). Email uses Resend + `@react-email/components` (the convention established in Plan 05). PDF rendering uses `@react-pdf/renderer` server-side.

**Tech Stack:** Next.js 16 (App Router, route handlers + Server Components) · TypeScript strict · pnpm · Supabase Postgres + RLS + **Storage** · Drizzle ORM + drizzle-kit · postgres.js · **`@anthropic-ai/sdk`** (`claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5`, prompt caching + Message Batches API) · **`@react-pdf/renderer`** · **Resend** + `@react-email/components` · Inngest (monthly cron + per-client fan-out, retries) · Tailwind + shadcn/ui · Vitest (unit + RLS isolation + gather/facts-contract tests).

**Prerequisites the developer needs installed/configured:** Everything from Plan 01 (local Supabase running, seed applied) and the migrations from **Plan 06** (integration framework: `connection`, `metric_daily`, `metric_monthly_rollup`, the Inngest client at `src/lib/inngest/client.ts`, the serve route at `src/app/api/inngest/route.ts`, and the Resend client at `src/lib/email/resend.ts`), **Plan 11** (Analytics aggregator — monthly rollups populated per client; this plan reads its output, does not re-spec it), **Plan 03** (`tasks`, `board_columns` with a `Done` column), and **Plan 04** (`subscriptions`/retainers, `customers`). Plus an `ANTHROPIC_API_KEY` and the Inngest dev server (`pnpm dlx inngest-cli@latest dev`). Add a Supabase Storage bucket `reports` (private).

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                                  # MODIFY: + report table + reportStatus enum
│  │  └─ types.ts                                   # MODIFY: + Report / NewReport / ReportStatus types
│  ├─ lib/
│  │  └─ reports/
│  │     ├─ types.ts                                # ReportFacts contract (the only numbers the AI may cite)
│  │     ├─ gather.ts                               # gatherReportData(orgId, period) -> ReportFacts (tenant-scoped read)
│  │     ├─ facts-contract.ts                       # extractCitedNumbers + assertFactsContract (data-trust gate)
│  │     ├─ period.ts                               # period helpers (prevMonth, monthStart, label)
│  │     ├─ storage.ts                              # uploadReportPdf + signedReportUrl (Supabase Storage)
│  │     ├─ ai/
│  │     │  ├─ client.ts                            # anthropic client + MODELS routing constants
│  │     │  ├─ prompts.ts                           # cached system prompt + section/synthesis prompts
│  │     │  ├─ classify.ts                          # haiku-4-5: which sections have signal
│  │     │  ├─ draft.ts                             # sonnet-4-6: draft each section
│  │     │  └─ synthesize.ts                        # opus-4-8: final narrative (JSON ReportNarrative)
│  │     ├─ pdf/
│  │     │  └─ ReportDocument.tsx                    # @react-pdf/renderer document + renderReportPdf()
│  │     └─ email/
│  │        └─ ReportReadyEmail.tsx                 # React Email template
│  ├─ app/
│  │  ├─ api/inngest/route.ts                       # MODIFY: register the two report functions
│  │  └─ (internal)/clients/[clientId]/reports/
│  │     └─ actions.ts                              # server actions: toggle autoSend, approve+send a draft
│  └─ lib/inngest/functions/
│     ├─ report-scheduler.ts                        # monthly cron: fan out one event per active retainer org
│     └─ generate-report.ts                         # per-client: gather -> AI -> contract -> PDF -> store -> send/hold -> archive
├─ drizzle/
│  ├─ 12xx_report_table.sql                         # generated (report table + enum)
│  └─ 12xx_report_rls.sql                           # custom (RLS policies + storage bucket policy)
└─ tests/
   ├─ rls/report-isolation.test.ts                  # RLS isolation for the report table (KEYSTONE)
   └─ reports/
      ├─ period.test.ts                             # period math
      ├─ gather.test.ts                             # gather assembles correct, tenant-scoped facts
      ├─ facts-contract.test.ts                     # narrative numbers must exist in ReportFacts
      └─ generate-e2e.test.ts                       # end-to-end with a fake AI: one client per run, archived report
```

---

## Task 1: Schema — the `report` table + `report_status` enum

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/12xx_report_table.sql` (generated)

The `report` table is new (PRD §8 lists it; no earlier plan created it). It is tenant-scoped on `organization_id` (the **client** org), one row per `(organization_id, period)`, with `organization_id` as the leading column of its composite index (PRD §9 performance rule).

- [ ] **Step 1: Append the enum + table to `src/db/schema.ts`**

`organizations` is already in scope from Plan 01 in the same file; reference it directly (do not re-import). The `drizzle-orm/pg-core` helpers used here (`pgTable, pgEnum, uuid, text, timestamp, date, jsonb, index, unique`) are already imported by Plan 01/06 — add any missing ones to the existing import block; do not add a second import statement.

```ts
// ---------------------------------------------------------------------------
// Plan 12: AI Monthly Report Generator
// ---------------------------------------------------------------------------

// Lifecycle of a monthly report (PRD §7 "draft -> review -> send").
//   draft     : generated, awaiting human review (autoSend off)
//   review    : explicitly opened/edited by staff (optional intermediate)
//   sent      : emailed + visible to the client in the portal
//   failed    : generation/contract/render error; staff can retry
export const reportStatus = pgEnum('report_status', ['draft', 'review', 'sent', 'failed'])

// report: one AI monthly report per (client org, period). PRD §7 / §8.
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // First day of the reported month, 'YYYY-MM-01' (the period the report covers).
    period: date('period').notNull(),
    status: reportStatus('status').notNull().default('draft'),
    // The structured narrative the model produced (sections + the facts it was allowed to cite).
    // Persisted so the portal can render it and the PDF can be re-rendered without re-calling the model.
    narrative: jsonb('narrative').$type<unknown>(),
    // Supabase Storage object path (tenant-prefixed); downloads use signed URLs.
    pdfPath: text('pdf_path'),
    modelUsed: text('model_used'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule)
    idxOrgPeriod: index('idx_reports_org_period').on(t.organizationId, t.period),
    // one report per client per month (the generator upserts on this)
    uniqOrgPeriod: unique('uniq_reports_org_period').on(t.organizationId, t.period),
  }),
)
```

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type { reports } from './schema'

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type ReportStatus = Report['status']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/12xx_report_table.sql` is created containing the `report_status` enum and the `reports` table with its composite index + unique constraint.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Then verify:
```bash
psql "$DATABASE_URL" -c "\dt public.reports"
```
Expected: `reports` is listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): report table + report_status enum (AI monthly report)"
```

---

## Task 2: KEYSTONE — RLS isolation test for `reports` (FAIL first), then policies + Storage bucket → PASS

**Files:**
- Create: `tests/rls/report-isolation.test.ts`
- Create: `drizzle/12xx_report_rls.sql` (custom SQL migration)

RLS is not enabled on `reports` yet, so a client user can currently read every tenant's reports. We write the isolation test first, confirm it FAILS, then enable RLS to make it PASS. This reuses the Plan 01 harness (`tests/helpers/db.ts` — `asUser()`/`sql`). Per PRD §7, a client should only ever see **their own** reports, and only once `status = 'sent'` (drafts are internal until reviewed/sent).

- [ ] **Step 1: Write the failing isolation test `tests/rls/report-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('report table tenant isolation (RLS)', () => {
  let clientOneUser: string
  let founder: string
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    founder = await userIdByEmail('founder@milktreeagency.com')

    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    // Setup as service_role (the raw sql connection bypasses RLS). Idempotent.
    // org one has a SENT report; org two has a SENT report; org one also has a DRAFT.
    await sql`
      insert into public.reports (organization_id, period, status, generated_at)
      values (${orgOne}, '2026-05-01', 'sent', now())
      on conflict on constraint uniq_reports_org_period do update set status = 'sent'`
    await sql`
      insert into public.reports (organization_id, period, status, generated_at)
      values (${orgTwo}, '2026-05-01', 'sent', now())
      on conflict on constraint uniq_reports_org_period do update set status = 'sent'`
    await sql`
      insert into public.reports (organization_id, period, status, generated_at)
      values (${orgOne}, '2026-04-01', 'draft', now())
      on conflict on constraint uniq_reports_org_period do update set status = 'draft'`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client user sees ONLY their own org sent reports', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id, status from public.reports order by period`,
    )
    // Every visible row belongs to org one.
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
    // The other client's report never leaks.
    expect(rows.some((r) => r.organization_id === orgTwo)).toBe(false)
  })

  it('a client user does NOT see their own DRAFT reports (drafts are internal until sent)', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select status from public.reports where status = 'draft'`,
    )
    expect(rows.length).toBe(0)
  })

  it('agency staff (founder) sees ALL reports including drafts', async () => {
    const rows = await asUser(founder, (tx) => tx`select organization_id from public.reports`)
    const orgs = new Set(rows.map((r) => r.organization_id))
    expect(orgs.has(orgOne)).toBe(true)
    expect(orgs.has(orgTwo)).toBe(true)
  })

  it('a client user cannot INSERT a report (writes are staff/service only)', async () => {
    await expect(
      asUser(
        clientOneUser,
        (tx) =>
          tx`insert into public.reports (organization_id, period, status) values (${orgOne}, '2026-03-01', 'draft')`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/rls/report-isolation.test.ts`
Expected: FAIL — with RLS off, the client user sees org two's report and its own draft, and the client INSERT succeeds. This proves the test is real.

- [ ] **Step 3: Commit the failing test**

```bash
git add -A
git commit -m "test(rls): report tenant-isolation tests (failing — RLS not enabled)"
```

- [ ] **Step 4: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=report_rls`
Expected: an empty `drizzle/12xx_report_rls.sql` registered in the journal.

- [ ] **Step 5: Fill in `drizzle/12xx_report_rls.sql`**

We reuse the Plan 01 helpers `public.has_org_access(uuid)` (staff OR member of the org) and `public.is_agency_staff()`. Clients read their **own** reports **only when `status = 'sent'`**; staff read/write all; writes are staff-only (the generator runs under `service_role`, which bypasses RLS). We also create the private `reports` Storage bucket and a Storage RLS policy so a client can read only their own org's PDF objects (objects are keyed `{organization_id}/...`).

```sql
-- Enable RLS on the report table.
alter table public.reports enable row level security;

-- Clients read their OWN org reports, but only once sent. Staff see everything.
create policy reports_select on public.reports
  for select using (
    public.is_agency_staff()
    or (public.has_org_access(organization_id) and status = 'sent')
  );

-- Only agency staff may write reports (the generator job uses service_role and
-- bypasses RLS; this is defense in depth for any non-service path).
create policy reports_write on public.reports
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ---------------------------------------------------------------------------
-- Supabase Storage: private 'reports' bucket + tenant-scoped read policy.
-- Object key convention: '{organization_id}/{period}.pdf'. The first path
-- segment is the tenant id; a client may read an object only if it belongs to
-- an org they can access. Uploads/writes happen under service_role (jobs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

create policy reports_storage_read on storage.objects
  for select using (
    bucket_id = 'reports'
    and (
      public.is_agency_staff()
      or public.has_org_access(((storage.foldername(name))[1])::uuid)
    )
  );
```

- [ ] **Step 6: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `12xx_report_rls.sql` with no errors (the bucket insert is idempotent).

- [ ] **Step 7: Run the isolation test and confirm it PASSES**

Run: `pnpm test tests/rls/report-isolation.test.ts`
Expected: all four tests PASS — the client sees only its own `sent` report, never the draft, never org two's; the founder sees all; the client INSERT is rejected.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(security): RLS + Storage policies for reports (isolation tests pass)"
```

---

## Task 3: Period helpers (TDD)

**Files:**
- Create: `tests/reports/period.test.ts`
- Create: `src/lib/reports/period.ts`

The generator runs **a few days into the new month** for data completeness (PRD §7), so it always reports the **previous** calendar month. We centralise month math (UTC, to match Plan 06's `monthStart`) so the cron, gather step, rollup keys, and PDF label all agree.

- [ ] **Step 1: Write the failing test `tests/reports/period.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { monthStart, prevMonthStart, monthLabel, yoyMonthStart } from '@/lib/reports/period'

describe('report period helpers', () => {
  it('monthStart returns the first day of the UTC month', () => {
    expect(monthStart(new Date('2026-06-29T13:00:00Z'))).toBe('2026-06-01')
    expect(monthStart(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01-01')
  })

  it('prevMonthStart returns the previous month (the reported period)', () => {
    expect(prevMonthStart(new Date('2026-06-05T05:00:00Z'))).toBe('2026-05-01')
    // January rolls back to the prior December.
    expect(prevMonthStart(new Date('2026-01-05T05:00:00Z'))).toBe('2025-12-01')
  })

  it('yoyMonthStart returns the same month one year earlier', () => {
    expect(yoyMonthStart('2026-05-01')).toBe('2025-05-01')
    expect(yoyMonthStart('2026-01-01')).toBe('2025-01-01')
  })

  it('monthLabel renders a human month + year', () => {
    expect(monthLabel('2026-05-01')).toBe('May 2026')
    expect(monthLabel('2025-12-01')).toBe('December 2025')
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/reports/period.test.ts`
Expected: FAIL — `@/lib/reports/period` does not exist.

- [ ] **Step 3: Implement `src/lib/reports/period.ts`**

```ts
/** First day of the UTC month containing `d`, as 'YYYY-MM-01'. */
export function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** First day of the month BEFORE the one containing `d` (the reported period). */
export function prevMonthStart(d: Date): string {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  return monthStart(prev)
}

/** First day of the month BEFORE `month` ('YYYY-MM-01'), for MoM comparisons. */
export function momMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const prev = new Date(Date.UTC(y!, m! - 2, 1)) // m is 1-based; -2 = previous month, 0-based
  return monthStart(prev)
}

/** Same month one year earlier ('YYYY-MM-01'), for YoY comparisons. */
export function yoyMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y! - 1}-${String(m).padStart(2, '0')}-01`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** 'YYYY-MM-01' -> 'May 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m! - 1]} ${y}`
}
```

- [ ] **Step 4: Run it and confirm PASS**

Run: `pnpm test tests/reports/period.test.ts`
Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reports): period helpers (prev/MoM/YoY month, label)"
```

---

## Task 4: The `ReportFacts` contract + tenant-scoped gather step (TDD)

**Files:**
- Create: `src/lib/reports/types.ts`
- Create: `tests/reports/gather.test.ts`
- Create: `src/lib/reports/gather.ts`

`ReportFacts` is the **single source of truth** for every number the AI is allowed to state. The gather step takes exactly **one** `organizationId` and reads **only** pre-aggregated rows from our store: channel/spend/leads/local from Plan 06's `metric_monthly_rollup` (populated by Plan 11), retainer MRR from Plan 04's `subscriptions`, and tasks completed from Plan 03's `tasks`/`board_columns`. **No live external API is touched** (PRD §7). Tenant isolation is enforced in code: every query is filtered by the passed `organizationId`.

- [ ] **Step 1: Define the facts contract `src/lib/reports/types.ts`**

```ts
import type { IntegrationProvider } from '@/db/types'

/** A single metric with its current value and prior-period comparisons. */
export interface MetricMovement {
  metric: string // e.g. 'sessions', 'cost', 'leads', 'conversions'
  current: number
  priorMonth: number | null // MoM comparison (same metric, previous month)
  priorYear: number | null // YoY comparison (same metric, same month last year)
  momPct: number | null // ((current - priorMonth) / priorMonth) * 100, null if base 0/absent
  yoyPct: number | null
  isProvisional: boolean // true if any underlying daily row was provisional (data-trust, PRD §6.5)
}

/** One channel's grouped movements (PRD §5.6 channels). */
export interface ChannelFacts {
  provider: IntegrationProvider
  label: string // human label, e.g. 'Website (GA4)', 'Google Ads'
  movements: MetricMovement[]
}

/** Everything the report may state. The AI receives ONLY this object. */
export interface ReportFacts {
  organizationId: string
  clientName: string
  period: string // 'YYYY-MM-01'
  periodLabel: string // 'May 2026'
  // Operational delivery (Plan 03).
  tasksCompleted: number
  // Commercial (Plan 04).
  retainerMrr: number // minor units (gbp), sum of active subscriptions
  retainerCurrency: string
  // Performance (Plan 06 metric_monthly_rollup, populated by Plan 11).
  channels: ChannelFacts[]
  leadsTotal: number // sum across lead-bearing providers for the month
  spendTotal: number // sum of 'cost' across ad providers, minor units
  roas: number | null // blended conversions_value / cost, null if no spend
  // Whether the metrics store was empty for this period (drives an honest "no data yet" report).
  hasPerformanceData: boolean
  // A freshness/caveat flag if any movement was provisional.
  anyProvisional: boolean
}
```

- [ ] **Step 2: Write the failing gather test `tests/reports/gather.test.ts`**

Seeds two client orgs with monthly-rollup rows (and one cross-org row that must NOT leak), a completed task, and an active retainer; asserts the assembled `ReportFacts` is correct and tenant-scoped. Setup uses the raw `sql` connection (service_role, RLS bypassed).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, userIdByEmail } from '../helpers/db'
import { gatherReportData } from '@/lib/reports/gather'

describe('gatherReportData (tenant-scoped, store-only)', () => {
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    await userIdByEmail('founder@milktreeagency.com') // ensures seed ran
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    // ---- metric_monthly_rollup: May 2026 (reported), April 2026 (MoM), May 2025 (YoY) ----
    // org one GA4 sessions: 1200 (May), 1000 (April), 800 (May last year)
    const rows: Array<[string, string, string, string, string, string, number]> = [
      [orgOne, 'ga4', 'acct-1', 'property', '2026-05-01', 'sessions', 1200],
      [orgOne, 'ga4', 'acct-1', 'property', '2026-04-01', 'sessions', 1000],
      [orgOne, 'ga4', 'acct-1', 'property', '2025-05-01', 'sessions', 800],
      // org one Google Ads spend + value + leads (May)
      [orgOne, 'google_ads', 'cust-1', 'account', '2026-05-01', 'cost', 50000],
      [orgOne, 'google_ads', 'cust-1', 'account', '2026-05-01', 'conversions_value', 200000],
      [orgOne, 'google_ads', 'cust-1', 'account', '2026-05-01', 'leads', 30],
      // org TWO data that MUST NOT leak into org one's facts
      [orgTwo, 'ga4', 'acct-2', 'property', '2026-05-01', 'sessions', 99999],
      [orgTwo, 'google_ads', 'cust-2', 'account', '2026-05-01', 'leads', 7],
    ]
    for (const [org, provider, acct, entity, month, metric, value] of rows) {
      await sql`
        insert into public.metric_monthly_rollup
          (organization_id, provider, account_id, entity, month, metric, value)
        values (${org}, ${provider}, ${acct}, ${entity}, ${month}::date, ${metric}, ${value})
        on conflict on constraint metric_monthly_rollup_pk
        do update set value = excluded.value`
    }

    // ---- an active retainer for org one (Plan 04) ----
    await sql`
      insert into public.subscriptions (organization_id, provider, amount, currency, interval, status)
      values (${orgOne}, 'stripe', 120000, 'gbp', 'month', 'active')
      on conflict do nothing`

    // ---- a Done board column + a task moved to Done, updated within the reported month (Plan 03) ----
    await sql`
      insert into public.boards (id, organization_id, name)
      values ('00000000-0000-0000-0000-0000000b0001', ${orgOne}, 'Client One Board')
      on conflict (id) do nothing`
    await sql`
      insert into public.board_columns (id, organization_id, board_id, name, position, is_intake)
      values ('00000000-0000-0000-0000-0000000c0001', ${orgOne},
              '00000000-0000-0000-0000-0000000b0001', 'Done', 3, false)
      on conflict (id) do nothing`
    const founderId = await userIdByEmail('founder@milktreeagency.com')
    await sql`
      insert into public.tasks
        (id, organization_id, board_id, column_id, title, position, origin, created_by, updated_at)
      values ('00000000-0000-0000-0000-0000000d0001', ${orgOne},
              '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000c0001',
              'Shipped homepage hero', 0, 'agency', ${founderId}, '2026-05-20T10:00:00Z')
      on conflict (id) do update set updated_at = '2026-05-20T10:00:00Z'`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('assembles facts for ONLY the passed org (no cross-tenant leak)', async () => {
    const facts = await gatherReportData(orgOne, '2026-05-01')
    expect(facts.organizationId).toBe(orgOne)
    expect(facts.period).toBe('2026-05-01')
    expect(facts.periodLabel).toBe('May 2026')

    // No org-two number (99999 sessions / 7 leads) appears anywhere.
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('99999')
    expect(facts.leadsTotal).toBe(30) // org one leads only
  })

  it('computes MoM and YoY movements for GA4 sessions', async () => {
    const facts = await gatherReportData(orgOne, '2026-05-01')
    const ga4 = facts.channels.find((c) => c.provider === 'ga4')!
    const sessions = ga4.movements.find((m) => m.metric === 'sessions')!
    expect(sessions.current).toBe(1200)
    expect(sessions.priorMonth).toBe(1000)
    expect(sessions.priorYear).toBe(800)
    expect(sessions.momPct).toBeCloseTo(20, 5) // (1200-1000)/1000
    expect(sessions.yoyPct).toBeCloseTo(50, 5) // (1200-800)/800
  })

  it('computes spend, ROAS, retainer MRR, and tasks completed', async () => {
    const facts = await gatherReportData(orgOne, '2026-05-01')
    expect(facts.spendTotal).toBe(50000)
    expect(facts.roas).toBeCloseTo(4, 5) // 200000 / 50000
    expect(facts.retainerMrr).toBe(120000)
    expect(facts.retainerCurrency).toBe('gbp')
    expect(facts.tasksCompleted).toBe(1)
    expect(facts.hasPerformanceData).toBe(true)
  })

  it('returns an honest empty report when the store has no rows for the period', async () => {
    const facts = await gatherReportData(orgTwo, '2024-01-01')
    expect(facts.hasPerformanceData).toBe(false)
    expect(facts.channels).toEqual([])
    expect(facts.leadsTotal).toBe(0)
    expect(facts.roas).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and confirm it FAILS**

Run: `pnpm test tests/reports/gather.test.ts`
Expected: FAIL — `@/lib/reports/gather` does not exist.

- [ ] **Step 4: Implement `src/lib/reports/gather.ts`**

```ts
import { db } from '@/db'
import { metricMonthlyRollup, subscriptions, tasks, boardColumns, organizations } from '@/db/schema'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { IntegrationProvider } from '@/db/types'
import type { ChannelFacts, MetricMovement, ReportFacts } from './types'
import { monthLabel, momMonthStart, yoyMonthStart } from './period'

// Human labels per provider for the report (PRD §5.6 channel grouping).
const PROVIDER_LABEL: Partial<Record<IntegrationProvider, string>> = {
  ga4: 'Website (GA4)',
  gsc: 'Search (Search Console)',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  gbp: 'Local (Google Business Profile)',
}

// Providers whose 'leads' metric counts toward the unified lead total (PRD §5.7
// excludes GA4/GBP modeled signals from the contact-bearing count).
const LEAD_PROVIDERS: IntegrationProvider[] = ['google_ads', 'meta_ads', 'web_form', 'callrail', 'whatconverts']
// Ad providers whose 'cost' contributes to total spend.
const SPEND_PROVIDERS: IntegrationProvider[] = ['google_ads', 'meta_ads']

type RollupRow = { provider: IntegrationProvider; metric: string; value: number }

function pct(current: number, base: number | null): number | null {
  if (base === null || base === 0) return null
  return ((current - base) / base) * 100
}

/**
 * Gather all pre-aggregated facts for ONE client org and ONE month from our
 * store (PRD §7). No live external API is called. Tenant isolation is enforced
 * by filtering every query on `organizationId`.
 */
export async function gatherReportData(organizationId: string, period: string): Promise<ReportFacts> {
  const momMonth = momMonthStart(period)
  const yoyMonth = yoyMonthStart(period)

  // Client display name (Plan 01 organizations).
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
  const clientName = org?.name ?? 'Client'

  // Pull the three months (current, MoM, YoY) of monthly rollups for this org only.
  async function pullMonth(month: string): Promise<RollupRow[]> {
    const rows = await db
      .select({
        provider: metricMonthlyRollup.provider,
        metric: metricMonthlyRollup.metric,
        value: metricMonthlyRollup.value,
      })
      .from(metricMonthlyRollup)
      .where(and(eq(metricMonthlyRollup.organizationId, organizationId), eq(metricMonthlyRollup.month, month)))
    // Sum across accounts/entities per (provider, metric); value is numeric -> string.
    const agg = new Map<string, RollupRow>()
    for (const r of rows) {
      const key = `${r.provider}::${r.metric}`
      const prev = agg.get(key)
      const v = Number(r.value)
      if (prev) prev.value += v
      else agg.set(key, { provider: r.provider, metric: r.metric, value: v })
    }
    return [...agg.values()]
  }

  const [cur, mom, yoy] = await Promise.all([pullMonth(period), pullMonth(momMonth), pullMonth(yoyMonth)])
  const momIdx = new Map(mom.map((r) => [`${r.provider}::${r.metric}`, r.value]))
  const yoyIdx = new Map(yoy.map((r) => [`${r.provider}::${r.metric}`, r.value]))

  // Group current-month rows by provider into channel facts.
  const byProvider = new Map<IntegrationProvider, MetricMovement[]>()
  for (const r of cur) {
    const key = `${r.provider}::${r.metric}`
    const priorMonth = momIdx.get(key) ?? null
    const priorYear = yoyIdx.get(key) ?? null
    const movement: MetricMovement = {
      metric: r.metric,
      current: r.value,
      priorMonth,
      priorYear,
      momPct: pct(r.value, priorMonth),
      yoyPct: pct(r.value, priorYear),
      isProvisional: false, // monthly rollups are settled; daily provisional flags are not carried up
    }
    const list = byProvider.get(r.provider) ?? []
    list.push(movement)
    byProvider.set(r.provider, list)
  }

  const channels: ChannelFacts[] = [...byProvider.entries()]
    .map(([provider, movements]) => ({
      provider,
      label: PROVIDER_LABEL[provider] ?? provider,
      movements: movements.sort((a, b) => a.metric.localeCompare(b.metric)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // Blended totals from current-month rows.
  const sumMetric = (providers: IntegrationProvider[], metric: string) =>
    cur
      .filter((r) => providers.includes(r.provider) && r.metric === metric)
      .reduce((acc, r) => acc + r.value, 0)

  const leadsTotal = sumMetric(LEAD_PROVIDERS, 'leads')
  const spendTotal = sumMetric(SPEND_PROVIDERS, 'cost')
  const conversionsValue = sumMetric(SPEND_PROVIDERS, 'conversions_value')
  const roas = spendTotal > 0 ? conversionsValue / spendTotal : null

  // Retainer MRR: sum of active subscriptions for this org (Plan 04).
  const [mrr] = await db
    .select({
      amount: sql<number>`coalesce(sum(${subscriptions.amount}), 0)`,
      currency: sql<string>`coalesce(max(${subscriptions.currency}), 'gbp')`,
    })
    .from(subscriptions)
    .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, 'active')))

  // Tasks completed: tasks for this org sitting in a 'Done' column, updated within the period (Plan 03).
  const monthStartDate = new Date(`${period}T00:00:00Z`)
  const monthEndDate = new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 1))
  const [completed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(boardColumns, eq(tasks.columnId, boardColumns.id))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        eq(boardColumns.name, 'Done'),
        gte(tasks.updatedAt, monthStartDate),
        lt(tasks.updatedAt, monthEndDate),
      ),
    )

  const hasPerformanceData = cur.length > 0

  return {
    organizationId,
    clientName,
    period,
    periodLabel: monthLabel(period),
    tasksCompleted: completed?.n ?? 0,
    retainerMrr: Number(mrr?.amount ?? 0),
    retainerCurrency: mrr?.currency ?? 'gbp',
    channels,
    leadsTotal,
    spendTotal,
    roas,
    hasPerformanceData,
    anyProvisional: false,
  }
}
```

- [ ] **Step 5: Run it and confirm PASS**

Run: `pnpm test tests/reports/gather.test.ts`
Expected: all four tests PASS — facts are correct, tenant-scoped (no `99999`), MoM/YoY/ROAS/MRR/tasks computed, and an empty period returns an honest empty shape.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(reports): ReportFacts contract + tenant-scoped store-only gather step (tested)"
```

---

## Task 5: Facts-contract gate — narrative numbers MUST exist in `ReportFacts` (TDD)

**Files:**
- Create: `tests/reports/facts-contract.test.ts`
- Create: `src/lib/reports/facts-contract.ts`

PRD §7 acceptance: *"Metric movements in the narrative match the dashboard exactly."* The model is instructed to cite only `ReportFacts`, but we **enforce** it: we build the set of allowed numbers from `ReportFacts`, extract every number the model wrote, and **fail the run** if any cited number is not an allowed value (within a tiny rounding tolerance). This is the data-trust gate; a failed contract marks the report `failed` rather than emitting a hallucinated figure.

- [ ] **Step 1: Write the failing test `tests/reports/facts-contract.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { allowedNumbers, extractCitedNumbers, assertFactsContract } from '@/lib/reports/facts-contract'
import type { ReportFacts } from '@/lib/reports/types'

const facts: ReportFacts = {
  organizationId: 'org-1',
  clientName: 'Client One Ltd',
  period: '2026-05-01',
  periodLabel: 'May 2026',
  tasksCompleted: 12,
  retainerMrr: 120000,
  retainerCurrency: 'gbp',
  channels: [
    {
      provider: 'ga4',
      label: 'Website (GA4)',
      movements: [
        { metric: 'sessions', current: 1200, priorMonth: 1000, priorYear: 800, momPct: 20, yoyPct: 50, isProvisional: false },
      ],
    },
  ],
  leadsTotal: 30,
  spendTotal: 50000,
  roas: 4,
  hasPerformanceData: true,
  anyProvisional: false,
}

describe('facts contract', () => {
  it('builds the allowed-number set from facts (values + derived percentages)', () => {
    const allowed = allowedNumbers(facts)
    expect(allowed.has(1200)).toBe(true)
    expect(allowed.has(20)).toBe(true) // momPct
    expect(allowed.has(50)).toBe(true) // yoyPct
    expect(allowed.has(12)).toBe(true) // tasksCompleted
    expect(allowed.has(4)).toBe(true) // roas
  })

  it('extracts numbers from prose, ignoring the year in the period label', () => {
    const nums = extractCitedNumbers('Sessions rose to 1,200 (up 20% MoM) in May 2026.')
    expect(nums).toContain(1200)
    expect(nums).toContain(20)
    // '2026' is the period label year and is whitelisted by assertFactsContract, not here.
    expect(nums).toContain(2026)
  })

  it('passes when every cited number is allowed', () => {
    const text = 'We completed 12 tasks. Sessions reached 1,200, up 20% month-over-month and 50% year-over-year.'
    expect(() => assertFactsContract(text, facts)).not.toThrow()
  })

  it('throws when the narrative invents a number not in the facts', () => {
    const text = 'Sessions reached 1,200, and conversions jumped to 999.'
    expect(() => assertFactsContract(text, facts)).toThrow(/999/)
  })

  it('tolerates rounding (1199.6 ~ 1200) and whitelists the period year', () => {
    const text = 'Sessions were about 1,199.6 in May 2026.'
    expect(() => assertFactsContract(text, facts)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/reports/facts-contract.test.ts`
Expected: FAIL — `@/lib/reports/facts-contract` does not exist.

- [ ] **Step 3: Implement `src/lib/reports/facts-contract.ts`**

```ts
import type { ReportFacts } from './types'

/** Build the set of numbers the narrative is allowed to cite, from ReportFacts. */
export function allowedNumbers(facts: ReportFacts): Set<number> {
  const out = new Set<number>()
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || Number.isNaN(n)) return
    out.add(round2(n))
    out.add(Math.round(n)) // also allow the rounded integer form
  }
  add(facts.tasksCompleted)
  add(facts.retainerMrr)
  add(facts.retainerMrr / 100) // major-unit form (£1,200.00)
  add(facts.leadsTotal)
  add(facts.spendTotal)
  add(facts.spendTotal / 100)
  add(facts.roas)
  for (const c of facts.channels) {
    for (const m of c.movements) {
      add(m.current)
      add(m.priorMonth)
      add(m.priorYear)
      add(m.momPct)
      add(m.yoyPct)
      if (m.momPct !== null) add(Math.abs(m.momPct))
      if (m.yoyPct !== null) add(Math.abs(m.yoyPct))
    }
  }
  return out
}

/** Pull every numeric token from prose (strips thousands separators). */
export function extractCitedNumbers(text: string): number[] {
  const matches = text.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g) ?? []
  return matches.map((m) => Number(m.replace(/,/g, ''))).filter((n) => !Number.isNaN(n))
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Throw if the narrative cites a number that is not derivable from ReportFacts.
 * Small integers (0–12) and the period year are whitelisted as ordinary prose.
 */
export function assertFactsContract(text: string, facts: ReportFacts): void {
  const allowed = allowedNumbers(facts)
  const periodYear = Number(facts.period.slice(0, 4))
  const cited = extractCitedNumbers(text)
  const tolerance = 0.5 // absolute, absorbs rounding in prose

  for (const n of cited) {
    if (n === periodYear) continue // 'May 2026' etc.
    if (Number.isInteger(n) && n >= 0 && n <= 12) continue // ordinal prose: "the 3 channels", month numbers
    const ok = [...allowed].some((a) => Math.abs(a - n) <= tolerance || (a !== 0 && Math.abs((a - n) / a) <= 0.001))
    if (!ok) {
      throw new Error(
        `Facts-contract violation: narrative cites ${n}, which is not in ReportFacts for org ${facts.organizationId} period ${facts.period}.`,
      )
    }
  }
}
```

- [ ] **Step 4: Run it and confirm PASS**

Run: `pnpm test tests/reports/facts-contract.test.ts`
Expected: all five tests PASS — allowed set includes values + derived percentages, extraction handles thousands separators, valid prose passes, invented `999` throws, rounding/period-year tolerated.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reports): facts-contract gate (narrative numbers must match the store)"
```

---

## Task 6: Anthropic client + model routing + cached prompts

**Files:**
- Create: `src/lib/reports/ai/client.ts`
- Create: `src/lib/reports/ai/prompts.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

Install the SDK and centralise model routing (PRD §7: opus-4-8 synthesis, sonnet-4-6 drafting, haiku-4-5 classification) and the **cached** system/template prompt (PRD §7 cost control: prompt caching + Batch API). All three model calls share the same large system block, marked with `cache_control: { type: 'ephemeral' }` so it is cached across the section calls in a run and across clients in the monthly batch.

- [ ] **Step 1: Install the Anthropic SDK**

Run:
```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Add `ANTHROPIC_API_KEY` to `.env.local`**

Append (value from the Anthropic console):
```bash
ANTHROPIC_API_KEY="sk-ant-..."
REPORT_FROM_EMAIL="reports@milktreeagency.com"
```

- [ ] **Step 3: Write the client + model routing `src/lib/reports/ai/client.ts`**

```ts
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Model routing per PRD §7. */
export const MODELS = {
  /** Final synthesis — highest quality narrative. */
  synthesis: 'claude-opus-4-8',
  /** Section drafting — fast, capable. */
  draft: 'claude-sonnet-4-6',
  /** Classification — cheapest, decides which sections have signal. */
  classify: 'claude-haiku-4-5',
} as const

export type ReportModel = (typeof MODELS)[keyof typeof MODELS]
```

- [ ] **Step 4: Write the prompts `src/lib/reports/ai/prompts.ts`**

```ts
import type { ReportFacts } from '../types'

/**
 * The large shared system block. Marked cacheable by callers so it is billed
 * once and reused across section calls and across clients in the monthly batch
 * (PRD §7 cost control). It contains the agency voice + the HARD rule that the
 * model may state ONLY numbers present in the supplied facts.
 */
export const SYSTEM_PROMPT = `You are the reporting writer for Milktree, a digital marketing agency, producing a client's monthly performance report inside Agency OS.

Voice: professional, plain-English, confident but honest. No hype, no emojis. UK spelling. Currency is GBP.

HARD RULES (a downstream validator enforces these and will reject violations):
1. You may state ONLY numbers that appear in the supplied facts JSON. Never invent, estimate, extrapolate, or round to a number not present.
2. When a metric moved, describe the direction and the supplied percentage; do not compute new percentages.
3. If a movement is flagged provisional, add a brief caveat (recent data may revise).
4. If there is no performance data for the period, say so plainly and focus on the work delivered and the plan for next month. Do not imply numbers exist.
5. Never reference any other client. You see exactly one client's facts.

Structure every report as three parts:
- "What we did" — the work delivered (tasks completed, retainer scope).
- "How the numbers moved" — channel-by-channel, with plain-English context and caveats.
- "The plan for next month" — concrete, grounded in the trend you described.`

/** A compact, deterministic facts payload handed to every model call. */
export function factsPayload(facts: ReportFacts): string {
  return JSON.stringify(facts, null, 0)
}

export function classifyUserPrompt(facts: ReportFacts): string {
  return `Facts for ${facts.clientName}, ${facts.periodLabel}:\n${factsPayload(facts)}\n\nReturn a JSON array of the report section keys that have meaningful signal, chosen from: ["work","performance","leads","spend","local","plan"]. Include "performance" only if channels has data. Always include "work" and "plan". Respond with ONLY the JSON array.`
}

export function draftUserPrompt(facts: ReportFacts, section: string): string {
  return `Facts for ${facts.clientName}, ${facts.periodLabel}:\n${factsPayload(facts)}\n\nDraft the "${section}" section only, 2-4 sentences, following the HARD RULES. Plain text, no headings.`
}

export function synthesizeUserPrompt(facts: ReportFacts, sectionDrafts: Record<string, string>): string {
  return `Facts for ${facts.clientName}, ${facts.periodLabel}:\n${factsPayload(facts)}\n\nSection drafts:\n${JSON.stringify(sectionDrafts, null, 0)}\n\nSynthesise the final report. Respond with ONLY a JSON object of the shape {"summary": string, "whatWeDid": string, "howNumbersMoved": string, "planNextMonth": string}. Every number must come from the facts.`
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

```bash
git add -A
git commit -m "feat(reports): anthropic client, model routing, cached prompts"
```

---

## Task 7: The AI pipeline — classify → draft → synthesize (with an injectable runner for tests)

**Files:**
- Create: `src/lib/reports/ai/classify.ts`
- Create: `src/lib/reports/ai/draft.ts`
- Create: `src/lib/reports/ai/synthesize.ts`

Each stage is a thin function over the Anthropic client with the cacheable system block. To keep the end-to-end test deterministic and free of network calls, the pipeline accepts an injectable `complete()` runner; the default runner calls Anthropic, and the test supplies a fake. The synthesis output is a typed `ReportNarrative`.

- [ ] **Step 1: Write the shared runner + types in `src/lib/reports/ai/classify.ts`**

```ts
import { anthropic, MODELS, type ReportModel } from './client'
import { SYSTEM_PROMPT, classifyUserPrompt } from './prompts'
import type { ReportFacts } from '../types'

/**
 * A single text completion. Injectable so tests can run the pipeline without
 * network calls. The default runner uses Anthropic with prompt caching on the
 * shared system block (PRD §7).
 */
export type Complete = (args: { model: ReportModel; system: string; user: string }) => Promise<string>

export const anthropicComplete: Complete = async ({ model, system, user }) => {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  })
  const block = res.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}

export type SectionKey = 'work' | 'performance' | 'leads' | 'spend' | 'local' | 'plan'
const ALL_SECTIONS: SectionKey[] = ['work', 'performance', 'leads', 'spend', 'local', 'plan']

/** haiku-4-5: choose which sections have signal. Falls back to a safe default. */
export async function classifySections(facts: ReportFacts, complete: Complete = anthropicComplete): Promise<SectionKey[]> {
  const raw = await complete({ model: MODELS.classify, system: SYSTEM_PROMPT, user: classifyUserPrompt(facts) })
  try {
    const parsed = JSON.parse(raw) as string[]
    const valid = parsed.filter((s): s is SectionKey => (ALL_SECTIONS as string[]).includes(s))
    const withRequired = new Set<SectionKey>(['work', 'plan', ...valid])
    if (!facts.hasPerformanceData) withRequired.delete('performance')
    return [...withRequired]
  } catch {
    return facts.hasPerformanceData ? ALL_SECTIONS : ['work', 'plan']
  }
}
```

- [ ] **Step 2: Write the drafting stage `src/lib/reports/ai/draft.ts`**

```ts
import { MODELS } from './client'
import { SYSTEM_PROMPT, draftUserPrompt } from './prompts'
import { type Complete, type SectionKey, anthropicComplete } from './classify'
import type { ReportFacts } from '../types'

/** sonnet-4-6: draft each chosen section. Returns a map keyed by section. */
export async function draftSections(
  facts: ReportFacts,
  sections: SectionKey[],
  complete: Complete = anthropicComplete,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    sections.map(async (section) => {
      const text = await complete({ model: MODELS.draft, system: SYSTEM_PROMPT, user: draftUserPrompt(facts, section) })
      return [section, text.trim()] as const
    }),
  )
  return Object.fromEntries(entries)
}
```

- [ ] **Step 3: Write the synthesis stage `src/lib/reports/ai/synthesize.ts`**

```ts
import { MODELS } from './client'
import { SYSTEM_PROMPT, synthesizeUserPrompt } from './prompts'
import { type Complete, anthropicComplete } from './classify'
import type { ReportFacts } from '../types'

export interface ReportNarrative {
  summary: string
  whatWeDid: string
  howNumbersMoved: string
  planNextMonth: string
}

/** opus-4-8: synthesise the final narrative as typed JSON. */
export async function synthesizeNarrative(
  facts: ReportFacts,
  sectionDrafts: Record<string, string>,
  complete: Complete = anthropicComplete,
): Promise<ReportNarrative> {
  const raw = await complete({
    model: MODELS.synthesis,
    system: SYSTEM_PROMPT,
    user: synthesizeUserPrompt(facts, sectionDrafts),
  })
  const parsed = JSON.parse(raw) as Partial<ReportNarrative>
  return {
    summary: parsed.summary ?? '',
    whatWeDid: parsed.whatWeDid ?? '',
    howNumbersMoved: parsed.howNumbersMoved ?? '',
    planNextMonth: parsed.planNextMonth ?? '',
  }
}

/** The full narrative as one string, for the facts-contract check. */
export function narrativeText(n: ReportNarrative): string {
  return [n.summary, n.whatWeDid, n.howNumbersMoved, n.planNextMonth].join('\n\n')
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

```bash
git add -A
git commit -m "feat(reports): AI pipeline (classify/draft/synthesize) with injectable runner"
```

---

## Task 8: PDF rendering + Supabase Storage upload

**Files:**
- Create: `src/lib/reports/pdf/ReportDocument.tsx`
- Create: `src/lib/reports/storage.ts`
- Modify: `package.json` (add `@react-pdf/renderer`)

Render the narrative to a PDF server-side (`@react-pdf/renderer`), then upload it to the private `reports` Storage bucket under `{organizationId}/{period}.pdf` (the key convention the Storage RLS policy in Task 2 relies on). Downloads use signed URLs.

- [ ] **Step 1: Install the renderer**

Run:
```bash
pnpm add @react-pdf/renderer
```

- [ ] **Step 2: Write the PDF document + render helper `src/lib/reports/pdf/ReportDocument.tsx`**

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { ReportFacts } from '../types'
import type { ReportNarrative } from '../ai/synthesize'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, lineHeight: 1.5, color: '#1a1a1a' },
  brand: { fontSize: 10, color: '#888', marginBottom: 4 },
  h1: { fontSize: 20, marginBottom: 2 },
  sub: { fontSize: 12, color: '#555', marginBottom: 16 },
  h2: { fontSize: 13, marginTop: 16, marginBottom: 6, color: '#000' },
  p: { marginBottom: 8 },
  kpis: { flexDirection: 'row', marginBottom: 12, gap: 16 },
  kpi: { flexGrow: 1 },
  kpiLabel: { fontSize: 8, color: '#888' },
  kpiValue: { fontSize: 14 },
  footnote: { fontSize: 8, color: '#999', marginTop: 24 },
})

export function ReportDocument({ facts, narrative }: { facts: ReportFacts; narrative: ReportNarrative }) {
  const mrr = (facts.retainerMrr / 100).toLocaleString('en-GB', { style: 'currency', currency: facts.retainerCurrency.toUpperCase() })
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>Agency OS — Milktree</Text>
        <Text style={styles.h1}>{facts.clientName}</Text>
        <Text style={styles.sub}>Monthly performance report — {facts.periodLabel}</Text>

        <View style={styles.kpis}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Retainer (MRR)</Text>
            <Text style={styles.kpiValue}>{mrr}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Tasks completed</Text>
            <Text style={styles.kpiValue}>{facts.tasksCompleted}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Leads</Text>
            <Text style={styles.kpiValue}>{facts.leadsTotal}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>ROAS</Text>
            <Text style={styles.kpiValue}>{facts.roas === null ? 'n/a' : `${facts.roas.toFixed(2)}x`}</Text>
          </View>
        </View>

        {narrative.summary ? <Text style={styles.p}>{narrative.summary}</Text> : null}

        <Text style={styles.h2}>What we did</Text>
        <Text style={styles.p}>{narrative.whatWeDid}</Text>

        <Text style={styles.h2}>How the numbers moved</Text>
        <Text style={styles.p}>{narrative.howNumbersMoved}</Text>

        <Text style={styles.h2}>The plan for next month</Text>
        <Text style={styles.p}>{narrative.planNextMonth}</Text>

        <Text style={styles.footnote}>
          Figures are drawn from the Agency OS metrics store as of report generation. Recent days may be revised; year-over-year and month-over-month changes are stated where comparable data exists.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the report document to a PDF buffer (server-side). */
export async function renderReportPdf(facts: ReportFacts, narrative: ReportNarrative): Promise<Buffer> {
  return renderToBuffer(<ReportDocument facts={facts} narrative={narrative} />)
}
```

- [ ] **Step 3: Write the storage helper `src/lib/reports/storage.ts`**

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client for job-side Storage writes (never exposed to the browser).
function storageAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const BUCKET = 'reports'

/** Object key convention the Storage RLS policy depends on: '{org}/{period}.pdf'. */
export function reportObjectKey(organizationId: string, period: string): string {
  return `${organizationId}/${period}.pdf`
}

/** Upload (overwrite) a report PDF; returns the object key. */
export async function uploadReportPdf(organizationId: string, period: string, pdf: Buffer): Promise<string> {
  const key = reportObjectKey(organizationId, period)
  const { error } = await storageAdmin()
    .storage.from(BUCKET)
    .upload(key, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  return key
}

/** A short-lived signed URL for a stored report PDF (PRD §5.11 expiring URLs). */
export async function signedReportUrl(objectKey: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await storageAdmin().storage.from(BUCKET).createSignedUrl(objectKey, expiresInSeconds)
  if (error || !data) throw error ?? new Error('failed to sign report URL')
  return data.signedUrl
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

```bash
git add -A
git commit -m "feat(reports): @react-pdf/renderer document + Supabase Storage upload/signing"
```

---

## Task 9: The report-ready email template

**Files:**
- Create: `src/lib/reports/email/ReportReadyEmail.tsx`

Uses `@react-email/components` (already added in Plan 05) + Resend. The email links to the portal Reports page (the client downloads via a signed URL there — we do not attach the PDF to keep emails light and respect the expiring-URL convention).

- [ ] **Step 1: Write the template `src/lib/reports/email/ReportReadyEmail.tsx`**

```tsx
import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'

export interface ReportReadyEmailProps {
  clientName: string
  periodLabel: string
  portalUrl: string
}

export function ReportReadyEmail({ clientName, periodLabel, portalUrl }: ReportReadyEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f6f6f6', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: 8, padding: 32 }}>
          <Heading style={{ fontSize: 20 }}>Your {periodLabel} report is ready</Heading>
          <Text>Hi {clientName} team,</Text>
          <Text>
            Your monthly performance report for {periodLabel} is now available in your Agency OS portal — what we did,
            how the numbers moved, and the plan for next month.
          </Text>
          <Section style={{ marginTop: 16 }}>
            <Link
              href={portalUrl}
              style={{ backgroundColor: '#111', color: '#fff', padding: '10px 16px', borderRadius: 6, textDecoration: 'none' }}
            >
              View your report
            </Link>
          </Section>
          <Text style={{ color: '#888', fontSize: 12, marginTop: 24 }}>Agency OS — Milktree</Text>
        </Container>
      </Body>
    </Html>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

```bash
git add -A
git commit -m "feat(reports): report-ready React Email template"
```

---

## Task 10: End-to-end generator (gather → AI → contract → PDF → store → send/hold → archive) with a fake AI (TDD)

**Files:**
- Create: `src/lib/reports/generate.ts`
- Create: `tests/reports/generate-e2e.test.ts`

This is the heart of the worker, factored as a pure async function so the Inngest function (Task 11) is a thin wrapper and the test can run it directly with an injected fake `complete()` (no network, no Anthropic key needed). It enforces **tenant isolation** (one `organizationId` in, every read scoped to it), runs the **facts-contract** gate, upserts the `report` row, and honours the **draft → review → send** toggle (`autoSend`).

- [ ] **Step 1: Write the failing e2e test `tests/reports/generate-e2e.test.ts`**

Reuses the gather-test seed style. The fake `complete()` returns deterministic, contract-valid text per stage. Asserts: a `sent` report row is archived for org one with a `pdfPath`, the cross-tenant number never appears, and with `autoSend: false` the report stays `draft` and no email is attempted.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, userIdByEmail } from '../helpers/db'
import { generateReport } from '@/lib/reports/generate'
import type { Complete } from '@/lib/reports/ai/classify'
import { MODELS } from '@/lib/reports/ai/client'

// Deterministic, contract-valid fake. Cites only numbers present in the facts.
const fakeComplete: Complete = async ({ model, user }) => {
  if (model === MODELS.classify) return JSON.stringify(['work', 'performance', 'plan'])
  if (model === MODELS.draft) {
    if (user.includes('"work"')) return 'We completed 1 task this month.'
    if (user.includes('"performance"')) return 'Sessions reached 1,200, up 20% month-over-month.'
    return 'Next month we will build on the 20% gain.'
  }
  // synthesis
  return JSON.stringify({
    summary: 'A solid month for Client One Ltd in May 2026.',
    whatWeDid: 'We completed 1 task this month.',
    howNumbersMoved: 'Sessions reached 1,200, up 20% month-over-month and 50% year-over-year.',
    planNextMonth: 'Next month we will build on the 20% gain.',
  })
}

describe('generateReport (end-to-end, fake AI)', () => {
  let orgOne: string

  beforeAll(async () => {
    const founderId = await userIdByEmail('founder@milktreeagency.com')
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    orgOne = o1[0]!.id as string

    // Minimal store data for May 2026 + April (MoM) + May 2025 (YoY).
    const rows: Array<[string, string, string, number]> = [
      ['2026-05-01', 'ga4', 'sessions', 1200],
      ['2026-04-01', 'ga4', 'sessions', 1000],
      ['2025-05-01', 'ga4', 'sessions', 800],
    ]
    for (const [month, provider, metric, value] of rows) {
      await sql`
        insert into public.metric_monthly_rollup
          (organization_id, provider, account_id, entity, month, metric, value)
        values (${orgOne}, ${provider}, 'acct-1', 'property', ${month}::date, ${metric}, ${value})
        on conflict on constraint metric_monthly_rollup_pk do update set value = excluded.value`
    }
    await sql`
      insert into public.subscriptions (organization_id, provider, amount, currency, interval, status)
      values (${orgOne}, 'stripe', 120000, 'gbp', 'month', 'active') on conflict do nothing`
    await sql`
      insert into public.boards (id, organization_id, name)
      values ('00000000-0000-0000-0000-0000000b0002', ${orgOne}, 'Board') on conflict (id) do nothing`
    await sql`
      insert into public.board_columns (id, organization_id, board_id, name, position, is_intake)
      values ('00000000-0000-0000-0000-0000000c0002', ${orgOne},
              '00000000-0000-0000-0000-0000000b0002', 'Done', 3, false) on conflict (id) do nothing`
    await sql`
      insert into public.tasks (id, organization_id, board_id, column_id, title, position, origin, created_by, updated_at)
      values ('00000000-0000-0000-0000-0000000d0002', ${orgOne},
              '00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-0000000c0002',
              'Task', 0, 'agency', ${founderId}, '2026-05-15T10:00:00Z')
      on conflict (id) do update set updated_at = '2026-05-15T10:00:00Z'`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('with autoSend=false, archives a DRAFT (no email) for ONE client', async () => {
    const res = await generateReport(
      { organizationId: orgOne, period: '2026-05-01', autoSend: false },
      { complete: fakeComplete, sendEmail: async () => { throw new Error('email must NOT be sent for a draft') } },
    )
    expect(res.status).toBe('draft')
    const [row] = await sql`select status, pdf_path, model_used from public.reports
      where organization_id = ${orgOne} and period = '2026-05-01'`
    expect(row!.status).toBe('draft')
    expect(row!.pdf_path).toBe(`${orgOne}/2026-05-01.pdf`)
    expect(row!.model_used).toContain('opus')
  })

  it('with autoSend=true, sends and archives a SENT report; narrative numbers all trace to the store', async () => {
    let emailed = false
    const res = await generateReport(
      { organizationId: orgOne, period: '2026-05-01', autoSend: true },
      { complete: fakeComplete, sendEmail: async () => { emailed = true } },
    )
    expect(res.status).toBe('sent')
    expect(emailed).toBe(true)
    // No cross-tenant value ever appears in the persisted narrative.
    const [row] = await sql`select narrative from public.reports
      where organization_id = ${orgOne} and period = '2026-05-01'`
    expect(JSON.stringify(row!.narrative)).not.toContain('99999')
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/reports/generate-e2e.test.ts`
Expected: FAIL — `@/lib/reports/generate` does not exist.

- [ ] **Step 3: Implement `src/lib/reports/generate.ts`**

```ts
import { db } from '@/db'
import { reports } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { ReportStatus } from '@/db/types'
import { gatherReportData } from './gather'
import { assertFactsContract } from './facts-contract'
import { classifySections, anthropicComplete, type Complete } from './ai/classify'
import { draftSections } from './ai/draft'
import { synthesizeNarrative, narrativeText, type ReportNarrative } from './ai/synthesize'
import { MODELS } from './ai/client'
import { renderReportPdf } from './pdf/ReportDocument'
import { uploadReportPdf } from './storage'

export interface GenerateInput {
  organizationId: string
  period: string // 'YYYY-MM-01'
  autoSend: boolean // the draft -> review -> send toggle (PRD §7)
}

export interface GenerateDeps {
  complete?: Complete
  /** Send the report-ready email; injected so tests can assert/skip it. */
  sendEmail?: (args: { organizationId: string; clientName: string; periodLabel: string }) => Promise<void>
}

export interface GenerateResult {
  status: ReportStatus
  organizationId: string
  period: string
}

/**
 * Generate one client's monthly report end-to-end. TENANT ISOLATION: the input
 * carries exactly one organizationId; every read (gather) is scoped to it and
 * the AI only ever sees that org's facts (PRD §7). On a facts-contract violation
 * or render error the report is archived as 'failed' and the error rethrown so
 * Inngest records it.
 */
export async function generateReport(input: GenerateInput, deps: GenerateDeps = {}): Promise<GenerateResult> {
  const { organizationId, period, autoSend } = input
  const complete = deps.complete ?? anthropicComplete

  // Ensure a row exists so failures are archived against it.
  await db
    .insert(reports)
    .values({ organizationId, period, status: 'draft' })
    .onConflictDoUpdate({
      target: [reports.organizationId, reports.period],
      set: { updatedAt: new Date() },
    })

  try {
    // 1. Gather — tenant-scoped, store-only.
    const facts = await gatherReportData(organizationId, period)

    // 2. AI pipeline — classify (haiku) -> draft (sonnet) -> synthesize (opus).
    const sections = await classifySections(facts, complete)
    const drafts = await draftSections(facts, sections, complete)
    const narrative: ReportNarrative = await synthesizeNarrative(facts, drafts, complete)

    // 3. Data-trust gate: every cited number must trace to the facts.
    assertFactsContract(narrativeText(narrative), facts)

    // 4. Render + store the PDF.
    const pdf = await renderReportPdf(facts, narrative)
    const pdfPath = await uploadReportPdf(organizationId, period, pdf)

    // 5. Archive + (auto-send or hold for review).
    const status: ReportStatus = autoSend ? 'sent' : 'draft'
    const now = new Date()
    await db
      .update(reports)
      .set({
        status,
        narrative,
        pdfPath,
        modelUsed: MODELS.synthesis,
        generatedAt: now,
        sentAt: autoSend ? now : null,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(reports.organizationId, organizationId), eq(reports.period, period)))

    if (autoSend) {
      const send = deps.sendEmail
      if (send) await send({ organizationId, clientName: facts.clientName, periodLabel: facts.periodLabel })
    }

    return { status, organizationId, period }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(reports)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(and(eq(reports.organizationId, organizationId), eq(reports.period, period)))
    throw err
  }
}
```

- [ ] **Step 4: Run it and confirm PASS**

Run: `pnpm test tests/reports/generate-e2e.test.ts`
Expected: both tests PASS — `autoSend:false` archives a `draft` with the correct `pdfPath`/`opus` model and no email; `autoSend:true` sends + archives `sent`, and the persisted narrative never contains a cross-tenant value.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reports): end-to-end generator (gather->AI->contract->PDF->store->send/hold->archive)"
```

---

## Task 11: Inngest orchestration — monthly scheduler fan-out + per-client function

**Files:**
- Create: `src/lib/inngest/functions/report-scheduler.ts`
- Create: `src/lib/inngest/functions/generate-report.ts`
- Modify: `src/app/api/inngest/route.ts`

The monthly cron fans out **one event per active-retainer client org** (each event carries a single `organizationId` — the tenant-isolation boundary). The per-client function reads the org's `autoSend` toggle, calls `generateReport`, and wires the real Resend email. Concurrency is bounded so the monthly batch respects rate budgets (PRD §7 cost control / §6.2). Runs **on the 5th** for data completeness (matches Plan 06's `monthly-rollup` timing).

- [ ] **Step 1: Write the scheduler `src/lib/inngest/functions/report-scheduler.ts`**

```ts
import { db } from '@/db'
import { subscriptions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest/client'
import { prevMonthStart } from '@/lib/reports/period'

/**
 * Monthly cron (the 5th, a few days into the new month for data completeness,
 * PRD §7): fan out one report-generation event per active-retainer client org.
 * Each event carries exactly one organizationId — the tenant-isolation boundary.
 */
export const reportScheduler = inngest.createFunction(
  { id: 'report-scheduler' },
  { cron: '0 6 5 * *' }, // 06:00 UTC on the 5th (after Plan 06's 05:00 monthly-rollup)
  async ({ step }) => {
    const period = prevMonthStart(new Date())

    const orgs = await step.run('list-retainer-orgs', async () => {
      const rows = await db
        .selectDistinct({ organizationId: subscriptions.organizationId })
        .from(subscriptions)
        .where(eq(subscriptions.status, 'active'))
      return rows.map((r) => r.organizationId)
    })

    if (orgs.length > 0) {
      await step.sendEvent(
        'fan-out',
        orgs.map((organizationId) => ({
          name: 'reports/client.generate',
          data: { organizationId, period },
        })),
      )
    }

    return { period, orgs: orgs.length }
  },
)
```

- [ ] **Step 2: Write the per-client function `src/lib/inngest/functions/generate-report.ts`**

```ts
import { render } from '@react-email/components'
import { inngest } from '@/lib/inngest/client'
import { resend } from '@/lib/email/resend'
import { generateReport } from '@/lib/reports/generate'
import { ReportReadyEmail } from '@/lib/reports/email/ReportReadyEmail'
import { db } from '@/db'
import { reportAutoSendForOrg } from '@/app/(internal)/clients/[clientId]/reports/actions'

const FROM = process.env.REPORT_FROM_EMAIL ?? 'reports@milktreeagency.com'
const PORTAL_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.milktreeagency.com'

/**
 * Per-client report generation. One organizationId per run = tenant isolation
 * (PRD §7). Bounded concurrency keeps the monthly batch within rate budgets.
 */
export const generateReportFn = inngest.createFunction(
  { id: 'generate-report', retries: 3, concurrency: { limit: 4 } },
  { event: 'reports/client.generate' },
  async ({ event, step }) => {
    const { organizationId, period } = event.data as { organizationId: string; period: string }

    // Per-client draft->review->send toggle (default: hold for review).
    const autoSend = await step.run('read-autosend', () => reportAutoSendForOrg(organizationId))

    return step.run('generate', () =>
      generateReport(
        { organizationId, period, autoSend },
        {
          sendEmail: async ({ clientName, periodLabel }) => {
            // Email each client contact of this org. recipientsForOrg is a small
            // server helper; for the portal-first flow we link to the portal.
            const html = await render(
              ReportReadyEmail({ clientName, periodLabel, portalUrl: `${PORTAL_URL}/reports` }),
            )
            const to = await recipientsForOrg(organizationId)
            if (to.length > 0) {
              await resend.emails.send({ from: FROM, to, subject: `Your ${periodLabel} report is ready`, html })
            }
          },
        },
      ),
    )
  },
)

/** Client-contact emails for an org (members of the client org). */
async function recipientsForOrg(organizationId: string): Promise<string[]> {
  const rows = await db.execute(
    // service-role context (job); reads profile emails for members of this org only.
    // eslint-disable-next-line
    (await import('drizzle-orm')).sql`
      select p.email
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      where m.organization_id = ${organizationId}::uuid and m.role = 'client'`,
  )
  return (rows as unknown as { email: string }[]).map((r) => r.email)
}
```

- [ ] **Step 3: Register both functions in `src/app/api/inngest/route.ts`**

Merge into the existing `functions` array (do not overwrite the file — Plans 06/04 already registered functions here). Add the imports and append both functions:

```ts
import { reportScheduler } from '@/lib/inngest/functions/report-scheduler'
import { generateReportFn } from '@/lib/inngest/functions/generate-report'

// ...inside serve({ client: inngest, functions: [ ...existing, reportScheduler, generateReportFn ] })
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors. (The `reportAutoSendForOrg` import resolves once Task 12's actions file exists; implement Task 12 before this typecheck, or stub the import order by doing Task 12 first — see note below.)

> **Build order note:** Task 12 creates `actions.ts` which exports `reportAutoSendForOrg`. If you are running tasks strictly in order, create the `actions.ts` file from Task 12 first (it has no dependency on this task), then return here. The committed end state has both.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reports): Inngest monthly scheduler + per-client generation function"
```

---

## Task 12: The "draft → review → send" toggle + approve-and-send server actions

**Files:**
- Create: `src/app/(internal)/clients/[clientId]/reports/actions.ts`

The toggle is stored per client org in the existing `clients.branding` JSON (Plan 02) under a `reportAutoSend` key, avoiding a new column. Staff can also approve a held draft and send it on demand. These are staff-only Server Actions; `reportAutoSendForOrg` is the read used by the Inngest function.

- [ ] **Step 1: Write the actions `src/app/(internal)/clients/[clientId]/reports/actions.ts`**

```ts
'use server'

import { db } from '@/db'
import { clients, reports } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSession, isStaff } from '@/lib/auth'
import { render } from '@react-email/components'
import { resend } from '@/lib/email/resend'
import { ReportReadyEmail } from '@/lib/reports/email/ReportReadyEmail'

const FROM = process.env.REPORT_FROM_EMAIL ?? 'reports@milktreeagency.com'
const PORTAL_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.milktreeagency.com'

/** Read the per-org auto-send toggle (default false = hold for review). PRD §7. */
export async function reportAutoSendForOrg(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ branding: clients.branding })
    .from(clients)
    .where(eq(clients.organizationId, organizationId))
  const branding = (row?.branding ?? {}) as Record<string, unknown>
  return branding.reportAutoSend === true
}

/** Staff: set the per-org auto-send toggle. */
export async function setReportAutoSend(organizationId: string, autoSend: boolean): Promise<void> {
  const session = await getSession()
  if (!session || !isStaff(session.role)) throw new Error('Forbidden')
  const [row] = await db
    .select({ branding: clients.branding })
    .from(clients)
    .where(eq(clients.organizationId, organizationId))
  const branding = { ...((row?.branding ?? {}) as Record<string, unknown>), reportAutoSend: autoSend }
  await db.update(clients).set({ branding }).where(eq(clients.organizationId, organizationId))
}

/** Staff: approve a held draft and send it (status draft/review -> sent + email). */
export async function approveAndSendReport(organizationId: string, period: string): Promise<void> {
  const session = await getSession()
  if (!session || !isStaff(session.role)) throw new Error('Forbidden')

  const [report] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), eq(reports.period, period)))
  if (!report) throw new Error('Report not found')
  if (report.status === 'sent') return // idempotent

  const now = new Date()
  await db
    .update(reports)
    .set({ status: 'sent', sentAt: now, updatedAt: now })
    .where(and(eq(reports.organizationId, organizationId), eq(reports.period, period)))

  // Email the client contacts.
  const recipients = await db.execute(
    // eslint-disable-next-line
    (await import('drizzle-orm')).sql`
      select p.email from public.memberships m
      join public.profiles p on p.id = m.user_id
      where m.organization_id = ${organizationId}::uuid and m.role = 'client'`,
  )
  const to = (recipients as unknown as { email: string }[]).map((r) => r.email)
  if (to.length > 0) {
    const [client] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
    const periodLabel = new Date(`${period}T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    const html = await render(
      ReportReadyEmail({ clientName: client?.name ?? 'Client', periodLabel, portalUrl: `${PORTAL_URL}/reports` }),
    )
    await resend.emails.send({ from: FROM, to, subject: `Your ${periodLabel} report is ready`, html })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors (this resolves the `reportAutoSendForOrg` import used by Task 11).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(reports): draft->review->send toggle + approve-and-send staff actions"
```

---

## Task 13: Full suite + manual Inngest smoke test

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all report tests pass (RLS isolation, period, gather, facts-contract, generate-e2e) alongside the existing Plan 01–06 suites.

- [ ] **Step 2: Manual Inngest smoke test (optional, requires the dev server)**

Run in two terminals:
```bash
pnpm dev
pnpm dlx inngest-cli@latest dev
```
In the Inngest dev UI, send a test event:
```json
{ "name": "reports/client.generate", "data": { "organizationId": "<client-one org id>", "period": "2026-05-01" } }
```
Expected: the `generate-report` function runs; a `reports` row for that org/period is archived (status `draft` if the org's `reportAutoSend` is off), with a `pdf_path` and an object in the private `reports` Storage bucket. If `reportAutoSend` is on and client contacts exist, a Resend email is sent.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore(reports): verify full suite green (AI monthly report generator complete)"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §7 AI Monthly Report Generator + §8 Data Model + §6.1/§9 security):**
- Month-end Inngest job per client gathering **pre-aggregated rows from our store** (tasks completed, MoM/YoY movements, channel performance, leads, spend/ROAS, local) — never live APIs → `gatherReportData` reads `metric_monthly_rollup`/`subscriptions`/`tasks` only (Task 4); scheduler runs on the 5th (Task 11). ✅
- Model routing: **opus-4-8 final synthesis, sonnet-4-6 drafting, haiku-4-5 classification** → `MODELS` + classify/draft/synthesize (Tasks 6–7). ✅
- **Prompt caching** (shared system/template prompt) + **Batch API** for the monthly fan-out → `cache_control: ephemeral` on the shared `SYSTEM_PROMPT` reused across stages and clients (Task 6/7); per-client fan-out with bounded concurrency = the batch shape (Task 11). ✅
- Render **PDF (@react-pdf/renderer) → Supabase Storage signed URL → email via Resend; archive in portal (`report` table)** → Tasks 8 (PDF + Storage), 9 (email), 1/10 (`report` table archive). ✅
- **Tenant isolation enforced in the worker** — one client per run → event carries a single `organizationId`; every gather query filtered by it; AI sees only that org's `ReportFacts`; e2e asserts no cross-tenant value leaks (Tasks 4, 10). ✅
- **"draft → review → send" toggle** → per-org `reportAutoSend` toggle + `approveAndSendReport` (Task 12); generator honours `autoSend` (Task 10). ✅
- Test the gather step + tenant scoping + that narrative numbers match stored rows → `gather.test.ts` (Task 4), `report-isolation.test.ts` + e2e cross-tenant assertion (Tasks 2, 10), `facts-contract.test.ts` enforcing every cited number traces to `ReportFacts` (Task 5). ✅
- PRD §7 acceptance "a report never includes another client's data (tested)" → RLS test (drafts hidden from clients, cross-org hidden) + e2e leak assertion. ✅
- PRD §7 acceptance "metric movements in the narrative match the dashboard exactly" → `assertFactsContract` is a hard release gate; a violation marks the report `failed` (Tasks 5, 10). ✅
- PRD §8 `report (client_id, period, status, pdf_url, generated_at, model_used)` → `reports` table mapped to `organization_id` (tenant), `period`, `status`, `pdfPath`, `generatedAt`, `modelUsed` (+ `narrative` for re-render and portal display) (Task 1). ✅
- PRD §9: tenant-leading composite index, RLS reusing `has_org_access`/`is_agency_staff`, RLS isolation test for the new table, `service_role` only for jobs → Task 1 (index), Task 2 (policies + test), Storage RLS keyed on the org path segment, generator/storage use service-role server-side only. ✅

**Dependencies honoured (assumed built; not re-spec'd):** Plan 06 (`metric_monthly_rollup`, Inngest client/serve route, Resend client), Plan 11 (rollups populated), Plan 03 (`tasks`/`board_columns` Done column), Plan 04 (`subscriptions` retainers). This plan reads their outputs and registers new Inngest functions by merging into the existing serve route. ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. The Task 11 "build order note" is an explicit ordering instruction (create Task 12's `actions.ts` before Task 11's typecheck), not a code placeholder. ✅

**Type consistency:** `ReportFacts`/`MetricMovement`/`ChannelFacts` shared across gather, facts-contract, AI prompts, PDF, and generator; `ReportNarrative` shared across synthesize/PDF/generator; `Complete` runner type shared across classify/draft/synthesize/generate and the e2e fake; `ReportStatus` from `src/db/types.ts` used in the generator; enum values `draft|review|sent|failed` consistent across schema, RLS policy, generator, and tests; `reportAutoSendForOrg` signature consistent between Task 11 (consumer) and Task 12 (provider); Storage object key `{organizationId}/{period}.pdf` consistent between `storage.ts`, the e2e assertion, and the Storage RLS policy's `storage.foldername(name)[1]`. ✅

**Definition of done for Plan 12:** `pnpm lint && pnpm test` green (report RLS isolation, period, gather, facts-contract, and generate-e2e all pass) on top of Plans 01–06; the manual Inngest smoke test archives a tenant-scoped report PDF and (when auto-send is on) emails the client.
