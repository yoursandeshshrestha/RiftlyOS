# Agency OS — Plan 04: Finance, Invoicing & Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Finance module — the agency's billing backbone — where **our Postgres DB is the system of record** and **Stripe is the collection engine**. Retainers are Stripe Billing **Subscriptions** (recurring monthly Price); one-off jobs are Stripe **Invoicing** (InvoiceItems → finalize → send). A **single, idempotent, signature-verified Stripe webhook endpoint** reconciles every status transition (`invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `customer.subscription.*`) — we **never trust the redirect/return URL**. **Stripe Tax** handles UK VAT + B2B reverse-charge. Clients see/pay only their own invoices (RLS-enforced); the Finance dashboard surfaces MRR, one-off income, outstanding, paid-vs-overdue, and revenue-vs-target, feeding the Cockpit.

**Architecture:** Tenant-scoped finance tables (`customer`, `invoice`, `line_item`, `payment`, `subscription`, `revenue_target`, plus a `stripe_event` dedupe ledger) keyed on `organization_id` (the client org from Plan 01), every one carrying `organization_id` as the leading column of a composite index and protected by RLS policies that reuse the Plan 01 helpers `public.has_org_access(uuid)` and `public.is_agency_staff()`. A `StripeConnector` (provider-abstracted: `createCustomer/createInvoice/finalizeInvoice/createSubscription/...`) wraps the Stripe SDK; all Stripe calls run **server-side only** under `service_role`/Inngest, never from the browser. Inbound Stripe webhooks hit one Next.js Route Handler that verifies the signature, dedupes on `event.id` via `stripe_event`, maps the provider object id → `organization_id`, and enqueues an **Inngest** job that mutates our tables (fast 200 + async worker). Retainer renewals and dunning reminders are Inngest-driven. A money-relevant write also appends an immutable `audit_event` (Plan 01).

**Tech Stack:** Next.js 16 (App Router, route handlers + Server Components) · TypeScript strict · pnpm · Supabase Postgres + RLS · Drizzle ORM + drizzle-kit · postgres.js · `stripe` (official Node SDK) · Stripe CLI (`stripe listen` for local webhook tests) · Inngest (webhook fan-out, retainer renewal cron, dunning) · Resend (dunning/invoice emails) · Tailwind + shadcn/ui · Recharts (finance charts) · Vitest (unit + RLS isolation + webhook idempotency).

**Prerequisites the developer needs installed:** everything from Plan 01 (Node 20+, pnpm 9+, Docker, Supabase CLI, local stack running, seed applied), plus the **Stripe CLI** (`brew install stripe/stripe-cli/stripe` then `stripe login`) and a **Stripe account in test mode** with **Stripe Tax enabled** in the dashboard (Settings → Tax). Inngest (Plan 02 dependency) is assumed installed and its dev server runnable via `pnpm dlx inngest-cli dev`.

**Dependencies (assume built — do NOT re-spec):**
- **Plan 01 (Foundation):** `organizations`/`profiles`/`memberships` tables, `org_type`/`app_role` enums, `public.has_org_access(uuid)`, `public.is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, the test harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`), the Drizzle client `src/db/index.ts`, and `getSession()`/`isStaff()` in `src/lib/auth.ts`.
- **Plan 02 (Clients) and Plan 1.5 (Shared Platform Services):** the `client` table/profile, an Inngest client at `src/lib/inngest/client.ts` (exported as `inngest`) with its serve route at `src/app/api/inngest/route.ts`, a Resend wrapper at `src/lib/email/resend.ts` exporting `sendEmail({ to, subject, html })`, and the `audit_event` table with a helper `recordAuditEvent(...)` at `src/lib/audit/record.ts`. This plan references these by import path; if a path differs in your build, alias it.

> **Tenancy note:** Per Plan 01's canonical model, the tenant column is **`organization_id`** referencing the **client-type** `organizations` row (PRD §8 uses `client_id` colloquially; in our schema the client *is* an organization). All finance tables use `organization_id`. The PRD's `customer.client_id` therefore maps to `customer.organization_id`.

---

## File Structure (created by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                         # MODIFY: append finance tables + enums
│  │  └─ types.ts                          # MODIFY: append inferred finance types
│  ├─ lib/
│  │  ├─ stripe/
│  │  │  ├─ client.ts                      # server-only Stripe SDK singleton
│  │  │  ├─ connector.ts                   # StripeConnector (provider abstraction)
│  │  │  └─ webhook.ts                     # verifyAndParse + event→handler router
│  │  ├─ finance/
│  │  │  ├─ customers.ts                   # ensureCustomer(orgId)
│  │  │  ├─ invoices.ts                    # createOneOffInvoice / reconcileInvoice
│  │  │  ├─ subscriptions.ts              # createRetainer / reconcileSubscription
│  │  │  ├─ money.ts                       # minor-units + currency formatting
│  │  │  └─ metrics.ts                     # MRR / outstanding / paid-vs-overdue queries
│  │  └─ inngest/
│  │     └─ finance.ts                     # finance Inngest functions (webhook fan-out, dunning, renewals)
│  ├─ app/
│  │  ├─ api/
│  │  │  └─ webhooks/
│  │  │     └─ stripe/route.ts             # single signature-verified webhook endpoint
│  │  ├─ (internal)/
│  │  │  └─ finance/
│  │  │     ├─ page.tsx                     # finance dashboard (MRR, outstanding, charts)
│  │  │     ├─ invoices/page.tsx            # all-client invoice list + create
│  │  │     └─ actions.ts                   # server actions: create invoice/retainer, set target
│  │  └─ (portal)/
│  │     └─ invoices/page.tsx               # client's own invoices + Pay button
│  └─ components/
│     └─ finance/
│        ├─ revenue-gauge.tsx               # revenue vs target gauge (Recharts)
│        └─ paid-overdue-chart.tsx          # paid vs overdue bars (Recharts)
├─ drizzle/                                 # generated + custom SQL migrations (append)
└─ tests/
   ├─ finance/
   │  ├─ money.test.ts                      # minor-units + formatting unit tests
   │  ├─ webhook-idempotency.test.ts        # dedupe on event.id
   │  ├─ reconcile.test.ts                  # invoice.paid → status flip
   │  └─ metrics.test.ts                    # MRR / outstanding aggregation
   └─ rls/
      └─ finance-isolation.test.ts          # KEYSTONE: tenant isolation for all finance tables
```

---

## Task 1: Install Stripe SDK and add finance env vars

**Files:**
- Modify: `package.json` (dependency), `.env.local` (secrets), `src/env.ts` (create: typed env access)

- [ ] **Step 1: Install the Stripe SDK**

Run:
```bash
pnpm add stripe
```
Expected: `stripe` added to `dependencies` (no extra runtime deps for the dashboard charts — Recharts is already present from Plan 02; if not, `pnpm add recharts`).

- [ ] **Step 2: Add Stripe env vars to `.env.local`**

Append (use your Stripe **test-mode** keys from the Stripe dashboard → Developers → API keys; the webhook secret comes from `stripe listen` in Task 8):
```bash
STRIPE_SECRET_KEY="sk_test_...."
STRIPE_WEBHOOK_SECRET="whsec_...."          # filled in Task 8 from `stripe listen`
NEXT_PUBLIC_APP_URL="http://localhost:3000" # for invoice return URLs (display only)
```
Confirm `.env.local` is gitignored (Plan 01 already ignores `.env*`).

- [ ] **Step 3: Create typed env access `src/env.ts`**

This fails fast at import time if a finance secret is missing, so a misconfigured deploy never silently no-ops a payment.
```ts
import 'server-only'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  STRIPE_SECRET_KEY: required('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: required('STRIPE_WEBHOOK_SECRET'),
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
} as const
```

> Tests that don't touch Stripe import nothing from `src/env.ts`; the webhook-idempotency and reconcile tests stub the connector, so they set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to dummy values in `vitest.config.ts` env or inline — see Task 7.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(finance): add stripe SDK + typed finance env"
```

---

## Task 2: Define the finance schema (enums + tables)

**Files:**
- Modify: `src/db/schema.ts` (append finance enums + tables)
- Modify: `src/db/types.ts` (append inferred types)
- Create: `drizzle/000X_finance_tables.sql` (generated)

All amounts are stored as **integer minor units** (pence/cents) to avoid float drift, with a `currency` per invoice (PRD §5.8: currency fixed per invoice; £ primary, USD/EUR presentment).

- [ ] **Step 1: Append finance enums + tables to `src/db/schema.ts`**

Add these imports if not already present at the top of the file:
```ts
import { integer, boolean, date, jsonb, index } from 'drizzle-orm/pg-core'
```

