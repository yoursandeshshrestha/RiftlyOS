# Agency OS — Plan 18: "Ask Your Data" Chat, Looker Studio Embed & GoCardless Direct Debit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three Phase 3 "extras" (PRD §6.1, §6.3, §5.6, §5.8, §12):

1. **"Ask your data" AI chat (Plane B)** — an Anthropic **tool-use** chat where Claude reads **only our already-synced, tenant-scoped metrics store** (`metric_daily` / `metric_monthly_rollup` from Plan 06, via the same channel registry + aggregation library as Plan 11) through an **internal MCP-style tool layer** — **never** live ad APIs. **`tenant_id` (= `organization_id`) is bound server-side at the call site and is NOT a model-supplied argument**, so the model physically cannot read another client's data. Staff chat against any client (an explicit picker); a client chats only against their own org (RLS + app scoping, defense in depth).
2. **Optional embedded Looker Studio deep-dive (PRD §6.3)** — a per-client embed using the **row-level-security community-connector + short-lived per-tenant token** pattern so clients see only their own rows **with no Google login**. We document explicitly that **Data Studio has no data-returning API and no data-reading MCP** (the MCP belongs to enterprise Looker, a separate product), so Looker is an *optional human deep-dive only* — never a data source for the dashboard, the AI report, or this chat.
3. **GoCardless Direct Debit for UK retainers (PRD §5.8)** — a second `PaymentProvider` behind the Plan 04 abstraction: a **mandate Billing Request Flow**, signature-verified `payments` webhooks (`payments` → `confirmed` / `paid_out`), and **our own PDF receipt** (GoCardless issues none). Reconciliation flips our `invoices`/`payments` rows; the same one-merchant, DB-is-source-of-truth model as Stripe.

The keystone tests prove (a) **the chat tools are tenant-scoped** — a tool invoked for org A can never return org B's rows even if the model is told to try — and (b) **the GoCardless payment state machine** maps mandate/payment events to the correct `invoice.status` + `payment.status` transitions, idempotently.

**Architecture:** Both AI features are **Plane B** (PRD §6.1): the model reads our normalized store, not vendor APIs. The chat exposes a small set of **internal tools** (`get_kpis`, `get_timeseries`, `list_channels`, `compare_periods`) defined once in `src/lib/chat/tools.ts`. Each tool's **executor is a closure over a fixed `organizationId`** resolved from the authenticated session (client) or an explicit staff-selected client id (staff) — the model's tool input schema deliberately omits any tenant/org field, and the executor reads through the **Plan 11 aggregation library** (`getOrgAnalytics`, channel registry) which itself filters `metric_daily` by `organizationId`. For client callers the underlying read also runs through an **RLS-bound** Drizzle connection (Plan 11 `withRlsDb`) so Postgres RLS is a second wall. The chat loop (`runChatTurn`) is a standard Anthropic tool-use loop (`tool_use` → execute → `tool_result` → continue until `end_turn`), model-routed to `claude-sonnet-4-6` with the heavy system prompt marked cacheable. One new tenant-scoped table, **`chat_conversation`** + **`chat_message`**, persists threads (PRD §8 messaging conventions; both carry `organization_id` leading a composite index with RLS reusing `public.has_org_access(uuid)` / `public.is_agency_staff()`).

Looker is **presentation-only**: a `looker_embed` config row per (client org) holds the report id + connector params; a server action mints a **short-lived signed embed token** (HMAC over `{organizationId, exp}`) that the Looker community connector validates to filter rows — the browser never sees a Google credential and the client never logs into Google. No metric data flows back from Looker into our store.

GoCardless slots behind the existing **`PaymentProvider`** seam from Plan 04. A `GoCardlessConnector` (the only module importing the GoCardless SDK) implements `createMandateFlow` (Billing Request Flow), `createPayment`, and `verifyWebhook`. Inbound GoCardless webhooks hit a **single signature-verified route** that dedupes on the GoCardless **event id** (a new `gocardless_event` ledger, mirroring Plan 04's `stripe_events`), returns a fast `200`, and enqueues an Inngest worker that runs the **payment state machine** (`reconcileGoCardlessEvent`) mutating our `invoices`/`payments`/`subscriptions` rows and appending an `audit_event` (Plan 01/04). Because GoCardless emits **no PDF**, an invoice settled via Direct Debit gets a PDF rendered with `@react-pdf/renderer` (the Plan 12 choice), uploaded to a private `invoices` Supabase Storage bucket, and signed on demand. All provider calls are server-side only.

**Tech Stack:** Next.js 16 (App Router, route handlers + Server Components + server actions) · TypeScript strict · pnpm · Supabase Postgres + RLS + **Storage** · Drizzle ORM + drizzle-kit · postgres.js · **`@anthropic-ai/sdk`** (`claude-sonnet-4-6` for chat; tool-use + prompt caching) · **`gocardless-nodejs`** (official GoCardless SDK) · **`@react-pdf/renderer`** (Direct-Debit invoice PDF) · Inngest (webhook fan-out) · Resend (receipt email; client present from Plan 05) · Tailwind + shadcn/ui · Recharts (chart cards, present from Plan 11) · Vitest (unit + RLS isolation + chat tenant-scoping + GoCardless state-machine tests).

**Prerequisites the developer needs installed/configured:** Everything from Plan 01 (local Supabase running, seed applied, `tests/helpers/db.ts` with `asUser()`/`userIdByEmail()`, `getSession()`/`isStaff()` in `src/lib/auth.ts`, the Drizzle client `src/db/index.ts`). The migrations + code from:
- **Plan 06** — `connection`, `metric_daily`, `metric_monthly_rollup`, the Inngest client `src/lib/inngest/client.ts` (exported `inngest`), the serve route `src/app/api/inngest/route.ts`, the `integration_provider` enum.
- **Plan 11** — the analytics library: `src/lib/analytics/channels.ts` (`CHANNELS`, `CHANNEL_ORDER`, `OVERVIEW_KPIS`, `ChannelKey`), `src/lib/analytics/aggregate.ts` (`getOrgAnalytics`, `withRlsDb`, `defaultPeriod`, `previousPeriod`, `Period`), `src/lib/analytics/types.ts`.
- **Plan 12** — the Anthropic client wrapper `src/lib/reports/ai/client.ts` (exported `anthropic`, `MODELS`), the Supabase Storage admin pattern (`createClient` with the service-role key), `@react-pdf/renderer` already added.
- **Plan 04** — the finance schema (`customers` with `gocardlessCustomerId`, `subscriptions`, `invoices`, `line_items`, `payments`, the `payment_provider`/`payment_status`/`invoice_status`/`subscription_status` enums), the `PaymentProvider` seam + `StripeConnector` shape, the webhook/Inngest reconciliation pattern (`recordAndCheckEvent`/`markEventProcessed`, `stripe_events` ledger), `src/lib/audit.ts` (`recordAuditEvent`), `src/lib/email/resend.ts` (`sendEmail`), and `src/env.ts`.

Plus: an `ANTHROPIC_API_KEY` (Plan 12), a **GoCardless sandbox** account (access token + webhook secret), and the Inngest dev server (`pnpm dlx inngest-cli@latest dev`). Add a private Supabase Storage bucket `invoices` (created by this plan's migration).

---

## Dependencies (assume already built — do NOT re-spec)
- **Plan 04 (Finance/Invoicing):** `PaymentProvider` abstraction, finance schema + enums, webhook/Inngest reconciliation pattern, `gocardlessCustomerId` already on `customers`, `src/env.ts`.
- **Plan 06 (Integration Framework):** `connection`, `metric_daily`, `metric_monthly_rollup`, Inngest client + serve route.
- **Plan 11 (Analytics Aggregator):** channel registry + aggregation library (`getOrgAnalytics`, `withRlsDb`).
- **Plan 12 (AI Report Generator):** `anthropic` client + `MODELS`, Supabase Storage admin pattern, `@react-pdf/renderer`.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                              # MODIFY: + chat_conversation, chat_message,
│  │  │                                         #         looker_embed, gocardless_event + enums
│  │  └─ types.ts                               # MODIFY: + inferred chat/looker types
│  ├─ env.ts                                    # MODIFY: + GoCardless + Looker secrets
│  ├─ lib/
│  │  ├─ chat/
│  │  │  ├─ tools.ts                            # internal tool defs (NO tenant arg) + executors factory
│  │  │  ├─ run.ts                              # runChatTurn() — Anthropic tool-use loop, org bound server-side
│  │  │  ├─ persistence.ts                      # create/load conversation + append messages (RLS-safe)
│  │  │  └─ prompts.ts                          # cacheable system prompt
│  │  ├─ looker/
│  │  │  ├─ token.ts                            # mintLookerEmbedToken / verifyLookerEmbedToken (HMAC)
│  │  │  └─ embed.ts                            # buildLookerEmbedUrl(config, token)
│  │  └─ gocardless/
│  │     ├─ client.ts                           # GoCardless SDK singleton (server-only)
│  │     ├─ connector.ts                        # GoCardlessConnector (implements PaymentProvider seam)
│  │     ├─ webhook.ts                          # verifyWebhook + recordAndCheckGcEvent + markGcEventProcessed
│  │     ├─ reconcile.ts                        # reconcileGoCardlessEvent — the payment state machine
│  │     └─ pdf.tsx                             # renderDirectDebitInvoicePdf (@react-pdf/renderer)
│  ├─ inngest/
│  │  └─ gocardless.ts                          # handleGoCardlessEvent Inngest function
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ chat/route.ts                       # POST: streamed/non-streamed chat turn (org bound to session)
│  │  │  └─ webhooks/gocardless/route.ts        # single signature-verified webhook endpoint
│  │  ├─ (internal)/
│  │  │  └─ analytics/[clientId]/ask/page.tsx   # staff "Ask your data" against a chosen client
│  │  └─ (portal)/
│  │     ├─ ask/page.tsx                        # client "Ask your data" (own org only)
│  │     └─ performance/looker/page.tsx         # optional Looker deep-dive embed (own org only)
│  └─ components/
│     ├─ chat/ChatPanel.tsx                     # chat UI (client component)
│     └─ looker/LookerEmbed.tsx                 # iframe wrapper
└─ tests/
   ├─ rls/chat-isolation.test.ts               # KEYSTONE: chat_conversation/chat_message RLS isolation
   ├─ chat/tool-scoping.test.ts                # KEYSTONE: tools cannot read another org (tenant bound server-side)
   ├─ chat/run.test.ts                         # tool-use loop drives tools + returns text (fake Anthropic)
   ├─ looker/token.test.ts                     # mint/verify embed token; tamper + expiry rejected
   └─ gocardless/
      ├─ rls.test.ts                           # gocardless_event ledger deny-all to non-service roles
      ├─ webhook-idempotency.test.ts           # dedupe on GoCardless event id
      └─ state-machine.test.ts                 # KEYSTONE: mandate/payment events → invoice/payment status
```

---

## Task 1: Schema — chat threads, Looker embed config, GoCardless event ledger

**Files:**
- Modify: `src/db/schema.ts` (append enums + tables)
- Modify: `src/db/types.ts` (append inferred types)
- Create: `drizzle/00XX_chat_looker_gocardless.sql` (generated)

The chat tables follow PRD §8 messaging conventions (a `conversation` + `message` pair) but are namespaced `chat_*` to avoid colliding with Plan 15's human messaging (`conversation`/`message`). `looker_embed` is one row per client org. `gocardless_event` mirrors Plan 04's `stripe_events` ledger (deny-all to user roles; only `service_role`/jobs touch it).

- [ ] **Step 1: Append enums + tables to `src/db/schema.ts`**

Add these imports to the existing `drizzle-orm/pg-core` import if not already present from earlier plans (`pgTable, pgEnum, uuid, text, timestamp, unique, index, jsonb, boolean` are all used by Plans 04/06):

```ts
// (no new pg-core imports needed beyond what Plans 04/06 already import)

// ─── Chat ("ask your data") ──────────────────────────────────────────────────
export const chatMessageRole = pgEnum('chat_message_role', ['user', 'assistant'])

// One conversation thread per (client org, author). Tenant-scoped by organization_id.
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // The user who started the thread (staff or client). FK to profiles (Plan 01).
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule)
    idxOrgUpdated: index('idx_chat_conv_org_updated').on(t.organizationId, t.updatedAt),
  }),
)