Then append (after the Plan 01 tables; `organizations` is already exported there):
```ts
// ─── Finance enums ──────────────────────────────────────────────────────────
export const invoiceType = pgEnum('invoice_type', ['retainer', 'one_off'])
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'past_due',
  'void',
  'uncollectible',
])
export const paymentStatus = pgEnum('payment_status', ['succeeded', 'pending', 'failed', 'refunded'])
export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'trialing',
  'unpaid',
])
export const paymentProvider = pgEnum('payment_provider', ['stripe', 'gocardless'])

// ─── customer (1:1 with a client organization) ──────────────────────────────
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').unique(),
    gocardlessCustomerId: text('gocardless_customer_id'),
    defaultCurrency: text('default_currency').notNull().default('gbp'),
    vatNumber: text('vat_number'),
    billingEmail: text('billing_email'),
    billingAddress: jsonb('billing_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('idx_customers_org').on(t.organizationId),
    uniqOrg: unique('uniq_customer_org').on(t.organizationId),
  }),
)

// ─── subscription / retainer ────────────────────────────────────────────────
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull().default('stripe'),
    providerSubscriptionId: text('provider_subscription_id').unique(),
    amount: integer('amount').notNull(), // minor units, recurring
    currency: text('currency').notNull().default('gbp'),
    interval: text('interval').notNull().default('month'),
    dayOfMonth: integer('day_of_month'),
    status: subscriptionStatus('status').notNull().default('incomplete'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('idx_subscriptions_org').on(t.organizationId, t.status),
  }),
)

// ─── invoice ────────────────────────────────────────────────────────────────
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: invoiceType('type').notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    provider: paymentProvider('provider').notNull().default('stripe'),
    providerInvoiceId: text('provider_invoice_id').unique(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    currency: text('currency').notNull().default('gbp'),
    subtotal: integer('subtotal').notNull().default(0),
    taxTotal: integer('tax_total').notNull().default(0),
    total: integer('total').notNull().default(0),
    amountPaid: integer('amount_paid').notNull().default(0),
    dueDate: date('due_date'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    hostedUrl: text('hosted_url'),
    pdfUrl: text('pdf_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgStatusIdx: index('idx_invoices_org_status').on(t.organizationId, t.status),
    orgIssuedIdx: index('idx_invoices_org_issued').on(t.organizationId, t.issuedAt),
  }),
)

// ─── line_item ──────────────────────────────────────────────────────────────
export const lineItems = pgTable(
  'line_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitAmount: integer('unit_amount').notNull(), // minor units
    taxAmount: integer('tax_amount').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgInvoiceIdx: index('idx_line_items_org_invoice').on(t.organizationId, t.invoiceId),
  }),
)

// ─── payment ────────────────────────────────────────────────────────────────
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    provider: paymentProvider('provider').notNull().default('stripe'),
    providerPaymentId: text('provider_payment_id').unique(),
    amount: integer('amount').notNull(), // minor units
    currency: text('currency').notNull().default('gbp'),
    status: paymentStatus('status').notNull(),
    method: text('method'),
    feeAmount: integer('fee_amount'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgInvoiceIdx: index('idx_payments_org_invoice').on(t.organizationId, t.invoiceId),
  }),
)

// ─── revenue_target (agency-wide monthly target) ────────────────────────────
export const revenueTargets = pgTable(
  'revenue_targets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    period: date('period').notNull(), // first day of the target month
    targetAmount: integer('target_amount').notNull(), // minor units
    currency: text('currency').notNull().default('gbp'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgPeriod: unique('uniq_target_org_period').on(t.organizationId, t.period),
    orgIdx: index('idx_revenue_targets_org').on(t.organizationId, t.period),
  }),
)

// ─── stripe_event (idempotency ledger — dedupe webhooks on event.id) ─────────
// Not tenant-scoped by RLS: written only by the service-role webhook worker.
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(), // Stripe event.id
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  payload: jsonb('payload').notNull(),
})
```

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type {
  customers,
  subscriptions,
  invoices,
  lineItems,
  payments,
  revenueTargets,
  stripeEvents,
} from './schema'

export type Customer = typeof customers.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type LineItem = typeof lineItems.$inferSelect
export type Payment = typeof payments.$inferSelect
export type RevenueTarget = typeof revenueTargets.$inferSelect
export type StripeEvent = typeof stripeEvents.$inferSelect