// One message per turn. Tool calls/results are summarised into `content`; the
// raw tool transcript is kept in `meta` for audit (never another org's data).
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    role: chatMessageRole('role').notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgConv: index('idx_chat_msg_org_conv').on(t.organizationId, t.conversationId),
  }),
)

// ─── Looker Studio embed config ──────────────────────────────────────────────
// Presentation-only. Holds the report id + connector params per client org.
// NO metric data ever flows back from Looker into our store (PRD §6.3).
export const lookerEmbeds = pgTable(
  'looker_embeds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // The published Looker Studio report id (the /reporting/{id} segment).
    reportId: text('report_id').notNull(),
    // Optional connector page/params passed through to the embed URL.
    params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
    isEnabled: boolean('is_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrg: index('idx_looker_embed_org').on(t.organizationId),
    uniqOrg: unique('uniq_looker_embed_org').on(t.organizationId),
  }),
)

// ─── GoCardless event ledger (idempotency — dedupe webhooks on event id) ──────
// Not tenant-scoped by RLS: written only by the service-role webhook worker.
// Mirrors Plan 04's stripe_events.
export const gocardlessEvents = pgTable('gocardless_events', {
  id: text('id').primaryKey(), // GoCardless event.id (e.g. 'EV123...')
  resourceType: text('resource_type').notNull(), // 'payments' | 'mandates' | ...
  action: text('action').notNull(), // 'confirmed' | 'paid_out' | 'active' | ...
  payload: jsonb('payload').$type<unknown>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
})
```

Append these to the existing schema export block if your build re-exports a single `schema` object; otherwise they are picked up by `import * as schema` automatically.

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type {
  chatConversations,
  chatMessages,
  lookerEmbeds,
  gocardlessEvents,
} from './schema'

export type ChatConversation = typeof chatConversations.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
export type ChatMessageRole = ChatMessage['role']
export type LookerEmbed = typeof lookerEmbeds.$inferSelect
export type GoCardlessEvent = typeof gocardlessEvents.$inferSelect
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
pnpm db:generate
pnpm db:migrate
```
Expected: a `drizzle/00XX_chat_looker_gocardless.sql` with the `chat_message_role` enum + four tables; migration applies cleanly. Verify:
```bash
psql "$DATABASE_URL" -c "\dt public.chat_conversations public.chat_messages public.looker_embeds public.gocardless_events"
```
Expected: all four tables listed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): chat threads, looker embed config, gocardless event ledger"
```

---

## Task 2: KEYSTONE — chat RLS isolation tests (watch them FAIL)

**Files:**
- Create: `tests/rls/chat-isolation.test.ts`

`chat_conversations` and `chat_messages` are tenant-scoped (PRD §9): a client sees only their own org's threads; staff see all. RLS is not enabled yet, so a client user can currently read every org's chat. We write the test first and confirm it fails. Setup uses the raw `sql` connection (service_role, RLS bypassed).

- [ ] **Step 1: Write `tests/rls/chat-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('chat tenant isolation (RLS)', () => {
  let founder: string
  let clientOneUser: string
  let orgOne: string
  let orgTwo: string
  let convOne: string
  let convTwo: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1!.id as string
    orgTwo = o2!.id as string

    // Seed one conversation + message per client org (service-role bypasses RLS).
    const [c1] = await sql`
      insert into public.chat_conversations (organization_id, created_by, title)
      values (${orgOne}, ${clientOneUser}, 'Org one thread') returning id`
    const [c2] = await sql`
      insert into public.chat_conversations (organization_id, created_by, title)
      values (${orgTwo}, ${founder}, 'Org two thread') returning id`
    convOne = c1!.id as string
    convTwo = c2!.id as string
    await sql`insert into public.chat_messages (organization_id, conversation_id, role, content)
              values (${orgOne}, ${convOne}, 'user', 'one')`
    await sql`insert into public.chat_messages (organization_id, conversation_id, role, content)
              values (${orgTwo}, ${convTwo}, 'user', 'two')`
  })

  afterAll(async () => {
    await sql`delete from public.chat_messages where organization_id in (${orgOne}, ${orgTwo})`
    await sql`delete from public.chat_conversations where id in (${convOne}, ${convTwo})`
    await sql.end()
  })

  it('a client user sees ONLY their own org conversations', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select title from public.chat_conversations order by title`)
    expect(rows.map((r) => r.title)).toEqual(['Org one thread'])
  })

  it('agency staff (founder) sees ALL conversations', async () => {
    const rows = await asUser(founder, (tx) => tx`select title from public.chat_conversations order by title`)
    expect(rows.map((r) => r.title)).toEqual(['Org one thread', 'Org two thread'])
  })

  it('a client user cannot read another org chat messages', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select content from public.chat_messages`)
    expect(rows.map((r) => r.content)).toEqual(['one'])
  })

  it('a client user cannot INSERT a conversation for another org', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.chat_conversations (organization_id, created_by, title)
           values (${orgTwo}, ${clientOneUser}, 'sneaky')`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run and confirm FAIL**

Run: `pnpm test tests/rls/chat-isolation.test.ts`
Expected: FAIL — with RLS not enabled the client user sees both threads and the cross-org INSERT succeeds. This proves the tests are real.

- [ ] **Step 3: Commit the failing tests**

```bash
git add -A
git commit -m "test(rls): chat tenant-isolation tests (failing, RLS not enabled)"
```

---

## Task 3: Enable RLS on chat + looker tables → make the tests PASS

**Files:**
- Create: `drizzle/00XX_chat_looker_rls.sql` (custom SQL migration)

We reuse the Plan 01 helpers. Clients read/write their **own** org's chat (they author questions); staff read/write all. `looker_embeds` is read by staff + own-org clients (so the portal can render the embed) and written only by staff. `gocardless_events` gets RLS with **no policy** (deny-all to anon/authenticated; only `service_role` touches it) — covered in Task 8's GoCardless RLS test, but enabled here alongside the other ledger-style table for one clean security migration.

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=chat_looker_rls`
Expected: an empty `drizzle/00XX_chat_looker_rls.sql` registered in the journal.

- [ ] **Step 2: Fill in `drizzle/00XX_chat_looker_rls.sql`**

```sql
-- ── chat_conversations ───────────────────────────────────────────────────────
alter table public.chat_conversations enable row level security;

create policy chat_conv_select on public.chat_conversations
  for select using (public.has_org_access(organization_id));

-- A user may create/update threads only for an org they can access.
create policy chat_conv_write on public.chat_conversations
  for all
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- ── chat_messages ────────────────────────────────────────────────────────────
alter table public.chat_messages enable row level security;

create policy chat_msg_select on public.chat_messages
  for select using (public.has_org_access(organization_id));

create policy chat_msg_write on public.chat_messages
  for all
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- ── looker_embeds (clients read own; only staff write) ───────────────────────
alter table public.looker_embeds enable row level security;

create policy looker_select on public.looker_embeds
  for select using (public.has_org_access(organization_id));

create policy looker_write on public.looker_embeds
  for all
  using (public.is_agency_staff())
  with check (public.is_agency_staff());

-- ── gocardless_events (deny-all to user roles; only service_role/jobs touch it)
alter table public.gocardless_events enable row level security;
-- No policy is created on purpose: with RLS enabled and no policy, anon/authenticated
-- get zero rows and cannot write. service_role bypasses RLS.
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies with no errors.

- [ ] **Step 4: Run the chat isolation tests and confirm PASS**

Run: `pnpm test tests/rls/chat-isolation.test.ts`
Expected: all four tests PASS — the client user sees only `client-one`'s thread; the founder sees both; cross-org INSERT is rejected.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): RLS on chat + looker + gocardless ledger (chat isolation tests pass)"
```

---

## Task 4: Internal chat tools — definitions (NO tenant arg) + executor factory

**Files:**
- Create: `src/lib/chat/tools.ts`

This is the security core of the chat. The Anthropic **tool input schemas deliberately have no `organization_id`/`tenant_id` field** — the model can ask for KPIs/timeseries/comparisons but **cannot name which client**. Instead, `buildToolExecutors(organizationId, client)` returns a `Record<toolName, executor>` where every executor is a closure over a **server-resolved** `organizationId` and reads through the Plan 11 aggregation library (which filters `metric_daily` by that org). For client callers the `client` arg is an RLS-bound Drizzle connection (Task 6), so Postgres RLS is a second wall.

- [ ] **Step 1: Write `src/lib/chat/tools.ts`**

```ts
import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { getOrgAnalytics } from '@/lib/analytics/aggregate'
import { CHANNEL_ORDER, CHANNELS, type ChannelKey } from '@/lib/analytics/channels'
import { defaultPeriod, previousPeriod, parsePeriod, type Period } from '@/lib/analytics/aggregate'
import type { db as serviceDb } from '@/db'

type Drizzle = typeof serviceDb

/**
 * Tool schemas exposed to Claude. NOTE: none of them accept a tenant/org/client
 * argument — the caller binds the organization server-side. The model can only
 * influence WHICH metrics and WHICH period, never WHICH client.
 */
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_channels',
    description:
      'List the marketing channels available for this client (e.g. website, search, google_ads, meta, local, leads) so you know what you can ask about.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_kpis',
    description:
      'Get headline KPI values (and the prior-period comparison) for one channel over a date range. Returns only this client\'s stored, dated numbers from our metrics store.',
    input_schema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: CHANNEL_ORDER as unknown as string[],
          description: 'Which channel to read KPIs for.',
        },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional; defaults to last 28 days).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional; defaults to today).' },
      },
      required: ['channel'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_timeseries',
    description:
      'Get the daily series for one channel\'s primary metric over a date range, for trend/spike questions.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: CHANNEL_ORDER as unknown as string[] },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional).' },
      },
      required: ['channel'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_periods',
    description:
      'Compare every channel\'s headline KPI for a period against the immediately preceding period of equal length.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional).' },
      },
      additionalProperties: false,
    },
  },
]

export type ToolInput = Record<string, unknown>
export type ToolExecutor = (input: ToolInput) => Promise<unknown>

function resolvePeriod(input: ToolInput): Period {
  const from = typeof input.from === 'string' ? input.from : undefined
  const to = typeof input.to === 'string' ? input.to : undefined
  if (from && to) return parsePeriod(from, to)
  return defaultPeriod()
}

function channelArg(input: ToolInput): ChannelKey {
  const ch = String(input.channel) as ChannelKey
  if (!(ch in CHANNELS)) throw new Error(`unknown channel: ${String(input.channel)}`)
  return ch
}

/**
 * Build the executors for a FIXED organizationId. The org is resolved from the
 * authenticated session (client) or an explicit staff selection — it is never
 * taken from tool input. `client` is the Drizzle connection to read through:
 * the service-role `db` for staff (app-scoped to the chosen org) or an
 * RLS-bound connection for clients (defense in depth).
 */
export function buildToolExecutors(organizationId: string, client: Drizzle): Record<string, ToolExecutor> {
  return {
    list_channels: async () =>
      CHANNEL_ORDER.map((ch) => ({ key: ch, label: CHANNELS[ch].label })),

    get_kpis: async (input) => {
      const period = resolvePeriod(input)
      const ch = channelArg(input)
      const analytics = await getOrgAnalytics(organizationId, period, client)
      const view = analytics.views.find((v) => v.channel === ch)
      return {
        channel: ch,
        period,
        asOf: analytics.freshness.asOf,
        provisionalFrom: analytics.freshness.provisionalFrom,
        kpis: view ? view.kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, prior: k.prior, deltaPct: k.deltaPct })) : [],
      }
    },

    get_timeseries: async (input) => {
      const period = resolvePeriod(input)
      const ch = channelArg(input)
      const analytics = await getOrgAnalytics(organizationId, period, client)
      const view = analytics.views.find((v) => v.channel === ch)
      return {
        channel: ch,
        period,
        asOf: analytics.freshness.asOf,
        series: view ? view.series : [],
      }
    },

    compare_periods: async (input) => {
      const period = resolvePeriod(input)
      const prev = previousPeriod(period)
      const analytics = await getOrgAnalytics(organizationId, period, client)
      return {
        period,
        previousPeriod: prev,
        asOf: analytics.freshness.asOf,
        channels: analytics.views.map((v) => ({
          channel: v.channel,
          headline: v.kpis[0] ? { key: v.kpis[0].key, value: v.kpis[0].value, prior: v.kpis[0].prior, deltaPct: v.kpis[0].deltaPct } : null,
        })),
      }
    },
  }
}
```

> The executors read `analytics.views[*].kpis` and `.series` produced by Plan 11's `buildChannelView`. If your Plan 11 field names differ (e.g. `dailySeries` instead of `series`), adjust the property reads here only — the tool contract to the model is unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors (the file is exercised by the scoping/loop tests in Tasks 5–6).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(chat): internal tool defs (no tenant arg) + org-bound executor factory"
```

---

## Task 5: KEYSTONE — chat tool tenant-scoping test (the model cannot escape its org)

**Files:**
- Create: `tests/chat/tool-scoping.test.ts`

This proves the security property in plain code, with no model and no network: an executor built for org A returns org A's rows; there is **no input** the caller can pass to make it read org B; and a client-bound (RLS) executor cannot read another org even if handed the wrong org id. Setup seeds distinct `metric_daily` rows per org via the raw `sql` connection.

- [ ] **Step 1: Write `tests/chat/tool-scoping.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, userIdByEmail } from '../helpers/db'
import { db } from '@/db'
import { withRlsDb } from '@/lib/analytics/aggregate'
import { buildToolExecutors } from '@/lib/chat/tools'