export type InvoiceStatus = Invoice['status']
export type InvoiceType = Invoice['type']
export type SubscriptionStatus = Subscription['status']
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
pnpm db:generate
pnpm db:migrate
```
Expected: a `drizzle/000X_finance_tables.sql` with the enums + seven tables; migration applies cleanly. Verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*"
```
Expected: `customers`, `subscriptions`, `invoices`, `line_items`, `payments`, `revenue_targets`, `stripe_events` listed alongside the Plan 01/02 tables.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): finance schema (customer, invoice, line_item, payment, subscription, revenue_target, stripe_event)"
```

---

## Task 3: KEYSTONE — RLS isolation tests for the finance tables (watch them FAIL)

**Files:**
- Create: `tests/rls/finance-isolation.test.ts`

Every tenant-scoped finance table (`customers`, `subscriptions`, `invoices`, `line_items`, `payments`, `revenue_targets`) must obey the same isolation as Plan 01: a client sees only their own org's rows; agency staff see all. We seed minimal finance rows directly (service-role, bypassing RLS) then assert per-role visibility. RLS is not enabled yet, so these FAIL first.

- [ ] **Step 1: Write `tests/rls/finance-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('finance tenant isolation (RLS)', () => {
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

    // Seed one invoice per client org (service-role connection bypasses RLS).
    await sql`
      insert into public.invoices (organization_id, type, status, currency, subtotal, tax_total, total)
      values
        (${orgOne}, 'one_off', 'open', 'gbp', 10000, 2000, 12000),
        (${orgTwo}, 'one_off', 'open', 'gbp', 50000, 10000, 60000)
      on conflict do nothing
    `
    await sql`
      insert into public.customers (organization_id, default_currency)
      values (${orgOne}, 'gbp'), (${orgTwo}, 'gbp')
      on conflict (organization_id) do nothing
    `
  })

  afterAll(async () => {
    await sql`delete from public.invoices where organization_id in (${orgOne}, ${orgTwo})`
    await sql`delete from public.customers where organization_id in (${orgOne}, ${orgTwo})`
    await sql.end()
  })

  it('a client user sees ONLY their own org invoices', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select total from public.invoices`)
    expect(rows.map((r) => r.total)).toEqual([12000])
  })

  it('agency staff (founder) sees ALL invoices', async () => {
    const rows = await asUser(founder, (tx) => tx`select total from public.invoices order by total`)
    expect(rows.map((r) => r.total)).toEqual([12000, 60000])
  })

  it('a client user cannot read another org customer record', async () => {
    const rows = await asUser(
      clientOneUser,
      (tx) => tx`select organization_id from public.customers`,
    )
    const leaked = rows.some((r) => r.organization_id === orgTwo)
    expect(leaked).toBe(false)
  })

  it('a client user cannot INSERT an invoice for another org', async () => {
    await expect(
      asUser(
        clientOneUser,
        (tx) =>
          tx`insert into public.invoices (organization_id, type, status, total)
             values (${orgTwo}, 'one_off', 'draft', 999)`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they FAIL**

Run: `pnpm test tests/rls/finance-isolation.test.ts`
Expected: FAIL — with RLS not yet enabled the client user sees both invoices (`[12000, 60000]`) and the cross-org INSERT succeeds. This proves the tests are real.

- [ ] **Step 3: Commit the failing tests**

```bash
git add -A
git commit -m "test(rls): finance tenant-isolation tests (failing — RLS not enabled)"
```

---

## Task 4: Enable RLS + policies on the finance tables → make the tests PASS

**Files:**
- Create: `drizzle/000Y_finance_rls.sql` (custom SQL migration)

We reuse the Plan 01 helpers `public.has_org_access(uuid)` (staff OR member of the org) and `public.is_agency_staff()`. Clients get **read-only** access to their own finance rows; **writes are staff-only** (no client can mutate invoices/payments — the PRD permission matrix forbids it; clients pay via the Stripe-hosted page, and reconciliation happens server-side via the webhook worker under `service_role`, which bypasses RLS). `stripe_events` has RLS enabled with **no policy** (deny-all to anon/authenticated; only `service_role` touches it).

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=finance_rls`
Expected: an empty `drizzle/000Y_finance_rls.sql` registered in the journal.

- [ ] **Step 2: Fill in `drizzle/000Y_finance_rls.sql`**

```sql
-- Enable RLS on all finance tables.
alter table public.customers       enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.invoices        enable row level security;
alter table public.line_items      enable row level security;
alter table public.payments        enable row level security;
alter table public.revenue_targets enable row level security;
alter table public.stripe_events   enable row level security;

-- ── customers ───────────────────────────────────────────────────────────────
create policy customers_select on public.customers
  for select using (public.has_org_access(organization_id));
create policy customers_write on public.customers
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── subscriptions ────────────────────────────────────────────────────────────
create policy subscriptions_select on public.subscriptions
  for select using (public.has_org_access(organization_id));
create policy subscriptions_write on public.subscriptions
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── invoices (clients read own; only staff write) ────────────────────────────
create policy invoices_select on public.invoices
  for select using (public.has_org_access(organization_id));
create policy invoices_write on public.invoices
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── line_items ───────────────────────────────────────────────────────────────
create policy line_items_select on public.line_items
  for select using (public.has_org_access(organization_id));
create policy line_items_write on public.line_items
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── payments (clients read own; only staff/service write) ────────────────────
create policy payments_select on public.payments
  for select using (public.has_org_access(organization_id));
create policy payments_write on public.payments
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── revenue_targets (staff only — never client-visible) ──────────────────────
create policy revenue_targets_all on public.revenue_targets
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── stripe_events: RLS enabled, NO policy → only service_role can touch it ────
-- (intentionally no policy: deny-all to anon/authenticated)
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `000Y_finance_rls.sql` with no errors.

- [ ] **Step 4: Run the isolation tests and confirm they PASS**

Run: `pnpm test tests/rls/finance-isolation.test.ts`
Expected: all four tests PASS — the client sees only `[12000]`, the founder sees `[12000, 60000]`, no cross-org customer leak, and the cross-org INSERT is rejected by the `with check` clause.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): RLS policies for finance tables (isolation tests pass)"
```

---

## Task 5: Money helpers — minor units & currency formatting (TDD)

**Files:**
- Create: `tests/finance/money.test.ts`, `src/lib/finance/money.ts`

All persistence is in integer minor units; the UI and Stripe API both speak minor units, so we centralise conversion/formatting to avoid float drift and per-currency mistakes (most are 2-decimal; we keep it simple and correct for gbp/usd/eur).

- [ ] **Step 1: Write the failing test `tests/finance/money.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { toMinorUnits, fromMinorUnits, formatMoney, sumLineItems } from '@/lib/finance/money'

describe('money helpers', () => {
  it('converts major → minor units (2dp currencies)', () => {
    expect(toMinorUnits(10, 'gbp')).toBe(1000)
    expect(toMinorUnits(10.5, 'gbp')).toBe(1050)
    expect(toMinorUnits(0.01, 'usd')).toBe(1)
  })

  it('rounds half-up to avoid float drift', () => {
    expect(toMinorUnits(19.999, 'gbp')).toBe(2000)
    expect(toMinorUnits(0.005, 'gbp')).toBe(1)
  })

  it('converts minor → major units', () => {
    expect(fromMinorUnits(1050, 'gbp')).toBe(10.5)
  })

  it('formats with currency symbol', () => {
    expect(formatMoney(120000, 'gbp')).toBe('£1,200.00')
    expect(formatMoney(60000, 'usd')).toBe('$600.00')
    expect(formatMoney(5000, 'eur')).toBe('€50.00')
  })

  it('sums line items (qty × unit + tax) in minor units', () => {
    const items = [
      { quantity: 2, unitAmount: 5000, taxAmount: 2000 },
      { quantity: 1, unitAmount: 10000, taxAmount: 2000 },
    ]
    // subtotal = 2*5000 + 1*10000 = 20000; tax = 4000; total = 24000
    expect(sumLineItems(items)).toEqual({ subtotal: 20000, taxTotal: 4000, total: 24000 })
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/finance/money.test.ts`
Expected: FAIL — `src/lib/finance/money.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement `src/lib/finance/money.ts`**

```ts
const MINOR_UNIT_FACTOR: Record<string, number> = { gbp: 100, usd: 100, eur: 100 }
const SYMBOL: Record<string, string> = { gbp: '£', usd: '$', eur: '€' }

function factor(currency: string): number {
  return MINOR_UNIT_FACTOR[currency.toLowerCase()] ?? 100
}

export function toMinorUnits(major: number, currency: string): number {
  return Math.round(major * factor(currency))
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / factor(currency)
}

export function formatMoney(minor: number, currency: string): string {
  const c = currency.toLowerCase()
  const symbol = SYMBOL[c] ?? ''
  const major = fromMinorUnits(minor, c)
  const formatted = major.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

export function sumLineItems(
  items: Array<{ quantity: number; unitAmount: number; taxAmount: number }>,
): { subtotal: number; taxTotal: number; total: number } {
  const subtotal = items.reduce((acc, i) => acc + i.quantity * i.unitAmount, 0)
  const taxTotal = items.reduce((acc, i) => acc + i.taxAmount, 0)
  return { subtotal, taxTotal, total: subtotal + taxTotal }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/finance/money.test.ts`
Expected: all five tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(finance): minor-units money helpers + currency formatting (tested)"
```

---

## Task 6: Stripe client singleton + StripeConnector (provider abstraction)

**Files:**
- Create: `src/lib/stripe/client.ts`, `src/lib/stripe/connector.ts`

The connector is the **only** module that imports the Stripe SDK directly, so the rest of the app (and a future GoCardless provider) sees a stable `PaymentProvider` interface. `fetch()`/`normalize()` shape from PRD §6.2 is honoured: high-level methods plus a `verifyWebhook` for the intake route.

- [ ] **Step 1: Stripe SDK singleton `src/lib/stripe/client.ts`**

```ts
import 'server-only'
import Stripe from 'stripe'
import { env } from '@/env'

// Pin the API version so a Stripe-side bump never silently changes behaviour (PRD §11 versioning).
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-12-15.basil',
  typescript: true,
})
```

> If the pinned `apiVersion` string is rejected by your installed `stripe` SDK, set it to the value the SDK's `Stripe.LatestApiVersion` exports; the point is that it is explicitly pinned, not floating.

- [ ] **Step 2: Connector `src/lib/stripe/connector.ts`**

```ts
import 'server-only'
import type Stripe from 'stripe'
import { stripe } from './client'

export interface CreateCustomerInput {
  organizationId: string
  name: string
  email?: string
  vatNumber?: string | null
  currency: string
}

export interface OneOffLineInput {
  description: string
  quantity: number
  unitAmount: number // minor units
}

export const StripeConnector = {
  /** Create a Stripe Customer; tag with our org id for reverse-mapping (defense in depth). */
  async createCustomer(input: CreateCustomerInput): Promise<Stripe.Customer> {
    return stripe.customers.create({
      name: input.name,
      email: input.email,
      currency: input.currency,
      metadata: { organization_id: input.organizationId },
      ...(input.vatNumber
        ? { tax_id_data: [{ type: 'gb_vat', value: input.vatNumber }] }
        : {}),
    })
  },

  /** One-off invoice: attach InvoiceItems, create with auto-tax, finalize, send. */
  async createOneOffInvoice(args: {
    stripeCustomerId: string
    organizationId: string
    currency: string
    lines: OneOffLineInput[]
    daysUntilDue: number
  }): Promise<Stripe.Invoice> {
    const invoice = await stripe.invoices.create({
      customer: args.stripeCustomerId,
      currency: args.currency,
      collection_method: 'send_invoice',
      days_until_due: args.daysUntilDue,
      auto_advance: false,
      automatic_tax: { enabled: true }, // Stripe Tax → UK VAT / reverse-charge
      metadata: { organization_id: args.organizationId },
    })
    for (const line of args.lines) {
      await stripe.invoiceItems.create({
        customer: args.stripeCustomerId,
        invoice: invoice.id,
        currency: args.currency,
        quantity: line.quantity,
        unit_amount: line.unitAmount,
        description: line.description,
      })
    }
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: true })
    await stripe.invoices.sendInvoice(finalized.id)
    return stripe.invoices.retrieve(finalized.id)
  },

  /** Retainer: a monthly recurring subscription on a created Price. */
  async createRetainer(args: {
    stripeCustomerId: string
    organizationId: string
    currency: string
    amount: number // minor units / month
    productName: string
    dayOfMonth?: number
  }): Promise<Stripe.Subscription> {
    const price = await stripe.prices.create({
      currency: args.currency,
      unit_amount: args.amount,
      recurring: { interval: 'month' },
      product_data: { name: args.productName },
    })
    return stripe.subscriptions.create({
      customer: args.stripeCustomerId,
      items: [{ price: price.id }],
      collection_method: 'send_invoice',
      days_until_due: 7,
      automatic_tax: { enabled: true },
      metadata: { organization_id: args.organizationId },
      ...(args.dayOfMonth ? { billing_cycle_anchor_config: { day_of_month: args.dayOfMonth } } : {}),
    })
  },

  /** Verify a webhook signature and return the parsed event (throws on tamper). */
  verifyWebhook(rawBody: string, signature: string, secret: string): Stripe.Event {
    return stripe.webhooks.constructEvent(rawBody, signature, secret)
  },
}

export type PaymentProvider = typeof StripeConnector
```

- [ ] **Step 3: Type-check (no dedicated test — exercised via reconcile/webhook tests with a stub)**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors. (The connector makes live Stripe calls, so it is unit-tested only through stubbed callers in Tasks 7 and 9; do not call the real API in CI.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(finance): stripe client singleton + StripeConnector provider abstraction"
```

---

## Task 7: Webhook reconciliation core (TDD) — idempotency + status flips

**Files:**
- Create: `tests/finance/webhook-idempotency.test.ts`, `tests/finance/reconcile.test.ts`
- Create: `src/lib/stripe/webhook.ts`, `src/lib/finance/invoices.ts`, `src/lib/finance/subscriptions.ts`

This is the heart of the module: a pure reconciliation layer that takes an already-verified Stripe event and mutates **our** tables, **deduped on `event.id`**, mapping the Stripe object → `organization_id` via the object's `metadata.organization_id` (set by the connector) with a fallback lookup by `stripeCustomerId`. We test it directly with synthetic event objects (no Stripe network, no signature) so it runs in CI.

> Test env: add Stripe dummy secrets so `src/env.ts` imports succeed where transitively pulled. In `vitest.config.ts` add an `env` block, or prepend the test files with `process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy'; process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy'`. The reconcile layer does **not** import the connector/SDK, so no real key is needed for these tests.

- [ ] **Step 1: Write `tests/finance/webhook-idempotency.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { recordAndCheckEvent } from '@/lib/stripe/webhook'

describe('webhook idempotency ledger', () => {
  const eventId = 'evt_test_dedupe_001'

  beforeAll(async () => {
    await sql`delete from public.stripe_events where id = ${eventId}`
  })
  afterAll(async () => {
    await sql`delete from public.stripe_events where id = ${eventId}`
    await sql.end()
  })

  it('records a new event as fresh, and a redelivery as duplicate', async () => {
    const evt = { id: eventId, type: 'invoice.paid', data: {} }
    const first = await recordAndCheckEvent(evt as never)
    expect(first.isDuplicate).toBe(false)
    const second = await recordAndCheckEvent(evt as never)
    expect(second.isDuplicate).toBe(true)
  })
})
```

- [ ] **Step 2: Write `tests/finance/reconcile.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { reconcileInvoiceEvent } from '@/lib/finance/invoices'

describe('invoice reconciliation', () => {
  let orgId: string
  const providerInvoiceId = 'in_test_reco_001'

  beforeAll(async () => {
    const [o] = await sql`select id from public.organizations where slug = 'client-one'`
    orgId = o!.id as string
    await sql`delete from public.invoices where provider_invoice_id = ${providerInvoiceId}`
    await sql`
      insert into public.invoices
        (organization_id, type, status, provider, provider_invoice_id, currency, subtotal, tax_total, total)
      values
        (${orgId}, 'one_off', 'open', 'stripe', ${providerInvoiceId}, 'gbp', 10000, 2000, 12000)
    `
  })
  afterAll(async () => {
    await sql`delete from public.payments where organization_id = ${orgId}`
    await sql`delete from public.invoices where provider_invoice_id = ${providerInvoiceId}`
    await sql.end()
  })

  it('invoice.paid flips status to paid and stamps amount_paid + paid_at', async () => {
    const event = {
      id: 'evt_paid_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: providerInvoiceId,
          object: 'invoice',
          amount_paid: 12000,
          currency: 'gbp',
          status: 'paid',
          hosted_invoice_url: 'https://pay.stripe.test/x',
          invoice_pdf: 'https://pay.stripe.test/x.pdf',
          metadata: { organization_id: orgId },
        },
      },
    }
    await reconcileInvoiceEvent(event as never)
    const [row] = await sql`select status, amount_paid, paid_at, hosted_url from public.invoices where provider_invoice_id = ${providerInvoiceId}`
    expect(row!.status).toBe('paid')
    expect(row!.amount_paid).toBe(12000)
    expect(row!.paid_at).not.toBeNull()
    expect(row!.hosted_url).toBe('https://pay.stripe.test/x')
  })

  it('invoice.payment_failed flips status to past_due', async () => {
    const event = {
      id: 'evt_fail_1',
      type: 'invoice.payment_failed',
      data: { object: { id: providerInvoiceId, object: 'invoice', metadata: { organization_id: orgId } } },
    }
    await reconcileInvoiceEvent(event as never)
    const [row] = await sql`select status from public.invoices where provider_invoice_id = ${providerInvoiceId}`
    expect(row!.status).toBe('past_due')
  })
})
```

- [ ] **Step 3: Run both and confirm they FAIL**

Run: `pnpm test tests/finance/webhook-idempotency.test.ts tests/finance/reconcile.test.ts`
Expected: FAIL — `@/lib/stripe/webhook` and `@/lib/finance/invoices` do not exist yet (module not found).

- [ ] **Step 4: Implement the idempotency ledger `src/lib/stripe/webhook.ts`**

```ts
import 'server-only'
import type Stripe from 'stripe'
import { db } from '@/db'
import { stripeEvents } from '@/db/schema'

/**
 * Atomically record the event. Returns isDuplicate=true if event.id was already seen.
 * Uses INSERT ... ON CONFLICT DO NOTHING so concurrent redeliveries are safe.
 */
export async function recordAndCheckEvent(
  event: Stripe.Event,
): Promise<{ isDuplicate: boolean }> {
  const inserted = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type, payload: event as unknown as object })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id })
  return { isDuplicate: inserted.length === 0 }
}

export async function markEventProcessed(eventId: string): Promise<void> {
  const { eq } = await import('drizzle-orm')
  await db
    .update(stripeEvents)
    .set({ processedAt: new Date() })
    .where(eq(stripeEvents.id, eventId))
}
```

- [ ] **Step 5: Implement invoice reconciliation `src/lib/finance/invoices.ts`**

```ts
import 'server-only'
import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { invoices, payments, customers } from '@/db/schema'

/** Resolve our organization_id from a Stripe object's metadata, falling back to the customer map. */
async function resolveOrgId(
  obj: { metadata?: Record<string, string> | null; customer?: string | null },
): Promise<string | null> {
  const fromMeta = obj.metadata?.organization_id
  if (fromMeta) return fromMeta
  if (obj.customer) {
    const [c] = await db
      .select({ organizationId: customers.organizationId })
      .from(customers)
      .where(eq(customers.stripeCustomerId, obj.customer))
      .limit(1)
    return c?.organizationId ?? null
  }
  return null
}

/** Reconcile invoice.* events into our invoices/payments tables. Map provider id → org. */
export async function reconcileInvoiceEvent(event: Stripe.Event): Promise<void> {
  const obj = event.data.object as Stripe.Invoice
  const orgId = await resolveOrgId(obj as never)
  if (!orgId) throw new Error(`Cannot map Stripe invoice ${obj.id} to an organization`)

  if (event.type === 'invoice.paid') {
    await db
      .update(invoices)
      .set({
        status: 'paid',
        amountPaid: obj.amount_paid ?? 0,
        paidAt: new Date(),
        hostedUrl: obj.hosted_invoice_url ?? undefined,
        pdfUrl: obj.invoice_pdf ?? undefined,
      })
      .where(and(eq(invoices.providerInvoiceId, obj.id), eq(invoices.organizationId, orgId)))

    // Record the payment (idempotent on provider_payment_id).
    const paymentIntent =
      typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id
    if (paymentIntent) {
      await db
        .insert(payments)
        .values({
          organizationId: orgId,
          provider: 'stripe',
          providerPaymentId: paymentIntent,
          amount: obj.amount_paid ?? 0,
          currency: obj.currency ?? 'gbp',
          status: 'succeeded',
          paidAt: new Date(),
        })
        .onConflictDoNothing({ target: payments.providerPaymentId })
    }
    return
  }

  if (event.type === 'invoice.payment_failed') {
    await db
      .update(invoices)
      .set({ status: 'past_due' })
      .where(and(eq(invoices.providerInvoiceId, obj.id), eq(invoices.organizationId, orgId)))
    return
  }

  if (event.type === 'invoice.finalized') {
    await db
      .update(invoices)
      .set({
        status: 'open',
        issuedAt: new Date(),
        subtotal: obj.subtotal ?? 0,
        taxTotal: obj.tax ?? 0,
        total: obj.total ?? 0,
        hostedUrl: obj.hosted_invoice_url ?? undefined,
        pdfUrl: obj.invoice_pdf ?? undefined,
      })
      .where(and(eq(invoices.providerInvoiceId, obj.id), eq(invoices.organizationId, orgId)))
    return
  }
}
```

- [ ] **Step 6: Implement subscription reconciliation `src/lib/finance/subscriptions.ts`**

```ts
import 'server-only'
import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { subscriptions, customers } from '@/db/schema'
import type { SubscriptionStatus } from '@/db/types'

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  trialing: 'trialing',
  unpaid: 'unpaid',
}

async function resolveOrgId(obj: {
  metadata?: Record<string, string> | null
  customer?: string | null
}): Promise<string | null> {
  const fromMeta = obj.metadata?.organization_id
  if (fromMeta) return fromMeta
  if (obj.customer) {
    const [c] = await db
      .select({ organizationId: customers.organizationId })
      .from(customers)
      .where(eq(customers.stripeCustomerId, obj.customer))
      .limit(1)
    return c?.organizationId ?? null
  }
  return null
}

/** Reconcile customer.subscription.* events into our subscriptions table. */
export async function reconcileSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const obj = event.data.object as Stripe.Subscription
  const orgId = await resolveOrgId(obj as never)
  if (!orgId) throw new Error(`Cannot map Stripe subscription ${obj.id} to an organization`)

  const mapped = STATUS_MAP[obj.status] ?? 'incomplete'
  const periodStart = obj.current_period_start
    ? new Date(obj.current_period_start * 1000)
    : null
  const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000) : null

  await db
    .update(subscriptions)
    .set({
      status: mapped,
      currentPeriodStart: periodStart ?? undefined,
      currentPeriodEnd: periodEnd ?? undefined,
    })
    .where(
      and(
        eq(subscriptions.providerSubscriptionId, obj.id),
        eq(subscriptions.organizationId, orgId),
      ),
    )
}
```

- [ ] **Step 7: Run the tests and confirm they PASS**

Run: `pnpm test tests/finance/webhook-idempotency.test.ts tests/finance/reconcile.test.ts`
Expected: idempotency test PASS (first fresh, redelivery duplicate); reconcile tests PASS (status flips to `paid` then `past_due`, `amount_paid`/`paid_at`/`hosted_url` stamped).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(finance): idempotent webhook ledger + invoice/subscription reconciliation (tested)"
```

---

## Task 8: The single signature-verified webhook endpoint + Inngest fan-out

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`
- Create: `src/lib/inngest/finance.ts` (the `stripe/event.received` handler)
- Modify: `src/app/api/inngest/route.ts` (register the finance functions)

The route does the minimum on the request path: read the **raw** body, **verify the signature**, **dedupe** on `event.id`, **enqueue** to Inngest, return `200` fast (PRD §6.2 "fast 200 + enqueue to worker"). The Inngest worker performs the actual reconciliation (so a slow DB write or a transient error retries without Stripe re-driving the HTTP endpoint).

- [ ] **Step 1: The webhook route `src/app/api/webhooks/stripe/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { StripeConnector } from '@/lib/stripe/connector'
import { recordAndCheckEvent } from '@/lib/stripe/webhook'
import { inngest } from '@/lib/inngest/client'