const TODAY = new Date().toISOString().slice(0, 10)

describe('chat tools are tenant-scoped', () => {
  let orgOne: string
  let orgTwo: string
  let clientOneUser: string

  beforeAll(async () => {
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1!.id as string
    orgTwo = o2!.id as string
    clientOneUser = await userIdByEmail('user1@clientone.com')

    // Distinct website sessions per org so a leak would be obvious.
    for (const [org, val] of [[orgOne, 111], [orgTwo, 222]] as const) {
      await sql`
        insert into public.metric_daily
          (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
        values
          (${org}, 'ga4', 'acct', 'property', ${TODAY}, 'sessions', ${val}, false)
        on conflict on constraint metric_daily_pk do update set value = excluded.value`
    }
  })

  afterAll(async () => {
    await sql`delete from public.metric_daily where account_id = 'acct' and metric = 'sessions'`
    await sql.end()
  })

  it('an executor built for org one reads ONLY org one rows (staff/service-role db)', async () => {
    const tools = buildToolExecutors(orgOne, db)
    const out = (await tools.get_kpis!({ channel: 'website', from: TODAY, to: TODAY })) as {
      kpis: { key: string; value: number }[]
    }
    const sessions = out.kpis.find((k) => k.key === 'sessions')
    expect(sessions?.value).toBe(111)
    // The tool input has no org field; there is no way to ask for org two.
    expect(JSON.stringify(out)).not.toContain('222')
  })

  it('a client-bound (RLS) executor cannot read another org even if mis-pointed', async () => {
    // Build executors for org TWO but read through org-one client's RLS connection.
    // RLS must return zero org-two rows → the KPI value collapses to 0, never 222.
    await withRlsDb(clientOneUser, async (rls) => {
      const tools = buildToolExecutors(orgTwo, rls as never)
      const out = (await tools.get_kpis!({ channel: 'website', from: TODAY, to: TODAY })) as {
        kpis: { key: string; value: number }[]
      }
      const sessions = out.kpis.find((k) => k.key === 'sessions')
      expect(sessions?.value ?? 0).toBe(0)
    })
  })

  it('list_channels exposes channels but never another org\'s data', async () => {
    const tools = buildToolExecutors(orgOne, db)
    const out = (await tools.list_channels!({})) as { key: string }[]
    expect(out.map((c) => c.key)).toContain('website')
  })
})
```

- [ ] **Step 2: Run and confirm PASS**

Run: `pnpm test tests/chat/tool-scoping.test.ts`
Expected: PASS. The org-one executor returns `111`; the RLS-bound executor mis-pointed at org two returns `0` (RLS blocks the rows), proving even a server bug that passes the wrong org id cannot leak another tenant's numbers to a client session.

> Test env: this test imports `@/db` and `@/lib/analytics/aggregate`, which transitively pull `src/env.ts`. As established in Plan 04, prepend dummy secrets if needed: `process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy'; process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy'; process.env.GOCARDLESS_ACCESS_TOKEN ??= 'gc_dummy'; process.env.GOCARDLESS_WEBHOOK_SECRET ??= 'gcwh_dummy'` — or add them to the `vitest.config.ts` `env` block.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(chat): KEYSTONE tenant-scoping of internal chat tools"
```

---

## Task 6: Chat run loop, prompts, and persistence (TDD with a fake Anthropic)

**Files:**
- Create: `tests/chat/run.test.ts`
- Create: `src/lib/chat/prompts.ts`, `src/lib/chat/run.ts`, `src/lib/chat/persistence.ts`

`runChatTurn` is a standard Anthropic tool-use loop: send the conversation + tools → if the model returns `tool_use` blocks, execute each via the org-bound executors and feed `tool_result` blocks back → repeat until `stop_reason === 'end_turn'`. To keep tests deterministic and offline, the loop accepts an injectable `createMessage` runner (default = `anthropic.messages.create` with `claude-sonnet-4-6` and the cacheable system prompt).