// Must run on Node (Stripe signature verification needs the raw body + crypto).
export const runtime = 'nodejs'
// Never cache a webhook.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 })
  }

  const rawBody = await req.text()
  let event
  try {
    event = StripeConnector.verifyWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return NextResponse.json(
      { error: `signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  // Dedupe on event.id BEFORE enqueueing — Stripe redelivers at-least-once.
  const { isDuplicate } = await recordAndCheckEvent(event)
  if (isDuplicate) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  await inngest.send({ name: 'stripe/event.received', data: { eventId: event.id } })
  return NextResponse.json({ received: true })
}
```

> **Why pass only `eventId`:** the worker re-reads the verified payload from `stripe_events.payload`, so the event body is stored once and the Inngest message stays small.

- [ ] **Step 2: The finance Inngest functions `src/lib/inngest/finance.ts`**

```ts
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { inngest } from './client'
import { db } from '@/db'
import { stripeEvents } from '@/db/schema'
import { markEventProcessed } from '@/lib/stripe/webhook'
import { reconcileInvoiceEvent } from '@/lib/finance/invoices'
import { reconcileSubscriptionEvent } from '@/lib/finance/subscriptions'

export const handleStripeEvent = inngest.createFunction(
  { id: 'finance-handle-stripe-event', retries: 5 },
  { event: 'stripe/event.received' },
  async ({ event, step }) => {
    const eventId = event.data.eventId as string

    const stripeEvent = await step.run('load-event', async () => {
      const [row] = await db
        .select({ payload: stripeEvents.payload, type: stripeEvents.type })
        .from(stripeEvents)
        .where(eq(stripeEvents.id, eventId))
        .limit(1)
      if (!row) throw new Error(`stripe event ${eventId} not found in ledger`)
      return row.payload as unknown as Stripe.Event
    })

    await step.run('reconcile', async () => {
      const t = stripeEvent.type
      if (t.startsWith('invoice.')) {
        await reconcileInvoiceEvent(stripeEvent)
      } else if (t.startsWith('customer.subscription.')) {
        await reconcileSubscriptionEvent(stripeEvent)
      }
      // Unhandled event types are acknowledged (recorded) and no-op'd intentionally.
    })

    await step.run('mark-processed', async () => {
      await markEventProcessed(eventId)
    })

    return { eventId, type: stripeEvent.type }
  },
)
```

- [ ] **Step 3: Register the function in `src/app/api/inngest/route.ts`**

Add `handleStripeEvent` to the `functions` array passed to `serve(...)`:
```ts
import { handleStripeEvent } from '@/lib/inngest/finance'
// ...
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    /* ...existing Plan 02 functions..., */
    handleStripeEvent,
  ],
})
```

- [ ] **Step 4: Local end-to-end webhook test with the Stripe CLI**

In three terminals:
```bash
# 1) app
pnpm dev
# 2) inngest dev server
pnpm dlx inngest-cli dev
# 3) forward Stripe events to the local endpoint
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copy the `whsec_...` printed by `stripe listen` into `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev`. Then trigger an event:
```bash
stripe trigger invoice.payment_succeeded
```
Expected: the `stripe listen` window shows the forwarded event returning `200`; the Inngest dev UI shows `finance-handle-stripe-event` running and succeeding; `stripe_events` has a row with `processed_at` set. Re-running `stripe trigger` with the same event id (or replaying from `stripe listen`) returns `{ duplicate: true }` and does not double-process.

> Note: `stripe trigger` creates objects without our `organization_id` metadata, so `reconcileInvoiceEvent` may throw "cannot map ... to an organization" for a synthetic invoice — that is expected and proves the mapping guard works. The Task 9 flow creates real invoices carrying the metadata, which reconcile cleanly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(finance): single signed Stripe webhook endpoint + Inngest reconciliation fan-out"
```

---

## Task 9: Customer + invoice + retainer creation flows (server actions, TDD on persistence)

**Files:**
- Create: `src/lib/finance/customers.ts`
- Modify: `src/lib/finance/invoices.ts` (add `createOneOffInvoice`)
- Modify: `src/lib/finance/subscriptions.ts` (add `createRetainer`)
- Create: `src/app/(internal)/finance/actions.ts`
- Create: `tests/finance/create-flows.test.ts`

These are the **write paths** staff use. They (1) ensure a Stripe Customer exists and is mirrored, (2) create the local draft invoice/subscription row carrying `providerInvoiceId`/`providerSubscriptionId` so the webhook can later match it, (3) write an `audit_event`. We TDD the **local persistence** by stubbing the connector (no live Stripe in CI).

- [ ] **Step 1: `ensureCustomer` in `src/lib/finance/customers.ts`**

```ts
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { customers, organizations } from '@/db/schema'
import { StripeConnector } from '@/lib/stripe/connector'
import type { Customer } from '@/db/types'

/** Idempotently ensure a Stripe Customer + mirrored row for an org. */
export async function ensureCustomer(organizationId: string): Promise<Customer> {
  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
    .limit(1)
  if (existing?.stripeCustomerId) return existing

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  if (!org) throw new Error(`organization ${organizationId} not found`)

  const currency = existing?.defaultCurrency ?? 'gbp'
  const stripeCustomer = await StripeConnector.createCustomer({
    organizationId,
    name: org.name,
    email: existing?.billingEmail ?? undefined,
    vatNumber: existing?.vatNumber ?? null,
    currency,
  })

  if (existing) {
    const [updated] = await db
      .update(customers)
      .set({ stripeCustomerId: stripeCustomer.id })
      .where(eq(customers.organizationId, organizationId))
      .returning()
    return updated!
  }
  const [created] = await db
    .insert(customers)
    .values({ organizationId, stripeCustomerId: stripeCustomer.id, defaultCurrency: currency })
    .returning()
  return created!
}
```

- [ ] **Step 2: Add `createOneOffInvoice` to `src/lib/finance/invoices.ts`**

Append:
```ts
import { customers as customersTable, lineItems } from '@/db/schema'
import { StripeConnector } from '@/lib/stripe/connector'
import { sumLineItems } from '@/lib/finance/money'
import { ensureCustomer } from '@/lib/finance/customers'
import type { Invoice } from '@/db/types'

export interface NewInvoiceLine {
  description: string
  quantity: number
  unitAmount: number // minor units
}

/** Create a one-off invoice in Stripe + mirror it locally (draft → open on finalize webhook). */
export async function createOneOffInvoice(args: {
  organizationId: string
  currency: string
  lines: NewInvoiceLine[]
  daysUntilDue: number
}): Promise<Invoice> {
  const customer = await ensureCustomer(args.organizationId)
  if (!customer.stripeCustomerId) throw new Error('customer has no stripe id')

  const stripeInvoice = await StripeConnector.createOneOffInvoice({
    stripeCustomerId: customer.stripeCustomerId,
    organizationId: args.organizationId,
    currency: args.currency,
    lines: args.lines,
    daysUntilDue: args.daysUntilDue,
  })

  const totals = sumLineItems(args.lines.map((l) => ({ ...l, taxAmount: 0 })))
  const [invoice] = await db
    .insert(invoices)
    .values({
      organizationId: args.organizationId,
      type: 'one_off',
      status: 'open',
      provider: 'stripe',
      providerInvoiceId: stripeInvoice.id,
      currency: args.currency,
      subtotal: stripeInvoice.subtotal ?? totals.subtotal,
      taxTotal: stripeInvoice.tax ?? 0,
      total: stripeInvoice.total ?? totals.total,
      issuedAt: new Date(),
      hostedUrl: stripeInvoice.hosted_invoice_url ?? undefined,
      pdfUrl: stripeInvoice.invoice_pdf ?? undefined,
    })
    .returning()

  await db.insert(lineItems).values(
    args.lines.map((l) => ({
      organizationId: args.organizationId,
      invoiceId: invoice!.id,
      description: l.description,
      quantity: l.quantity,
      unitAmount: l.unitAmount,
    })),
  )
  return invoice!
}
```

> Reference `customersTable` is imported for parity with future queries; if your linter flags it as unused, drop the import — the `ensureCustomer` import is the load-bearing one.

- [ ] **Step 3: Add `createRetainer` to `src/lib/finance/subscriptions.ts`**

Append:
```ts
import { StripeConnector } from '@/lib/stripe/connector'
import { ensureCustomer } from '@/lib/finance/customers'
import { organizations } from '@/db/schema'
import type { Subscription } from '@/db/types'

/** Create a monthly retainer subscription in Stripe + mirror it locally. */
export async function createRetainer(args: {
  organizationId: string
  currency: string
  amount: number // minor units / month
  dayOfMonth?: number
}): Promise<Subscription> {
  const customer = await ensureCustomer(args.organizationId)
  if (!customer.stripeCustomerId) throw new Error('customer has no stripe id')

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, args.organizationId))
    .limit(1)

  const stripeSub = await StripeConnector.createRetainer({
    stripeCustomerId: customer.stripeCustomerId,
    organizationId: args.organizationId,
    currency: args.currency,
    amount: args.amount,
    productName: `Monthly retainer — ${org?.name ?? args.organizationId}`,
    dayOfMonth: args.dayOfMonth,
  })

  const [sub] = await db
    .insert(subscriptions)
    .values({
      organizationId: args.organizationId,
      provider: 'stripe',
      providerSubscriptionId: stripeSub.id,
      amount: args.amount,
      currency: args.currency,
      interval: 'month',
      dayOfMonth: args.dayOfMonth ?? null,
      status: 'active',
      currentPeriodStart: stripeSub.current_period_start
        ? new Date(stripeSub.current_period_start * 1000)
        : null,
      currentPeriodEnd: stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : null,
    })
    .returning()
  return sub!
}
```

- [ ] **Step 4: Write `tests/finance/create-flows.test.ts` (stub the connector)**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Stub the connector so no live Stripe call happens; assert our DB mirror is correct.
vi.mock('@/lib/stripe/connector', () => ({
  StripeConnector: {
    createCustomer: vi.fn(async (i: { organizationId: string }) => ({
      id: `cus_stub_${i.organizationId.slice(0, 8)}`,
    })),
    createOneOffInvoice: vi.fn(async () => ({
      id: 'in_stub_1',
      subtotal: 20000,
      tax: 4000,
      total: 24000,
      hosted_invoice_url: 'https://pay.stripe.test/i',
      invoice_pdf: 'https://pay.stripe.test/i.pdf',
    })),
    createRetainer: vi.fn(async () => ({
      id: 'sub_stub_1',
      current_period_start: 1751000000,
      current_period_end: 1753678400,
    })),
  },
}))

import { sql } from '../helpers/db'
import { createOneOffInvoice } from '@/lib/finance/invoices'
import { createRetainer } from '@/lib/finance/subscriptions'

describe('finance create flows', () => {
  let orgId: string

  beforeAll(async () => {
    const [o] = await sql`select id from public.organizations where slug = 'client-one'`
    orgId = o!.id as string
    await sql`delete from public.customers where organization_id = ${orgId}`
  })
  afterAll(async () => {
    await sql`delete from public.line_items where organization_id = ${orgId}`
    await sql`delete from public.invoices where organization_id = ${orgId}`
    await sql`delete from public.subscriptions where organization_id = ${orgId}`
    await sql`delete from public.customers where organization_id = ${orgId}`
    await sql.end()
  })

  it('createOneOffInvoice mirrors the Stripe invoice + line items locally', async () => {
    const invoice = await createOneOffInvoice({
      organizationId: orgId,
      currency: 'gbp',
      lines: [
        { description: 'Landing page build', quantity: 2, unitAmount: 5000 },
        { description: 'Setup', quantity: 1, unitAmount: 10000 },
      ],
      daysUntilDue: 14,
    })
    expect(invoice.providerInvoiceId).toBe('in_stub_1')
    expect(invoice.total).toBe(24000)
    const lines = await sql`select count(*)::int as n from public.line_items where invoice_id = ${invoice.id}`
    expect(lines[0]!.n).toBe(2)
    // Customer was auto-created and mirrored.
    const [cust] = await sql`select stripe_customer_id from public.customers where organization_id = ${orgId}`
    expect(cust!.stripe_customer_id).toMatch(/^cus_stub_/)
  })

  it('createRetainer mirrors the Stripe subscription locally as active', async () => {
    const sub = await createRetainer({ organizationId: orgId, currency: 'gbp', amount: 150000 })
    expect(sub.providerSubscriptionId).toBe('sub_stub_1')
    expect(sub.amount).toBe(150000)
    expect(sub.status).toBe('active')
  })
})
```

- [ ] **Step 5: Run it and confirm it PASSES** (write paths persist correctly)

Run: `pnpm test tests/finance/create-flows.test.ts`
Expected: both tests PASS — invoice + 2 line items mirrored, customer auto-created, retainer mirrored as `active`.

- [ ] **Step 6: Server actions `src/app/(internal)/finance/actions.ts` (staff-only)**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { revenueTargets } from '@/db/schema'
import { createOneOffInvoice } from '@/lib/finance/invoices'
import { createRetainer } from '@/lib/finance/subscriptions'
import { toMinorUnits } from '@/lib/finance/money'
import { recordAuditEvent } from '@/lib/audit/record'

async function requireStaff() {
  const session = await getSession()
  if (!session || !isStaff(session.role)) throw new Error('forbidden')
  return session
}

export async function createOneOffInvoiceAction(formData: FormData) {
  const session = await requireStaff()
  const organizationId = String(formData.get('organizationId'))
  const currency = String(formData.get('currency') || 'gbp')
  const description = String(formData.get('description'))
  const amountMajor = Number(formData.get('amount'))
  const daysUntilDue = Number(formData.get('daysUntilDue') || 14)

  const invoice = await createOneOffInvoice({
    organizationId,
    currency,
    lines: [{ description, quantity: 1, unitAmount: toMinorUnits(amountMajor, currency) }],
    daysUntilDue,
  })

  await recordAuditEvent({
    actorId: session.userId,
    action: 'invoice.create',
    targetId: invoice.id,
    metadata: { organizationId, total: invoice.total, providerInvoiceId: invoice.providerInvoiceId },
  })
  revalidatePath('/finance/invoices')
}

export async function createRetainerAction(formData: FormData) {
  const session = await requireStaff()
  const organizationId = String(formData.get('organizationId'))
  const currency = String(formData.get('currency') || 'gbp')
  const amountMajor = Number(formData.get('amount'))
  const dayOfMonth = formData.get('dayOfMonth') ? Number(formData.get('dayOfMonth')) : undefined

  const sub = await createRetainer({
    organizationId,
    currency,
    amount: toMinorUnits(amountMajor, currency),
    dayOfMonth,
  })

  await recordAuditEvent({
    actorId: session.userId,
    action: 'subscription.create',
    targetId: sub.id,
    metadata: { organizationId, amount: sub.amount },
  })
  revalidatePath('/finance')
}

export async function setRevenueTargetAction(formData: FormData) {
  const session = await requireStaff()
  const period = String(formData.get('period')) // 'YYYY-MM-01'
  const currency = String(formData.get('currency') || 'gbp')
  const targetMajor = Number(formData.get('target'))
  const agencyOrgId = session.orgId
  if (!agencyOrgId) throw new Error('no org context')

  await db
    .insert(revenueTargets)
    .values({
      organizationId: agencyOrgId,
      period,
      targetAmount: toMinorUnits(targetMajor, currency),
      currency,
    })
    .onConflictDoUpdate({
      target: [revenueTargets.organizationId, revenueTargets.period],
      set: { targetAmount: toMinorUnits(targetMajor, currency) },
    })
  revalidatePath('/finance')
}
```

> `recordAuditEvent({ actorId, action, targetId, metadata })` is the Plan 02 helper. If its signature differs, adapt the call sites — the requirement (PRD §5.14) is that every money write produces an immutable audit row.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(finance): customer/invoice/retainer create flows + staff server actions (tested)"
```

---

## Task 10: Finance metrics queries (TDD) — MRR, outstanding, paid vs overdue, revenue vs target

**Files:**
- Create: `tests/finance/metrics.test.ts`, `src/lib/finance/metrics.ts`

These power the Finance dashboard and feed the Cockpit (PRD §5.1, §5.8). All run server-side under `service_role` for agency-wide aggregation (this is an admin/jobs read, allowed by the shared conventions; it is staff-gated at the page layer).

- [ ] **Step 1: Write `tests/finance/metrics.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { getMrr, getOutstanding, getPaidVsOverdue } from '@/lib/finance/metrics'

describe('finance metrics', () => {
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1!.id as string
    orgTwo = o2!.id as string

    await sql`delete from public.subscriptions where organization_id in (${orgOne}, ${orgTwo})`
    await sql`delete from public.invoices where organization_id in (${orgOne}, ${orgTwo})`

    // Two active retainers (MRR contributors) + one canceled (excluded).
    await sql`
      insert into public.subscriptions (organization_id, provider, amount, currency, interval, status)
      values
        (${orgOne}, 'stripe', 150000, 'gbp', 'month', 'active'),
        (${orgTwo}, 'stripe', 100000, 'gbp', 'month', 'active'),
        (${orgTwo}, 'stripe', 999999, 'gbp', 'month', 'canceled')
    `
    // Invoices: one paid, one open, one past_due.
    await sql`
      insert into public.invoices (organization_id, type, status, currency, total, amount_paid)
      values
        (${orgOne}, 'one_off', 'paid', 'gbp', 24000, 24000),
        (${orgOne}, 'one_off', 'open', 'gbp', 12000, 0),
        (${orgTwo}, 'one_off', 'past_due', 'gbp', 60000, 0)
    `
  })
  afterAll(async () => {
    await sql`delete from public.subscriptions where organization_id in (${orgOne}, ${orgTwo})`
    await sql`delete from public.invoices where organization_id in (${orgOne}, ${orgTwo})`
    await sql.end()
  })

  it('MRR sums only active retainers (minor units)', async () => {
    expect(await getMrr()).toBe(250000) // 150000 + 100000
  })

  it('outstanding = open + past_due totals minus amount_paid', async () => {
    expect(await getOutstanding()).toBe(72000) // 12000 + 60000
  })

  it('paid vs overdue splits totals correctly', async () => {
    const split = await getPaidVsOverdue()
    expect(split.paid).toBe(24000)
    expect(split.overdue).toBe(60000)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/finance/metrics.test.ts`
Expected: FAIL — `@/lib/finance/metrics` not found.

- [ ] **Step 3: Implement `src/lib/finance/metrics.ts`**

```ts
import 'server-only'
import { and, eq, inArray, sql as dsql } from 'drizzle-orm'
import { db } from '@/db'
import { subscriptions, invoices, revenueTargets } from '@/db/schema'

/** Monthly Recurring Revenue: sum of active retainer amounts (minor units). */
export async function getMrr(): Promise<number> {
  const [row] = await db
    .select({ total: dsql<number>`coalesce(sum(${subscriptions.amount}), 0)::int` })
    .from(subscriptions)
    .where(eq(subscriptions.status, 'active'))
  return row?.total ?? 0
}

/** Outstanding: unpaid balance on open + past_due invoices (total - amount_paid). */
export async function getOutstanding(): Promise<number> {
  const [row] = await db
    .select({
      total: dsql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)::int`,
    })
    .from(invoices)
    .where(inArray(invoices.status, ['open', 'past_due']))
  return row?.total ?? 0
}

/** Paid vs overdue split (minor units). */
export async function getPaidVsOverdue(): Promise<{ paid: number; overdue: number }> {
  const [paidRow] = await db
    .select({ total: dsql<number>`coalesce(sum(${invoices.total}), 0)::int` })
    .from(invoices)
    .where(eq(invoices.status, 'paid'))
  const [overdueRow] = await db
    .select({ total: dsql<number>`coalesce(sum(${invoices.total}), 0)::int` })
    .from(invoices)
    .where(eq(invoices.status, 'past_due'))
  return { paid: paidRow?.total ?? 0, overdue: overdueRow?.total ?? 0 }
}

/** Recognised revenue for a month: paid invoices issued in that period. */
export async function getRecognisedRevenue(periodStart: Date, periodEnd: Date): Promise<number> {
  const [row] = await db
    .select({ total: dsql<number>`coalesce(sum(${invoices.amountPaid}), 0)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'paid'),
        dsql`${invoices.paidAt} >= ${periodStart.toISOString()}`,
        dsql`${invoices.paidAt} < ${periodEnd.toISOString()}`,
      ),
    )
  return row?.total ?? 0
}

/** Current month's target for the agency org (minor units), or null if unset. */
export async function getRevenueTarget(agencyOrgId: string, period: string): Promise<number | null> {
  const [row] = await db
    .select({ target: revenueTargets.targetAmount })
    .from(revenueTargets)
    .where(and(eq(revenueTargets.organizationId, agencyOrgId), eq(revenueTargets.period, period)))
    .limit(1)
  return row?.target ?? null
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/finance/metrics.test.ts`
Expected: MRR = 250000, outstanding = 72000, paid = 24000, overdue = 60000 — all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(finance): MRR/outstanding/paid-vs-overdue/target metrics (tested)"
```

---

## Task 11: Finance dashboard + invoice list (internal) and client portal invoices

**Files:**
- Create: `src/components/finance/revenue-gauge.tsx`, `src/components/finance/paid-overdue-chart.tsx`
- Create: `src/app/(internal)/finance/page.tsx`, `src/app/(internal)/finance/invoices/page.tsx`
- Create: `src/app/(portal)/invoices/page.tsx`

Internal pages are staff-gated (the `(internal)` layout from Plan 01 already redirects clients). The portal page reads under the client's session so RLS scopes it to their own org; the "Pay" button links to the Stripe-hosted `hostedUrl` (we never reconcile from the redirect).

- [ ] **Step 1: Revenue gauge `src/components/finance/revenue-gauge.tsx`**

```tsx
'use client'
import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts'
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
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">Revenue vs target</p>
      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <p className="text-center text-lg font-semibold">
        {formatMoney(current, currency)} <span className="text-muted-foreground">/ {formatMoney(target, currency)}</span>
      </p>
      <p className="text-center text-sm text-muted-foreground">{pct}% of target</p>
    </div>
  )
}
```

- [ ] **Step 2: Paid-vs-overdue chart `src/components/finance/paid-overdue-chart.tsx`**

```tsx
'use client'
import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { formatMoney } from '@/lib/finance/money'

export function PaidOverdueChart({
  paid,
  overdue,
  currency,
}: {
  paid: number
  overdue: number
  currency: string
}) {
  const data = [
    { name: 'Paid', amount: paid, fill: 'var(--chart-2, #16a34a)' },
    { name: 'Overdue', amount: overdue, fill: 'var(--chart-3, #dc2626)' },
  ]
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-2 text-sm text-muted-foreground">Paid vs overdue</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <XAxis dataKey="name" />
          <YAxis tickFormatter={(v) => formatMoney(Number(v), currency)} width={80} />
          <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 3: Finance dashboard `src/app/(internal)/finance/page.tsx`**

```tsx
import { getSession } from '@/lib/auth'
import {
  getMrr,
  getOutstanding,
  getPaidVsOverdue,
  getRecognisedRevenue,
  getRevenueTarget,
} from '@/lib/finance/metrics'
import { formatMoney } from '@/lib/finance/money'
import { RevenueGauge } from '@/components/finance/revenue-gauge'
import { PaidOverdueChart } from '@/components/finance/paid-overdue-chart'

export const dynamic = 'force-dynamic' // tenant data must never be statically cached (PRD §9)

export default async function FinanceDashboard() {
  const session = await getSession()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const period = monthStart.toISOString().slice(0, 10) // YYYY-MM-01

  const [mrr, outstanding, split, recognised, target] = await Promise.all([
    getMrr(),
    getOutstanding(),
    getPaidVsOverdue(),
    getRecognisedRevenue(monthStart, nextMonth),
    session?.orgId ? getRevenueTarget(session.orgId, period) : Promise.resolve(null),
  ])
  const currentVsTarget = mrr + recognised

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Finance</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="MRR" value={formatMoney(mrr, 'gbp')} />
        <Stat label="One-off (this month)" value={formatMoney(recognised, 'gbp')} />
        <Stat label="Outstanding" value={formatMoney(outstanding, 'gbp')} />
        <Stat label="Overdue" value={formatMoney(split.overdue, 'gbp')} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <RevenueGauge current={currentVsTarget} target={target ?? 0} currency="gbp" />
        <PaidOverdueChart paid={split.paid} overdue={split.overdue} currency="gbp" />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  )
}
```

- [ ] **Step 4: Internal invoice list `src/app/(internal)/finance/invoices/page.tsx`**

```tsx
import { db } from '@/db'
import { invoices, organizations } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { formatMoney } from '@/lib/finance/money'

export const dynamic = 'force-dynamic'

export default async function InvoicesPage() {
  const rows = await db
    .select({
      id: invoices.id,
      org: organizations.name,
      type: invoices.type,
      status: invoices.status,
      total: invoices.total,
      currency: invoices.currency,
      dueDate: invoices.dueDate,
      hostedUrl: invoices.hostedUrl,
    })
    .from(invoices)
    .leftJoin(organizations, eq(organizations.id, invoices.organizationId))
    .orderBy(desc(invoices.createdAt))
    .limit(200)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Invoices</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="p-2">Client</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Total</th><th className="p-2">Due</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{r.org}</td>
              <td className="p-2">{r.type}</td>
              <td className="p-2"><StatusBadge status={r.status} /></td>
              <td className="p-2">{formatMoney(r.total, r.currency)}</td>
              <td className="p-2">{r.dueDate ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'paid' ? 'bg-green-100 text-green-800'
    : status === 'past_due' ? 'bg-red-100 text-red-800'
    : status === 'open' ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 text-gray-800'
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{status}</span>
}
```

- [ ] **Step 5: Portal invoices `src/app/(portal)/invoices/page.tsx` (RLS-scoped + Pay button)**

```tsx
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatMoney } from '@/lib/finance/money'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function PortalInvoices() {
  // Read through the user's Supabase session so RLS scopes rows to their own org.
  const supabase = await createSupabaseServerClient()
  const { data: rows } = await supabase
    .from('invoices')
    .select('id, type, status, total, currency, due_date, hosted_url')
    .order('created_at', { ascending: false })

  const list = rows ?? []
  const outstanding = list
    .filter((i) => i.status === 'open' || i.status === 'past_due')
    .reduce((acc, i) => acc + (i.total as number), 0)

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Outstanding balance</p>
        <p className="text-2xl font-semibold">{formatMoney(outstanding, 'gbp')}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Total</th><th className="p-2">Due</th><th className="p-2"></th></tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id} className="border-t">
              <td className="p-2">{i.type}</td>
              <td className="p-2">{i.status}</td>
              <td className="p-2">{formatMoney(i.total as number, i.currency as string)}</td>
              <td className="p-2">{i.due_date ?? '—'}</td>
              <td className="p-2">
                {(i.status === 'open' || i.status === 'past_due') && i.hosted_url ? (
                  <a href={i.hosted_url as string} target="_blank" rel="noreferrer">
                    <Button size="sm">Pay</Button>
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> **Why the portal uses the Supabase client (not Drizzle `db`):** Drizzle's `db` connects as a privileged role and bypasses RLS. Reading the client's invoices through `createSupabaseServerClient()` runs as the logged-in user under RLS, so isolation is enforced by the database (defense in depth). The "Pay" button opens the Stripe-hosted page; status only updates via the webhook (never the redirect).

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`, sign in as the founder → `/finance` shows MRR/outstanding/charts; `/finance/invoices` lists all clients' invoices. Sign in as `user1@clientone.com` → `/invoices` shows only Client One's invoices with a Pay button on open/past_due rows; no other client's invoices appear.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(finance): finance dashboard, internal invoice list, portal invoices + pay"
```

---

## Task 12: Retainer renewal cron + dunning (Inngest) and a final full-suite run

**Files:**
- Modify: `src/lib/inngest/finance.ts` (add renewal cron + dunning function)
- Modify: `src/app/api/inngest/route.ts` (register the new functions)

Stripe Billing auto-generates and (with `send_invoice`) emails the monthly retainer invoice — the renewal "creation" is Stripe-driven and lands as an `invoice.finalized` then `invoice.paid` webhook we already reconcile (PRD §5.8 "retainer renewals auto-create and email the monthly invoice"). Our cron's job is the **safety net + our own reminder emails**: detect retainers whose `current_period_end` has passed without our mirror catching up, and send dunning emails for `past_due` invoices (PRD §5.8 "act on `invoice.payment_failed`; surface `past_due`; reminder emails").

- [ ] **Step 1: Add the dunning + renewal-sweep functions to `src/lib/inngest/finance.ts`**

Append:
```ts
import { and, lt, eq as deq, inArray as dInArray } from 'drizzle-orm'
import { invoices as invoicesTable, subscriptions as subsTable, customers as customersTable } from '@/db/schema'
import { sendEmail } from '@/lib/email/resend'
import { formatMoney } from '@/lib/finance/money'

// Daily: email a reminder for every past_due invoice.
export const dunningReminders = inngest.createFunction(
  { id: 'finance-dunning-reminders' },
  { cron: '0 9 * * *' }, // 09:00 daily
  async ({ step }) => {
    const overdue = await step.run('load-overdue', async () =>
      db
        .select({
          id: invoicesTable.id,
          organizationId: invoicesTable.organizationId,
          total: invoicesTable.total,
          currency: invoicesTable.currency,
          hostedUrl: invoicesTable.hostedUrl,
        })
        .from(invoicesTable)
        .where(deq(invoicesTable.status, 'past_due')),
    )

    for (const inv of overdue) {
      await step.run(`remind-${inv.id}`, async () => {
        const [cust] = await db
          .select({ email: customersTable.billingEmail })
          .from(customersTable)
          .where(deq(customersTable.organizationId, inv.organizationId))
          .limit(1)
        if (!cust?.email) return { skipped: true }
        await sendEmail({
          to: cust.email,
          subject: 'Payment overdue — action needed',
          html: `<p>Your invoice for ${formatMoney(inv.total, inv.currency)} is overdue.</p>
                 ${inv.hostedUrl ? `<p><a href="${inv.hostedUrl}">Pay now</a></p>` : ''}`,
        })
        return { sent: true }
      })
    }
    return { reminded: overdue.length }
  },
)

// Hourly safety-net: flag retainers whose period has lapsed but mirror is stale,
// so the connection-health/finance views surface a problem even if a webhook was missed.
export const renewalSweep = inngest.createFunction(
  { id: 'finance-renewal-sweep' },
  { cron: '0 * * * *' },
  async ({ step }) => {
    const lapsed = await step.run('load-lapsed', async () =>
      db
        .select({ id: subsTable.id })
        .from(subsTable)
        .where(
          and(
            dInArray(subsTable.status, ['active', 'past_due']),
            lt(subsTable.currentPeriodEnd, new Date()),
          ),
        ),
    )
    // Surface-only: the next customer.subscription.updated webhook corrects state;
    // this count feeds an ops alert if it stays non-zero across runs.
    return { lapsedCount: lapsed.length }
  },
)
```

- [ ] **Step 2: Register both in `src/app/api/inngest/route.ts`**

```ts
import { handleStripeEvent, dunningReminders, renewalSweep } from '@/lib/inngest/finance'
// ...
functions: [
  /* ...existing... */
  handleStripeEvent,
  dunningReminders,
  renewalSweep,
],
```

- [ ] **Step 3: Verify the crons register**

Run `pnpm dlx inngest-cli dev` and `pnpm dev`; open the Inngest dev UI.
Expected: `finance-dunning-reminders` (daily 09:00) and `finance-renewal-sweep` (hourly) appear with their cron schedules. Trigger `finance-dunning-reminders` manually from the UI; with a seeded `past_due` invoice + billing email, it sends one reminder (visible in the Resend/Inngest run log).

- [ ] **Step 4: Run the FULL suite to mirror CI**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: lint clean; no type errors; all tests pass — Plan 01 RLS/auth tests, plus finance: `money`, `webhook-idempotency`, `reconcile`, `create-flows`, `metrics`, and `finance-isolation`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(finance): dunning reminders + retainer renewal sweep (Inngest crons)"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.8 Finance/Invoicing/Payments and §8 Data Model):**
- DB is system of record; Stripe is collection engine; webhooks reconcile, never the redirect → Task 7 (reconcile layer) + Task 8 (signed endpoint enqueues; status only flips on webhook) + Task 11 portal note. ✅
- Retainers = Stripe Billing Subscriptions (monthly Price) → `createRetainer` (Task 6 connector + Task 9). ✅
- One-off = Stripe Invoicing (InvoiceItems → finalize → send) → `createOneOffInvoice` (Task 6 connector + Task 9). ✅
- Invoice lifecycle draft→open/sent→paid/past_due/void/uncollectible + store `hosted_invoice_url`+`invoice_pdf` → `invoiceStatus` enum + reconcile stamps `hostedUrl`/`pdfUrl` (Tasks 2, 7). ✅
- Stripe Tax for UK VAT + reverse-charge; store VAT numbers + per-line tax → `automatic_tax: { enabled: true }`, `tax_id_data` gb_vat, `customers.vatNumber`, `line_items.taxAmount`, `invoices.taxTotal` (Tasks 2, 6). ✅
- £ primary, USD/EUR presentment, currency fixed per invoice → `currency` per invoice/line; money helpers (Tasks 2, 5). ✅
- Dunning on `invoice.payment_failed`; surface `past_due`; reminder emails → reconcile sets `past_due` (Task 7) + `dunningReminders` cron (Task 12). ✅
- Finance dashboard MRR/one-off/outstanding/paid-vs-overdue/revenue-vs-target feeding Cockpit → `metrics.ts` + dashboard (Tasks 10, 11). ✅
- Client sees/pays only own invoices → RLS policies + portal reads via Supabase session (Tasks 4, 11) + isolation test (Task 3). ✅
- Tables customer/invoice/line_item/payment/subscription/revenue_target → Task 2 (+ `stripe_event` dedupe ledger). ✅
- Single idempotent signature-verified webhook; map provider id → org → Task 8 route + `stripe_events` dedupe + `resolveOrgId` via `metadata.organization_id` w/ customer fallback (Task 7). ✅
- Acceptance: `invoice.paid` flips within minutes, idempotent on `event.id` (Tasks 7–8); retainer renewals auto-create/email (Stripe `send_invoice` + reconcile, Task 12); client can only see/pay own (Task 3); VAT applied/recorded (Tasks 2, 6). ✅
- GoCardless (Phase 3) behind a provider abstraction → `paymentProvider` enum + `PaymentProvider`/`StripeConnector` interface leave the seam; not built (correct — Phase 3). ✅
- Stripe test mode + Stripe CLI for webhook tests → Task 8 Step 4. ✅

**Shared-conventions compliance:** every tenant table carries `organization_id` as the leading column of a composite index (`idx_customers_org`, `idx_subscriptions_org`, `idx_invoices_org_status`/`_issued`, `idx_line_items_org_invoice`, `idx_payments_org_invoice`, `idx_revenue_targets_org`); RLS enabled on all and policies REUSE `public.has_org_access()`/`public.is_agency_staff()` (Task 4); `service_role` only in server-side metrics/webhook worker, never user-facing (portal uses anon+RLS); an RLS isolation test exists for the new tenant tables (Task 3, KEYSTONE). Canonical schema names from §8 used (`customer`→`customers`, `invoice`, `line_item`→`line_items`, `payment`→`payments`, `subscription`, `revenue_target`); `client_id` realised as `organization_id` per Plan 01 (noted up top). ✅

**Placeholder scan:** No TBD/TODO; every code step is complete and runnable. The two adapt-to-your-build notes (`recordAuditEvent` signature; pinned `apiVersion` fallback) are explicit integration instructions against named Plan 02/SDK seams, not code gaps. ✅

**Type consistency:** inferred types (`Customer`, `Invoice`, `Subscription`, `SubscriptionStatus`, etc.) from `src/db/types.ts` used across `finance/*`; enum literals (`invoice_type`, `invoice_status`, `subscription_status`, `payment_status`, `payment_provider`) consistent across schema, reconcile maps, metrics filters, and tests; `getMrr`/`getOutstanding`/`getPaidVsOverdue` names match between `metrics.ts` and `metrics.test.ts`/dashboard; `reconcileInvoiceEvent`/`reconcileSubscriptionEvent`/`recordAndCheckEvent`/`createOneOffInvoice`/`createRetainer`/`ensureCustomer` names consistent between definitions, the Inngest worker, server actions, and tests; minor-units integers used uniformly end-to-end. ✅

**Definition of done for Plan 04:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green (finance unit + reconcile + idempotency + metrics + RLS isolation), the Stripe CLI `stripe listen` → `stripe trigger` round-trip returns 200 and reconciles (with dedupe on redelivery), and the manual smoke test shows staff seeing the finance dashboard/all invoices while a client sees and can pay only their own.