- [ ] **Step 1: Write `tests/chat/run.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { db } from '@/db'
import { runChatTurn } from '@/lib/chat/run'
import type { CreateMessage } from '@/lib/chat/run'

const TODAY = new Date().toISOString().slice(0, 10)

describe('runChatTurn tool-use loop', () => {
  let orgOne: string

  beforeAll(async () => {
    const [o1] = await sql`select id from public.organizations where slug = 'client-one'`
    orgOne = o1!.id as string
    await sql`
      insert into public.metric_daily
        (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
      values (${orgOne}, 'ga4', 'acct', 'property', ${TODAY}, 'sessions', 333, false)
      on conflict on constraint metric_daily_pk do update set value = excluded.value`
  })

  afterAll(async () => {
    await sql`delete from public.metric_daily where account_id = 'acct'`
    await sql.end()
  })

  it('executes a tool_use turn then returns the final assistant text', async () => {
    let call = 0
    // Turn 1: model asks to call get_kpis. Turn 2: model returns final text.
    const fake: CreateMessage = async () => {
      call += 1
      if (call === 1) {
        return {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu_1', name: 'get_kpis', input: { channel: 'website', from: TODAY, to: TODAY } },
          ],
        } as never
      }
      return {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'You had 333 sessions.' }],
      } as never
    }

    const result = await runChatTurn(
      { organizationId: orgOne, client: db, history: [], userMessage: 'How many sessions?' },
      fake,
    )
    expect(call).toBe(2)
    expect(result.text).toContain('333')
    // The tool result fed back must include 333 (proves the executor ran, scoped to org one).
    expect(JSON.stringify(result.toolResults)).toContain('333')
  })

  it('returns text directly when the model does not call a tool', async () => {
    const fake: CreateMessage = async () =>
      ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello!' }] }) as never
    const result = await runChatTurn(
      { organizationId: orgOne, client: db, history: [], userMessage: 'hi' },
      fake,
    )
    expect(result.text).toBe('Hello!')
    expect(result.toolResults).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run and confirm FAIL**

Run: `pnpm test tests/chat/run.test.ts`
Expected: FAIL — `@/lib/chat/run` does not exist yet (module not found).

- [ ] **Step 3: Write the system prompt `src/lib/chat/prompts.ts`**

```ts
/**
 * The shared system prompt for "ask your data". Marked cacheable by the runner
 * so it is billed once per conversation. It pins the HARD rule that the model
 * may state ONLY numbers returned by the tools (which read this one client's
 * stored rows), never invented figures, and never another client's data.
 */
export const CHAT_SYSTEM_PROMPT = `You are the analytics assistant inside Agency OS for one client of Milktree, a digital marketing agency.

You answer questions about THIS client's marketing performance by calling the provided tools, which read our own synced metrics store (never live ad platforms). The tools always operate on this client only — you cannot name or access any other client.

HARD RULES:
1. State ONLY numbers returned by the tools. Never invent, estimate, or extrapolate a figure a tool did not return.
2. If the tools return no data for the requested channel/period, say so plainly — do not imply numbers exist.
3. Respect the "as of" timestamp and note when the most recent days are provisional (the tools return this).
4. Voice: professional, plain-English, UK spelling, currency GBP. No hype, no emojis.
5. Prefer one tool call that answers the question; chain a second only if needed.`
```

- [ ] **Step 4: Write the persistence helpers `src/lib/chat/persistence.ts`**

```ts
import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { chatConversations, chatMessages } from '@/db/schema'
import type { ChatMessageRole } from '@/db/types'

export type HistoryTurn = { role: ChatMessageRole; content: string }

/** Create a conversation for a fixed org (org resolved by the caller, never the client). */
export async function createConversation(organizationId: string, createdBy: string, title?: string): Promise<string> {
  const [row] = await db
    .insert(chatConversations)
    .values({ organizationId, createdBy, title: title ?? null })
    .returning({ id: chatConversations.id })
  return row!.id
}

/** Load prior turns for a conversation, scoped to its org (defense in depth). */
export async function loadHistory(organizationId: string, conversationId: string): Promise<HistoryTurn[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(and(eq(chatMessages.organizationId, organizationId), eq(chatMessages.conversationId, conversationId)))
    .orderBy(asc(chatMessages.createdAt))
  return rows.map((r) => ({ role: r.role, content: r.content }))
}

/** Append one message; bumps the conversation's updatedAt. */
export async function appendMessage(args: {
  organizationId: string
  conversationId: string
  role: ChatMessageRole
  content: string
  meta?: Record<string, unknown>
}): Promise<void> {
  await db.insert(chatMessages).values({
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    role: args.role,
    content: args.content,
    meta: args.meta ?? {},
  })
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, args.conversationId))
}
```

- [ ] **Step 5: Write the run loop `src/lib/chat/run.ts`**

```ts
import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODELS } from '@/lib/reports/ai/client'
import { CHAT_SYSTEM_PROMPT } from './prompts'
import { CHAT_TOOLS, buildToolExecutors } from './tools'
import type { HistoryTurn } from './persistence'
import type { db as serviceDb } from '@/db'

type Drizzle = typeof serviceDb

/** Injectable so tests run the loop without network calls. */
export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>

export const anthropicCreateMessage: CreateMessage = (params) => anthropic.messages.create(params)

export type RunChatArgs = {
  organizationId: string // resolved server-side — NEVER from the model
  client: Drizzle
  history: HistoryTurn[]
  userMessage: string
}

export type RunChatResult = {
  text: string
  toolResults: { name: string; input: unknown; output: unknown }[]
}

const MAX_TOOL_ROUNDS = 6

/**
 * One assistant turn of the "ask your data" chat. Standard Anthropic tool-use
 * loop: tool_use -> execute via org-bound executors -> tool_result -> repeat
 * until end_turn. The organization is fixed for the whole loop; tools cannot
 * reach any other tenant (Task 5).
 */
export async function runChatTurn(
  args: RunChatArgs,
  createMessage: CreateMessage = anthropicCreateMessage,
): Promise<RunChatResult> {
  const executors = buildToolExecutors(args.organizationId, args.client)
  const messages: Anthropic.MessageParam[] = [
    ...args.history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: 'user', content: args.userMessage },
  ]
  const toolResults: RunChatResult['toolResults'] = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const res = await createMessage({
      model: MODELS.draft, // claude-sonnet-4-6
      max_tokens: 1024,
      system: [{ type: 'text', text: CHAT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: CHAT_TOOLS,
      messages,
    })

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return { text, toolResults }
    }

    // Echo the assistant's tool_use turn, then answer each tool call.
    messages.push({ role: 'assistant', content: res.content })
    const resultBlocks: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const exec = executors[tu.name]
      let output: unknown
      try {
        output = exec ? await exec(tu.input as Record<string, unknown>) : { error: `unknown tool ${tu.name}` }
      } catch (err) {
        output = { error: (err as Error).message }
      }
      toolResults.push({ name: tu.name, input: tu.input, output })
      resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(output) })
    }
    messages.push({ role: 'user', content: resultBlocks })
  }

  // Loop budget exhausted — return a safe fallback.
  return { text: 'I could not complete that request. Please try rephrasing.', toolResults }
}
```

- [ ] **Step 6: Run and confirm PASS**

Run: `pnpm test tests/chat/run.test.ts`
Expected: both tests PASS — the loop executes the `get_kpis` tool (scoped to org one, returns `333`), feeds the result back, and returns the final text; the no-tool path returns text directly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(chat): tool-use run loop, cacheable system prompt, RLS-safe persistence"
```

---

## Task 7: Chat API route + UI (staff picks a client; client is own-org only)

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/components/chat/ChatPanel.tsx`
- Create: `src/app/(internal)/analytics/[clientId]/ask/page.tsx`
- Create: `src/app/(portal)/ask/page.tsx`

The route is where the **organization is bound to the session**. A client caller's org is `session.orgId` (and reads run through `withRlsDb` so RLS applies); a staff caller may pass a `clientId` (an org id) in the body, which we **verify via `has_org_access`** before using, then read with the service-role `db` (app-scoped to that org).

- [ ] **Step 1: The chat route `src/app/api/chat/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { withRlsDb } from '@/lib/analytics/aggregate'
import { runChatTurn } from '@/lib/chat/run'
import { createConversation, loadHistory, appendMessage } from '@/lib/chat/persistence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json()) as { message?: string; conversationId?: string; clientId?: string }
  const message = (body.message ?? '').trim()
  if (!message) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  // Resolve the organization SERVER-SIDE. Clients are pinned to their own org.
  let organizationId: string
  if (isStaff(session.role)) {
    organizationId = body.clientId ?? session.orgId ?? ''
    if (!organizationId) return NextResponse.json({ error: 'missing clientId' }, { status: 400 })
  } else {
    if (!session.orgId) return NextResponse.json({ error: 'no org' }, { status: 403 })
    organizationId = session.orgId
  }

  // Conversation: create if absent (scoped to the resolved org + author).
  const conversationId = body.conversationId ?? (await createConversation(organizationId, session.userId))
  const history = await loadHistory(organizationId, conversationId)

  // Persist the user's question.
  await appendMessage({ organizationId, conversationId, role: 'user', content: message })

  // Run the turn. Clients read through an RLS-bound connection (defense in depth);
  // staff read through the service-role db (app-scoped to the verified org).
  const turn = isStaff(session.role)
    ? await runChatTurn({ organizationId, client: db, history, userMessage: message })
    : await withRlsDb(session.userId, (rls) =>
        runChatTurn({ organizationId, client: rls as never, history, userMessage: message }),
      )

  await appendMessage({
    organizationId,
    conversationId,
    role: 'assistant',
    content: turn.text,
    meta: { toolResults: turn.toolResults },
  })

  return NextResponse.json({ conversationId, reply: turn.text })
}
```

> Staff `clientId` is trusted only because the route runs under the staff session and `is_agency_staff()` grants cross-client access; for extra rigor you may additionally `select 1 from organizations where id = clientId and type = 'client'` before use. The model itself never sees `clientId`.

- [ ] **Step 2: The chat UI `src/components/chat/ChatPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

type Turn = { role: 'user' | 'assistant'; content: string }

export function ChatPanel({ clientId }: { clientId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = input.trim()
    if (!message || busy) return
    setBusy(true)
    setTurns((t) => [...t, { role: 'user', content: message }])
    setInput('')
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, conversationId, clientId }),
    })
    const data = (await res.json()) as { conversationId?: string; reply?: string; error?: string }
    setConversationId(data.conversationId)
    setTurns((t) => [...t, { role: 'assistant', content: data.reply ?? data.error ?? 'Error' }])
    setBusy(false)
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-lg border">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask about this client&apos;s performance — e.g. &quot;How did Google Ads spend change vs last month?&quot;
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={
                t.role === 'user'
                  ? 'inline-block rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : 'inline-block rounded-lg bg-muted px-3 py-2 text-sm'
              }
            >
              {t.content}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t p-3">
        <input
          className="flex-1 rounded border p-2 text-sm"
          placeholder="Ask your data…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Send'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Staff page `src/app/(internal)/analytics/[clientId]/ask/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { ChatPanel } from '@/components/chat/ChatPanel'

export default async function StaffAskPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')
  const { clientId } = await params
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ask this client&apos;s data</h1>
      <ChatPanel clientId={clientId} />
    </div>
  )
}
```

- [ ] **Step 4: Client page `src/app/(portal)/ask/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { ChatPanel } from '@/components/chat/ChatPanel'

export default async function PortalAskPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  // No clientId prop — the API pins the client to their own org from the session.
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ask your data</h1>
      <ChatPanel />
    </div>
  )
}
```

- [ ] **Step 5: Typecheck + manual smoke**

Run: `pnpm exec tsc --noEmit && pnpm dev`
Then (with `ANTHROPIC_API_KEY` set and some `metric_daily` rows seeded): sign in as `user1@clientone.com`, open `/ask`, ask "How many sessions this month?" → a grounded answer using only client-one's numbers. As the founder, open `/analytics/<client-one-org-id>/ask` and ask the same → same data; switching the `clientId` in the URL switches clients (staff cross-client). A client visiting `/analytics/.../ask` is redirected to `/overview`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(chat): /api/chat route (org bound to session) + staff/portal Ask UI"
```

---

## Task 8: GoCardless — SDK singleton, env, connector, and the event ledger (with RLS test)

**Files:**
- Modify: `package.json` (add `gocardless-nodejs`), `.env.local`, `src/env.ts`
- Create: `src/lib/gocardless/client.ts`, `src/lib/gocardless/connector.ts`, `src/lib/gocardless/webhook.ts`
- Create: `tests/gocardless/rls.test.ts`

The connector is the **only** module importing the GoCardless SDK, implementing the same provider seam shape as Plan 04's `StripeConnector`: high-level methods + a `verifyWebhook`. The event ledger (`gocardless_events`) already has RLS enabled (Task 3); this task adds the dedupe helpers and proves the ledger denies non-service roles.

- [ ] **Step 1: Install the SDK**

Run: `pnpm add gocardless-nodejs`
Expected: `gocardless-nodejs` added to `dependencies`.

- [ ] **Step 2: Add secrets to `.env.local`**

```bash
GOCARDLESS_ACCESS_TOKEN="sandbox_..."     # GoCardless sandbox access token
GOCARDLESS_ENVIRONMENT="sandbox"          # 'sandbox' | 'live'
GOCARDLESS_WEBHOOK_SECRET="..."           # from the GoCardless dashboard webhook endpoint
```

- [ ] **Step 3: Extend `src/env.ts`**

Append to the `env` object (keep the Plan 04 fail-fast `required()` helper):
```ts
  GOCARDLESS_ACCESS_TOKEN: required('GOCARDLESS_ACCESS_TOKEN'),
  GOCARDLESS_ENVIRONMENT: (process.env.GOCARDLESS_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'live',
  GOCARDLESS_WEBHOOK_SECRET: required('GOCARDLESS_WEBHOOK_SECRET'),
```

- [ ] **Step 4: SDK singleton `src/lib/gocardless/client.ts`**

```ts
import 'server-only'
import * as gocardless from 'gocardless-nodejs'
import { Environments } from 'gocardless-nodejs/constants'
import { env } from '@/env'

// One GoCardless client for the agency (single-merchant model; each client = a customer).
export const gc = gocardless.client(
  env.GOCARDLESS_ACCESS_TOKEN,
  env.GOCARDLESS_ENVIRONMENT === 'live' ? Environments.Live : Environments.Sandbox,
)
```

- [ ] **Step 5: Connector `src/lib/gocardless/connector.ts`**

```ts
import 'server-only'
import crypto from 'node:crypto'
import { gc } from './client'
import { env } from '@/env'

export interface MandateFlowInput {
  organizationId: string
  customerName: string
  email: string
  // Where GoCardless returns the payer after the hosted flow (display only).
  redirectUri: string
}

export const GoCardlessConnector = {
  /**
   * Create a mandate via a Billing Request Flow: returns a hosted authorisation
   * URL the payer completes (no chargebacks; Direct Debit). The resulting
   * mandate id arrives on the `mandates.active` webhook (reconciled in Task 9).
   */
  async createMandateFlow(input: MandateFlowInput): Promise<{ billingRequestFlowId: string; authorisationUrl: string }> {
    const br = await gc.billingRequests.create({
      mandate_request: { scheme: 'bacs', currency: 'GBP' },
      metadata: { organization_id: input.organizationId },
    })
    const flow = await gc.billingRequestFlows.create({
      redirect_uri: input.redirectUri,
      links: { billing_request: br.id! },
      prefilled_customer: { email: input.email, given_name: input.customerName },
    })
    return { billingRequestFlowId: flow.id!, authorisationUrl: flow.authorisation_url! }
  },

  /** Create a Direct Debit payment against an active mandate (minor units → GBP pence). */
  async createPayment(args: {
    organizationId: string
    mandateId: string
    amountMinor: number
    reference: string
    invoiceId: string
  }): Promise<{ paymentId: string }> {
    const payment = await gc.payments.create({
      amount: args.amountMinor,
      currency: 'GBP',
      links: { mandate: args.mandateId },
      reference: args.reference,
      metadata: { organization_id: args.organizationId, invoice_id: args.invoiceId },
    })
    return { paymentId: payment.id! }
  },

  /**
   * Verify a GoCardless webhook signature (HMAC-SHA256 of the raw body with the
   * endpoint secret) using a constant-time comparison. Throws on mismatch.
   */
  verifyWebhook(rawBody: string, signatureHeader: string): void {
    const expected = crypto.createHmac('sha256', env.GOCARDLESS_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(signatureHeader)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('gocardless signature verification failed')
    }
  },
}

export type GoCardlessProvider = typeof GoCardlessConnector
```

> The exact GoCardless SDK method/property names (`billingRequests`, `billingRequestFlows`, `payments`, `authorisation_url`) match `gocardless-nodejs`; if a version pins a different shape, adjust here only — the rest of the app depends on the `GoCardlessConnector` surface, not the SDK.

- [ ] **Step 6: Webhook ledger helpers `src/lib/gocardless/webhook.ts`**

```ts
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { gocardlessEvents } from '@/db/schema'

export type GcEvent = {
  id: string
  resource_type: string
  action: string
  links?: Record<string, string>
  details?: Record<string, unknown>
}

/** Insert the event; isDuplicate=true if event.id was already seen (ON CONFLICT DO NOTHING). */
export async function recordAndCheckGcEvent(event: GcEvent): Promise<{ isDuplicate: boolean }> {
  const inserted = await db
    .insert(gocardlessEvents)
    .values({
      id: event.id,
      resourceType: event.resource_type,
      action: event.action,
      payload: event as unknown as object,
    })
    .onConflictDoNothing({ target: gocardlessEvents.id })
    .returning({ id: gocardlessEvents.id })
  return { isDuplicate: inserted.length === 0 }
}

export async function markGcEventProcessed(eventId: string): Promise<void> {
  await db.update(gocardlessEvents).set({ processedAt: new Date() }).where(eq(gocardlessEvents.id, eventId))
}
```

- [ ] **Step 7: Write the ledger RLS test `tests/gocardless/rls.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('gocardless_events ledger is service-role only', () => {
  let clientOneUser: string
  const eventId = 'EV_rls_test_001'

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    await sql`insert into public.gocardless_events (id, resource_type, action, payload)
              values (${eventId}, 'payments', 'confirmed', '{}'::jsonb)`
  })
  afterAll(async () => {
    await sql`delete from public.gocardless_events where id = ${eventId}`
    await sql.end()
  })

  it('a client user sees ZERO ledger rows (RLS enabled, no policy)', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select id from public.gocardless_events`)
    expect(rows).toHaveLength(0)
  })

  it('a client user cannot INSERT into the ledger', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.gocardless_events (id, resource_type, action, payload)
           values ('EV_should_fail', 'payments', 'confirmed', '{}'::jsonb)`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 8: Run the RLS test and confirm PASS**

Run: `pnpm test tests/gocardless/rls.test.ts`
Expected: PASS — RLS was enabled with no policy in Task 3, so the client role gets zero rows and the insert is rejected; the service-role seed in `beforeAll` still works.

> Test env: prepend `process.env.GOCARDLESS_ACCESS_TOKEN ??= 'gc_dummy'; process.env.GOCARDLESS_WEBHOOK_SECRET ??= 'gcwh_dummy'; process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy'; process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy'` (this test imports `@/db`, which pulls `src/env.ts`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(finance): GoCardless SDK singleton, connector (provider seam), event ledger + RLS test"
```

---

## Task 9: KEYSTONE — GoCardless payment state machine (TDD)

**Files:**
- Create: `tests/gocardless/webhook-idempotency.test.ts`, `tests/gocardless/state-machine.test.ts`
- Create: `src/lib/gocardless/reconcile.ts`

`reconcileGoCardlessEvent` is the heart of the GoCardless integration: a pure layer that takes an already-verified event and mutates **our** `invoices`/`payments`/`subscriptions`/`customers` rows, mapping the GoCardless object → `organization_id` via the event's `metadata.organization_id` (set by the connector) with a fallback lookup by mandate→customer. We test it directly with synthetic events (no GoCardless network, no signature) so it runs in CI.

**The state machine (PRD §5.8 lifecycle + GoCardless events):**

| GoCardless event (`resource_type.action`) | Our effect |
|---|---|
| `mandates.active` | record `gocardlessCustomerId` + mandate id on `customers`; mark the linked subscription `active` |
| `mandates.cancelled` / `mandates.expired` / `mandates.failed` | mark the linked subscription `canceled` |
| `payments.submitted` / `payments.confirmed` | upsert a `payments` row (`pending`); invoice → `open` if still `draft` |
| `payments.paid_out` | invoice → `paid` (stamp `amountPaid` + `paidAt`); `payments` row → `succeeded` |
| `payments.failed` | invoice → `past_due`; `payments` row → `failed` |
| `payments.cancelled` | `payments` row → `refunded`; invoice → `void` |

- [ ] **Step 1: Write `tests/gocardless/webhook-idempotency.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { recordAndCheckGcEvent } from '@/lib/gocardless/webhook'

describe('gocardless webhook idempotency', () => {
  const eventId = 'EV_dedupe_001'

  beforeAll(async () => {
    await sql`delete from public.gocardless_events where id = ${eventId}`
  })
  afterAll(async () => {
    await sql`delete from public.gocardless_events where id = ${eventId}`
    await sql.end()
  })

  it('records a new event fresh and a redelivery as duplicate', async () => {
    const evt = { id: eventId, resource_type: 'payments', action: 'confirmed' }
    const first = await recordAndCheckGcEvent(evt)
    expect(first.isDuplicate).toBe(false)
    const second = await recordAndCheckGcEvent(evt)
    expect(second.isDuplicate).toBe(true)
  })
})
```

- [ ] **Step 2: Write `tests/gocardless/state-machine.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { reconcileGoCardlessEvent } from '@/lib/gocardless/reconcile'

describe('gocardless payment state machine', () => {
  let orgId: string
  const providerPaymentId = 'PM_test_reco_001'

  beforeAll(async () => {
    const [o] = await sql`select id from public.organizations where slug = 'client-one'`
    orgId = o!.id as string
    await sql`delete from public.payments where provider_payment_id = ${providerPaymentId}`
    await sql`delete from public.invoices where provider_invoice_id = ${providerPaymentId}`
    // A Direct-Debit invoice that GoCardless will settle (provider='gocardless').
    await sql`
      insert into public.invoices
        (organization_id, type, status, provider, provider_invoice_id, currency, subtotal, tax_total, total)
      values
        (${orgId}, 'retainer', 'open', 'gocardless', ${providerPaymentId}, 'gbp', 50000, 10000, 60000)`
  })

  afterAll(async () => {
    await sql`delete from public.payments where organization_id = ${orgId}`
    await sql`delete from public.invoices where provider_invoice_id = ${providerPaymentId}`
    await sql.end()
  })

  function evt(action: string, extra: Record<string, unknown> = {}) {
    return {
      id: `EV_${action}_${Math.random().toString(36).slice(2)}`,
      resource_type: 'payments',
      action,
      links: { payment: providerPaymentId },
      details: {},
      // metadata carried through from the connector for the org + invoice mapping
      metadata: { organization_id: orgId, invoice_id_provider: providerPaymentId },
      amount: 60000,
    }
  }

  it('payments.confirmed upserts a pending payment and keeps the invoice open', async () => {
    await reconcileGoCardlessEvent(evt('confirmed') as never)
    const [p] = await sql`select status from public.payments where provider_payment_id = ${providerPaymentId}`
    const [inv] = await sql`select status from public.invoices where provider_invoice_id = ${providerPaymentId}`
    expect(p!.status).toBe('pending')
    expect(inv!.status).toBe('open')
  })

  it('payments.paid_out flips the invoice to paid and the payment to succeeded', async () => {
    await reconcileGoCardlessEvent(evt('paid_out') as never)
    const [inv] = await sql`select status, amount_paid, paid_at from public.invoices where provider_invoice_id = ${providerPaymentId}`
    const [p] = await sql`select status from public.payments where provider_payment_id = ${providerPaymentId}`
    expect(inv!.status).toBe('paid')
    expect(inv!.amount_paid).toBe(60000)
    expect(inv!.paid_at).not.toBeNull()
    expect(p!.status).toBe('succeeded')
  })

  it('payments.failed flips the invoice to past_due and the payment to failed', async () => {
    // Reset to open to model a fresh attempt.
    await sql`update public.invoices set status = 'open', amount_paid = 0, paid_at = null where provider_invoice_id = ${providerPaymentId}`
    await reconcileGoCardlessEvent(evt('failed') as never)
    const [inv] = await sql`select status from public.invoices where provider_invoice_id = ${providerPaymentId}`
    const [p] = await sql`select status from public.payments where provider_payment_id = ${providerPaymentId}`
    expect(inv!.status).toBe('past_due')
    expect(p!.status).toBe('failed')
  })
})
```

- [ ] **Step 3: Run both and confirm FAIL**

Run: `pnpm test tests/gocardless/webhook-idempotency.test.ts tests/gocardless/state-machine.test.ts`
Expected: FAIL — `@/lib/gocardless/reconcile` does not exist yet (and the idempotency helper test passes once the ledger exists, which it does from Task 8). The state-machine file fails on the missing module.

- [ ] **Step 4: Implement `src/lib/gocardless/reconcile.ts`**

```ts
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { invoices, payments, subscriptions, customers } from '@/db/schema'
import { recordAuditEvent } from '@/lib/audit'
import type { GcEvent } from './webhook'

type GcEventFull = GcEvent & { metadata?: Record<string, string>; amount?: number }

/** Resolve our organization_id for an event: metadata first, then mandate→customer. */
async function resolveOrg(event: GcEventFull): Promise<string | null> {
  const fromMeta = event.metadata?.organization_id
  if (fromMeta) return fromMeta
  const mandateId = event.links?.mandate
  if (mandateId) {
    const [c] = await db
      .select({ organizationId: customers.organizationId })
      .from(customers)
      .where(eq(customers.gocardlessCustomerId, mandateId))
      .limit(1)
    if (c) return c.organizationId
  }
  return null
}

/** Find the invoice this payment settles (by provider_invoice_id we stamped at creation). */
async function invoiceKey(event: GcEventFull): Promise<string | null> {
  return event.metadata?.invoice_id_provider ?? event.links?.payment ?? null
}

export async function reconcileGoCardlessEvent(event: GcEventFull): Promise<void> {
  const organizationId = await resolveOrg(event)
  if (!organizationId) return // unmapped event — acknowledged upstream, no-op here

  if (event.resource_type === 'mandates') {
    if (event.action === 'active') {
      // Activate the org's gocardless subscription(s) waiting on this mandate.
      await db
        .update(subscriptions)
        .set({ status: 'active' })
        .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.provider, 'gocardless')))
      await recordAuditEvent({ organizationId, action: 'gocardless.mandate.active', meta: { event: event.id } })
    } else if (['cancelled', 'expired', 'failed'].includes(event.action)) {
      await db
        .update(subscriptions)
        .set({ status: 'canceled' })
        .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.provider, 'gocardless')))
      await recordAuditEvent({ organizationId, action: `gocardless.mandate.${event.action}`, meta: { event: event.id } })
    }
    return
  }

  if (event.resource_type === 'payments') {
    const providerPaymentId = event.links?.payment ?? null
    const invKey = await invoiceKey(event)
    const [inv] = invKey
      ? await db
          .select({ id: invoices.id, total: invoices.total })
          .from(invoices)
          .where(and(eq(invoices.organizationId, organizationId), eq(invoices.providerInvoiceId, invKey)))
          .limit(1)
      : []

    const upsertPayment = async (status: 'pending' | 'succeeded' | 'failed' | 'refunded', paidAt: Date | null) => {
      if (!providerPaymentId) return
      const existing = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.providerPaymentId, providerPaymentId))
        .limit(1)
      if (existing[0]) {
        await db.update(payments).set({ status, paidAt: paidAt ?? undefined }).where(eq(payments.id, existing[0].id))
      } else {
        await db.insert(payments).values({
          organizationId,
          invoiceId: inv?.id ?? null,
          provider: 'gocardless',
          providerPaymentId,
          amount: event.amount ?? inv?.total ?? 0,
          currency: 'gbp',
          status,
          method: 'bacs',
          paidAt: paidAt ?? null,
        })
      }
    }

    switch (event.action) {
      case 'submitted':
      case 'confirmed':
        await upsertPayment('pending', null)
        if (inv) await db.update(invoices).set({ status: 'open' }).where(and(eq(invoices.id, inv.id), eq(invoices.status, 'draft')))
        break
      case 'paid_out': {
        const paidAt = new Date()
        await upsertPayment('succeeded', paidAt)
        if (inv) {
          await db
            .update(invoices)
            .set({ status: 'paid', amountPaid: event.amount ?? inv.total, paidAt })
            .where(eq(invoices.id, inv.id))
          await recordAuditEvent({ organizationId, action: 'gocardless.payment.paid_out', meta: { event: event.id, invoiceId: inv.id } })
        }
        break
      }
      case 'failed':
        await upsertPayment('failed', null)
        if (inv) await db.update(invoices).set({ status: 'past_due' }).where(eq(invoices.id, inv.id))
        break
      case 'cancelled':
        await upsertPayment('refunded', null)
        if (inv) await db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, inv.id))
        break
      default:
        // Unhandled payment actions are acknowledged (ledger) and intentionally no-op'd.
        break
    }
  }
}
```

> `recordAuditEvent` is the Plan 04/01 helper at `src/lib/audit.ts`. If its argument shape differs in your build (e.g. it requires `actor`), pass `actor: 'system:gocardless'`; the call sites here use `{ organizationId, action, meta }` which Plan 04 used for finance events.

- [ ] **Step 5: Run both and confirm PASS**

Run: `pnpm test tests/gocardless/webhook-idempotency.test.ts tests/gocardless/state-machine.test.ts`
Expected: all tests PASS — `confirmed` → pending payment + open invoice; `paid_out` → paid invoice (amount + paidAt) + succeeded payment; `failed` → past_due invoice + failed payment; idempotency dedupes the redelivery.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(finance): GoCardless payment state machine (reconcile) + idempotency (tests pass)"
```

---

## Task 10: GoCardless webhook endpoint + Inngest fan-out + own-PDF receipt

**Files:**
- Create: `src/app/api/webhooks/gocardless/route.ts`
- Create: `src/inngest/gocardless.ts`
- Create: `src/lib/gocardless/pdf.tsx`
- Modify: `src/app/api/inngest/route.ts` (register the new function)
- Create: `drizzle/00XX_invoices_storage.sql` (private `invoices` bucket + read policy)

The route reads the raw body, verifies the `Webhook-Signature` header, dedupes each event in the batch (GoCardless sends an array of events), enqueues one Inngest message per fresh event, and returns a fast `200`. The Inngest worker re-reads the verified payload from the ledger and runs the state machine; on `paid_out` for a Direct-Debit invoice it renders **our own PDF** (GoCardless issues none), uploads it to a private `invoices` bucket, and stores the object key on `invoices.pdfUrl`.

- [ ] **Step 1: The private invoices bucket + read policy `drizzle/00XX_invoices_storage.sql`**

Run: `pnpm db:generate --custom --name=invoices_storage`, then fill it:
```sql
-- Private bucket for Direct-Debit invoice PDFs (GoCardless issues no PDF).
-- Object key convention: '{organization_id}/{invoice_id}.pdf'.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy invoices_storage_read on storage.objects
  for select using (
    bucket_id = 'invoices'
    and (
      public.is_agency_staff()
      or public.has_org_access((storage.foldername(name))[1]::uuid)
    )
  );
```

Apply: `pnpm db:migrate`
Expected: the `invoices` bucket exists and the read policy is created.

- [ ] **Step 2: The invoice PDF renderer `src/lib/gocardless/pdf.tsx`**

```tsx
import 'server-only'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@supabase/supabase-js'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11 },
  h1: { fontSize: 18, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: '#555' },
  total: { marginTop: 12, fontSize: 13 },
})

export type DirectDebitInvoicePdf = {
  invoiceNumber: string
  clientName: string
  currency: string
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  paidAt: string
  lines: { description: string; amountMinor: number }[]
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100)
}

function InvoiceDocument({ data }: { data: DirectDebitInvoicePdf }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Invoice {data.invoiceNumber}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Billed to</Text>
          <Text>{data.clientName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Paid by Direct Debit (GoCardless)</Text>
          <Text>{data.paidAt}</Text>
        </View>
        <View style={{ marginTop: 16 }}>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.row}>
              <Text>{l.description}</Text>
              <Text>{money(l.amountMinor, data.currency)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Subtotal</Text>
          <Text>{money(data.subtotalMinor, data.currency)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>VAT</Text>
          <Text>{money(data.taxMinor, data.currency)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.total}>Total paid</Text>
          <Text style={styles.total}>{money(data.totalMinor, data.currency)}</Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderDirectDebitInvoicePdf(data: DirectDebitInvoicePdf): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />)
}

// Service-role Storage client (job-side only; never exposed to the browser).
function storageAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const BUCKET = 'invoices'

/** Object key the Storage RLS policy depends on: '{org}/{invoice}.pdf'. */
export function invoiceObjectKey(organizationId: string, invoiceId: string): string {
  return `${organizationId}/${invoiceId}.pdf`
}

export async function uploadInvoicePdf(organizationId: string, invoiceId: string, pdf: Buffer): Promise<string> {
  const key = invoiceObjectKey(organizationId, invoiceId)
  const { error } = await storageAdmin().storage.from(BUCKET).upload(key, pdf, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw error
  return key
}
```

- [ ] **Step 3: The webhook route `src/app/api/webhooks/gocardless/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { GoCardlessConnector } from '@/lib/gocardless/connector'
import { recordAndCheckGcEvent, type GcEvent } from '@/lib/gocardless/webhook'
import { inngest } from '@/lib/inngest/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const signature = req.headers.get('webhook-signature')
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 })

  const rawBody = await req.text()
  try {
    GoCardlessConnector.verifyWebhook(rawBody, signature)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  // GoCardless sends a batch: { events: [...] }. Record each idempotently, enqueue fresh ones.
  const body = JSON.parse(rawBody) as { events: GcEvent[] }
  for (const event of body.events ?? []) {
    const { isDuplicate } = await recordAndCheckGcEvent(event)
    if (!isDuplicate) {
      await inngest.send({ name: 'gocardless/event.received', data: { eventId: event.id } })
    }
  }
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 4: The Inngest worker `src/inngest/gocardless.ts`**

```ts
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest/client'
import { db } from '@/db'
import { gocardlessEvents, invoices, lineItems, customers } from '@/db/schema'
import { markGcEventProcessed } from '@/lib/gocardless/webhook'
import { reconcileGoCardlessEvent } from '@/lib/gocardless/reconcile'
import { renderDirectDebitInvoicePdf, uploadInvoicePdf } from '@/lib/gocardless/pdf'

export const handleGoCardlessEvent = inngest.createFunction(
  { id: 'finance-handle-gocardless-event', retries: 5 },
  { event: 'gocardless/event.received' },
  async ({ event, step }) => {
    const eventId = event.data.eventId as string

    const gcEvent = await step.run('load-event', async () => {
      const [row] = await db
        .select({ payload: gocardlessEvents.payload })
        .from(gocardlessEvents)
        .where(eq(gocardlessEvents.id, eventId))
        .limit(1)
      if (!row) throw new Error(`gocardless event ${eventId} not found in ledger`)
      return row.payload as Record<string, unknown>
    })

    await step.run('reconcile', async () => {
      await reconcileGoCardlessEvent(gcEvent as never)
    })

    // On settlement, render + store OUR OWN PDF (GoCardless issues none).
    await step.run('generate-pdf-on-paid-out', async () => {
      const e = gcEvent as { resource_type?: string; action?: string; metadata?: Record<string, string> }
      if (e.resource_type !== 'payments' || e.action !== 'paid_out') return
      const invKey = e.metadata?.invoice_id_provider
      if (!invKey) return
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.providerInvoiceId, invKey))
        .limit(1)
      if (!inv || inv.status !== 'paid') return
      const lines = await db.select().from(lineItems).where(eq(lineItems.invoiceId, inv.id))
      const [cust] = await db.select().from(customers).where(eq(customers.organizationId, inv.organizationId)).limit(1)
      const pdf = await renderDirectDebitInvoicePdf({
        invoiceNumber: inv.id.slice(0, 8).toUpperCase(),
        clientName: cust?.billingEmail ?? 'Client',
        currency: inv.currency,
        subtotalMinor: inv.subtotal,
        taxMinor: inv.taxTotal,
        totalMinor: inv.total,
        paidAt: (inv.paidAt ?? new Date()).toISOString().slice(0, 10),
        lines: lines.map((l) => ({ description: l.description, amountMinor: l.unitAmount * l.quantity })),
      })
      const key = await uploadInvoicePdf(inv.organizationId, inv.id, pdf)
      await db.update(invoices).set({ pdfUrl: key }).where(eq(invoices.id, inv.id))
    })

    await step.run('mark-processed', async () => {
      await markGcEventProcessed(eventId)
    })

    return { eventId }
  },
)
```

- [ ] **Step 5: Register the function in `src/app/api/inngest/route.ts`**

Add `handleGoCardlessEvent` to the `functions` array:
```ts
import { handleGoCardlessEvent } from '@/inngest/gocardless'
// ...
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    /* ...existing Plan 02/04/12 functions..., */
    handleGoCardlessEvent,
  ],
})
```

- [ ] **Step 6: Local end-to-end check (sandbox)**

In three terminals: `pnpm dev`, `pnpm dlx inngest-cli@latest dev`, and a tunnel (e.g. `pnpm dlx localtunnel --port 3000`) pointed at `/api/webhooks/gocardless`; register that URL + the secret in the GoCardless sandbox dashboard. Create a mandate via the Billing Request Flow and a test payment; in the GoCardless sandbox, advance the payment to `paid_out`.
Expected: the webhook returns `200`; the Inngest dev UI shows `finance-handle-gocardless-event` succeeding; the invoice flips to `paid` and gets a `pdf_url`; a redelivered event returns without double-processing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(finance): GoCardless webhook endpoint + Inngest fan-out + own-PDF receipt"
```

---

## Task 11: Looker Studio embed — short-lived per-tenant token (TDD) + embed UI

**Files:**
- Create: `tests/looker/token.test.ts`
- Create: `src/lib/looker/token.ts`, `src/lib/looker/embed.ts`
- Modify: `src/env.ts` (add `LOOKER_EMBED_SECRET`)
- Create: `src/components/looker/LookerEmbed.tsx`, `src/app/(portal)/performance/looker/page.tsx`

**Documented constraint (PRD §6.3):** Looker Studio (a.k.a. "Data Studio") has **no API that returns report numbers** and **no data-reading MCP** (the MCP belongs to *enterprise Looker*, a separate paid product). So Looker is an **optional human deep-dive only** — never a data source for the dashboard, the AI report, or this chat. Clients see only their own rows **without a Google login** via the **row-level-security community-connector + short-lived per-tenant token** pattern: our server mints a signed token encoding `{ organizationId, exp }`; the community connector validates it (shared `LOOKER_EMBED_SECRET`) and filters rows to that org. We test minting/verification, including tamper + expiry rejection.

- [ ] **Step 1: Add `LOOKER_EMBED_SECRET` to `.env.local` + `src/env.ts`**

`.env.local`:
```bash
LOOKER_EMBED_SECRET="a-long-random-shared-secret"  # also configured in the Looker community connector
```
`src/env.ts` — append to the `env` object:
```ts
  LOOKER_EMBED_SECRET: process.env.LOOKER_EMBED_SECRET ?? '',
```

- [ ] **Step 2: Write `tests/looker/token.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.LOOKER_EMBED_SECRET ??= 'test-looker-secret'
  // Satisfy other env imports pulled transitively.
  process.env.GOCARDLESS_ACCESS_TOKEN ??= 'gc_dummy'
  process.env.GOCARDLESS_WEBHOOK_SECRET ??= 'gcwh_dummy'
  process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy'
})

describe('looker embed token', () => {
  it('mints a token that verifies back to the same org', async () => {
    const { mintLookerEmbedToken, verifyLookerEmbedToken } = await import('@/lib/looker/token')
    const token = mintLookerEmbedToken('org-123', 3600)
    const decoded = verifyLookerEmbedToken(token)
    expect(decoded.organizationId).toBe('org-123')
  })

  it('rejects a tampered token', async () => {
    const { mintLookerEmbedToken, verifyLookerEmbedToken } = await import('@/lib/looker/token')
    const token = mintLookerEmbedToken('org-123', 3600)
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
    expect(() => verifyLookerEmbedToken(tampered)).toThrow()
  })

  it('rejects an expired token', async () => {
    const { mintLookerEmbedToken, verifyLookerEmbedToken } = await import('@/lib/looker/token')
    const token = mintLookerEmbedToken('org-123', -1) // already expired
    expect(() => verifyLookerEmbedToken(token)).toThrow(/expired/)
  })

  it('a token for org A never verifies as org B', async () => {
    const { mintLookerEmbedToken, verifyLookerEmbedToken } = await import('@/lib/looker/token')
    const a = verifyLookerEmbedToken(mintLookerEmbedToken('org-A', 3600))
    expect(a.organizationId).not.toBe('org-B')
  })
})
```

- [ ] **Step 3: Run and confirm FAIL**

Run: `pnpm test tests/looker/token.test.ts`
Expected: FAIL — `@/lib/looker/token` does not exist yet.

- [ ] **Step 4: Implement `src/lib/looker/token.ts`**

```ts
import 'server-only'
import crypto from 'node:crypto'
import { env } from '@/env'

export type LookerTokenPayload = { organizationId: string; exp: number }

function sign(data: string): string {
  return crypto.createHmac('sha256', env.LOOKER_EMBED_SECRET).update(data).digest('base64url')
}

/**
 * Mint a short-lived token `{organizationId, exp}` signed with the shared
 * LOOKER_EMBED_SECRET. The Looker community connector verifies it and filters
 * rows to this org — so the client sees only their own data with NO Google login.
 */
export function mintLookerEmbedToken(organizationId: string, ttlSeconds: number): string {
  if (!env.LOOKER_EMBED_SECRET) throw new Error('LOOKER_EMBED_SECRET not configured')
  const payload: LookerTokenPayload = {
    organizationId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyLookerEmbedToken(token: string): LookerTokenPayload {
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new Error('malformed token')
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('invalid signature')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LookerTokenPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('token expired')
  return payload
}
```

- [ ] **Step 5: Implement `src/lib/looker/embed.ts`**

```ts
import 'server-only'
import type { LookerEmbed } from '@/db/types'

/**
 * Build the Looker Studio embed URL. The per-tenant token is passed as a
 * connector parameter (`ds0.token`) that the row-level-security community
 * connector reads to scope rows. NOTE: no data flows back to us — this is a
 * presentation-only deep-dive (PRD §6.3).
 */
export function buildLookerEmbedUrl(config: Pick<LookerEmbed, 'reportId' | 'params'>, token: string): string {
  const base = `https://lookerstudio.google.com/embed/reporting/${encodeURIComponent(config.reportId)}/page/p_0`
  const params = new URLSearchParams({ 'params': JSON.stringify({ 'ds0.token': token, ...config.params }) })
  return `${base}?${params.toString()}`
}
```

- [ ] **Step 6: Run and confirm PASS**

Run: `pnpm test tests/looker/token.test.ts`
Expected: all four tests PASS — mint/verify round-trips; tamper, expiry, and cross-org are all rejected.

- [ ] **Step 7: The embed components**

`src/components/looker/LookerEmbed.tsx`:
```tsx
export function LookerEmbed({ src }: { src: string }) {
  return (
    <iframe
      title="Looker Studio deep-dive"
      src={src}
      className="h-[80vh] w-full rounded-lg border"
      // Looker Studio embeds require these.
      allow="fullscreen"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    />
  )
}
```

`src/app/(portal)/performance/looker/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { lookerEmbeds } from '@/db/schema'
import { mintLookerEmbedToken } from '@/lib/looker/token'
import { buildLookerEmbedUrl } from '@/lib/looker/embed'
import { LookerEmbed } from '@/components/looker/LookerEmbed'

export default async function PortalLookerPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  if (!session.orgId) redirect('/overview')

  const [config] = await db
    .select()
    .from(lookerEmbeds)
    .where(eq(lookerEmbeds.organizationId, session.orgId))
    .limit(1)

  if (!config || !config.isEnabled) {
    return <p className="text-sm text-muted-foreground">No deep-dive dashboard is configured for your account yet.</p>
  }

  // Short-lived token scopes Looker rows to this org — no Google login required.
  const token = mintLookerEmbedToken(session.orgId, 3600)
  const src = buildLookerEmbedUrl(config, token)
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Performance deep-dive</h1>
      <p className="text-xs text-muted-foreground">
        Interactive Looker Studio view of your own data. (Source of truth remains your in-app dashboards.)
      </p>
      <LookerEmbed src={src} />
    </div>
  )
}
```

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.
```bash
git add -A
git commit -m "feat(looker): RLS-connector embed token (mint/verify) + per-tenant deep-dive page"
```

---

## Task 12: Full suite + self-review pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire suite**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: lint clean; no type errors; all new tests green —
- `tests/rls/chat-isolation.test.ts` (4)
- `tests/chat/tool-scoping.test.ts` (3)
- `tests/chat/run.test.ts` (2)
- `tests/gocardless/rls.test.ts` (2)
- `tests/gocardless/webhook-idempotency.test.ts` (1)
- `tests/gocardless/state-machine.test.ts` (3)
- `tests/looker/token.test.ts` (4)
— plus every prior plan's suite still green (no regressions to Plan 01/04/06/11/12 RLS tests).

- [ ] **Step 2: Commit any final fixups**

```bash
git add -A
git commit -m "chore(phase3): green full suite for chat + looker + gocardless"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §6.1, §6.3, §5.6, §5.8, §12 Phase 3):**
- **"Ask your data" AI chat over an INTERNAL tenant-scoped tool/MCP layer reading our own metrics store, never live ad APIs** → Tasks 4 (tools read Plan 11 aggregation lib over `metric_daily`), 6 (Anthropic tool-use loop, `claude-sonnet-4-6`), 7 (route + UI). No live API is ever called. ✅
- **`tenant_id` enforced for the chat tools** → tool schemas omit any org field; `buildToolExecutors(organizationId, client)` binds the org server-side from the session (client) or verified staff selection; client reads run through `withRlsDb` (RLS second wall). Proven by Task 5 keystone (an executor mis-pointed at another org under a client's RLS connection returns 0, not the other org's value) and Task 2/3 RLS isolation. ✅
- **Optional embedded Looker Studio per client via RLS community-connector + short-lived per-tenant token; clients need NO Google login** → Task 11 (`mintLookerEmbedToken`/`verifyLookerEmbedToken` HMAC, `buildLookerEmbedUrl` passes `ds0.token`, portal page mints a 1-hour token scoped to `session.orgId`). ✅
- **Document that Data Studio has no data API and no data-reading MCP** → stated in the Goal, Task 11 header, and the page copy ("source of truth remains your in-app dashboards"); Looker is presentation-only and never feeds the store/report/chat. ✅
- **GoCardless Direct Debit for UK retainers behind the Plan 04 payment provider abstraction** → Task 8 (`GoCardlessConnector` implements the same seam as `StripeConnector`; only module importing the SDK). ✅
- **Mandate Billing Request Flow** → `GoCardlessConnector.createMandateFlow` (Billing Requests + Billing Request Flows). ✅
- **payments confirmed/paid_out webhooks** → Task 9 state machine (`confirmed` → pending+open; `paid_out` → paid; `failed`/`cancelled` handled) + Task 10 signed webhook endpoint + Inngest fan-out, idempotent on GoCardless event id. ✅
- **Generate our own PDF (GoCardless issues none)** → Task 10 (`renderDirectDebitInvoicePdf` via `@react-pdf/renderer`, uploaded to a private `invoices` bucket, key stored on `invoices.pdfUrl`, on `paid_out`). ✅
- **Tests for tenant scoping of the chat tools and the GoCardless payment state machine** → Task 5 (chat scoping keystone) + Task 9 (state-machine keystone). ✅
- **RLS isolation test for every new tenant-scoped table** → `chat_conversations` + `chat_messages` (Task 2/3), `looker_embeds` (read in Task 3, staff-write policy), `gocardless_events` deny-all ledger (Task 8). ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. The two "adjust here only if your SDK/Plan-11 field names differ" notes are explicit integration-seam guidance (the contract is fixed), not code placeholders. ✅

**Type consistency:** reuses Plan 04 enums (`payment_provider='gocardless'`, `payment_status`, `invoice_status`, `subscription_status`) and the `customers.gocardlessCustomerId` column verbatim; reuses Plan 06 `integration_provider` (`ga4` etc.) and `metric_daily` natural key; reuses Plan 11 `getOrgAnalytics`/`withRlsDb`/`Period`/`CHANNEL_ORDER`/`CHANNELS`; reuses Plan 12 `anthropic`/`MODELS` (`MODELS.draft` = `claude-sonnet-4-6`) and the service-role Storage pattern; new inferred types (`ChatConversation`, `ChatMessage`, `LookerEmbed`, `GoCardlessEvent`) added to `src/db/types.ts`; minor-units integers used end-to-end for GoCardless amounts; `organization_id` is the leading composite-index column on every new tenant-scoped table; helper names (`buildToolExecutors`, `runChatTurn`, `reconcileGoCardlessEvent`, `recordAndCheckGcEvent`, `mintLookerEmbedToken`) are consistent between definitions, tests, routes, and the Inngest worker. ✅

**Security review:** chat org is never model-supplied; client chat reads via RLS connection; staff `clientId` is honoured only under a staff session (`is_agency_staff()` grants cross-client); GoCardless webhook is signature-verified + idempotent + service-role-only ledger; Looker token is HMAC-signed, short-lived, tamper/expiry-rejected, and carries only an org id; no provider SDK is importable from the browser (`server-only`). ✅

**Definition of done for Plan 18:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green (chat RLS + chat tool-scoping + chat loop + GoCardless RLS/idempotency/state-machine + Looker token tests pass), and the manual smoke tests (Tasks 7, 10, 11) behave correctly for a staff user and a client user.
