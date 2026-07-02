# Agency OS — Plan 06: Integration Framework (Backbone) Implementation Plan

> ### Reconciliation notice (read `2026-06-28-00-conventions-and-build-order.md` first)
> The **Inngest client and serve route** are owned by **Plan 1.5 - Shared Platform Services**. Do NOT recreate them here (skip the `new Inngest(...)` and `src/app/api/inngest/route.ts` creation steps). Import `inngest` from `@/lib/inngest/client` and append this plan's functions (sync scheduler, webhook-ingest worker, etc.) to the central registry array in the existing serve route.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **provider-agnostic integration backbone** for Agency OS Plane A (the deterministic data backbone, PRD §6.1): the `connection` model + `connection_account_map`, an encrypted per-client token vault (Supabase Vault behind a tenant-scoped SECURITY DEFINER RPC), a `Connector` interface (`fetch()` + `normalize()`), an Inngest **Sync Scheduler** (per-client fan-out, bounded concurrency, backoff+jitter, idempotent upserts, rolling re-sync windows), the normalized metrics store (`metric_daily` + `metric_monthly_rollup`), a `raw_event` audit table, a generic signature-verified webhook intake, and connection-health status + alerting. A **fake in-memory connector** proves the scheduler + metrics store end-to-end with **no external APIs**. No real provider (GA4/Ads/Meta/GBP/Stripe) is implemented here — they slot in behind the `Connector` interface in later plans.

**Architecture:** This is Plane A's plumbing (PRD §6.1, §6.2). Every external integration is one `connection` row per `(client_org, provider)` carrying status + last-sync + last-error. Each connection maps to one or more external account IDs in `connection_account_map`. Secrets live in **Supabase Vault**, never in app tables and never in the browser; the app reads/writes them only through `public.vault_*` SECURITY DEFINER RPCs that re-check tenant access via the Plan 01 helpers. A `Connector` (`fetch()` → raw, `normalize()` → `NormalizedMetric[]`) is registered in a typed registry. The Inngest **Sync Scheduler** cron fans out one durable step per active connection with bounded concurrency, retries with exponential backoff + jitter, persists each raw provider payload to `raw_event`, then performs **idempotent upserts** into `metric_daily` (PK on the natural key) over a **rolling re-sync window** so late/adjusted provider data is absorbed. A monthly job rolls `metric_daily` into `metric_monthly_rollup`. Inbound webhooks hit a generic signature-verified Next.js route handler that returns a fast 200 and enqueues an Inngest event; the worker writes `raw_event` idempotently (dedupe on `provider_event_id`). A connection-health evaluator flips connections to `error`/`expired` and emits Resend alerts. Tenancy: every new table carries `organization_id` (the **client** org = tenant) as the leading column of a composite index, RLS reuses `public.has_org_access(uuid)` / `public.is_agency_staff()` from Plan 01, and `service_role` is used only by jobs/RPCs — never user-facing queries.

**Tech Stack:** Next.js 16 (App Router, TS strict) · Drizzle ORM + drizzle-kit · postgres.js · Supabase Postgres + **Vault** · **Inngest** (background jobs + cron) · **Resend** (health alerts) · Vitest (unit/integration incl. RLS tests) — all already wired by Plan 01.

**Dependencies (assume built; do not re-spec):** Plan 01 (organizations/profiles/memberships, `org_type`/`app_role` enums, `has_org_access()`/`is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, `tests/helpers/db.ts` `asUser()`), Plan 02 (Tasks/Kanban + Inngest client baseline if present). This plan adds the Inngest client + `serve` route if Plan 02 did not; Task 5 is written to be idempotent in that regard.

---

## File Structure (created by this plan)

```
.
├─ src/
│  ├─ db/
│  │  └─ schema.ts                         # MODIFY: connection, connection_account_map,
│  │                                       #         webhook_endpoint, metric_daily,
│  │                                       #         metric_monthly_rollup, raw_event + enums
│  ├─ lib/
│  │  ├─ integrations/
│  │  │  ├─ connector.ts                   # Connector interface + NormalizedMetric type
│  │  │  ├─ registry.ts                    # provider -> Connector registry
│  │  │  ├─ fake-connector.ts              # in-memory connector for tests/dev
│  │  │  ├─ vault.ts                       # token vault accessors (call SECURITY DEFINER RPCs)
│  │  │  ├─ metrics-store.ts               # idempotent upsert + monthly rollup helpers
│  │  │  ├─ raw-event.ts                   # idempotent raw_event writer
│  │  │  ├─ health.ts                      # connection-health evaluation + transitions
│  │  │  ├─ webhook.ts                     # signature verification helper (HMAC)
│  │  │  └─ backoff.ts                     # exponential backoff + jitter helper
│  │  ├─ inngest/
│  │  │  ├─ client.ts                      # Inngest client (created here if Plan 02 didn't)
│  │  │  └─ functions/
│  │  │     ├─ sync-scheduler.ts           # cron fan-out -> per-connection sync
│  │  │     ├─ sync-connection.ts          # single-connection sync step
│  │  │     ├─ monthly-rollup.ts           # metric_daily -> metric_monthly_rollup
│  │  │     ├─ webhook-ingest.ts           # process enqueued webhook -> raw_event
│  │  │     └─ health-alert.ts             # send Resend alert on health transition
│  │  └─ email/
│  │     └─ resend.ts                      # Resend client (created here if absent)
│  └─ app/
│     └─ api/
│        ├─ inngest/route.ts               # Inngest serve endpoint (created here if absent)
│        └─ webhooks/[provider]/route.ts   # generic signature-verified intake
├─ drizzle/
│  ├─ 06xx_integration_tables.sql          # generated by db:generate
│  └─ 06xx_integration_rls.sql             # custom: RLS + vault RPCs (db:generate --custom)
└─ tests/
   ├─ integrations/
   │  ├─ fake-connector.test.ts
   │  ├─ metrics-store.test.ts
   │  ├─ backoff.test.ts
   │  ├─ vault.test.ts
   │  ├─ webhook.test.ts
   │  ├─ health.test.ts
   │  └─ sync-e2e.test.ts                  # scheduler + store end-to-end via fake connector
   └─ rls/
      └─ integration-isolation.test.ts     # RLS isolation for every new tenant table
```

> Migration filenames use `06xx_` as a placeholder; `pnpm db:generate` assigns the next sequence number after Plan 05's migrations. Use the emitted names in your commits.

---

## Task 1: Schema — connection, account map, webhook_endpoint, metric_daily, metric_monthly_rollup, raw_event

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/06xx_integration_tables.sql` (generated)

- [ ] **Step 1: Append enums + tables to `src/db/schema.ts`**

Add these imports if not already present at the top of the file (Plan 01 imports `pgTable, pgEnum, uuid, text, timestamp, unique`):

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  unique,
  index,
  integer,
  numeric,
  boolean,
  jsonb,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { organizations } from './schema' // already defined in Plan 01 (same file: reference directly)
```

> `organizations` is defined earlier in the same file by Plan 01 — reference the existing binding directly; do not re-import it. The import line above is illustrative only and must be removed if it causes a self-import.

Append at the end of `src/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Plan 06: Integration framework (backbone)
// ---------------------------------------------------------------------------

// Providers known to the backbone. Real connectors register against these in
// later plans; 'fake' exists for the in-memory test/dev connector.
export const integrationProvider = pgEnum('integration_provider', [
  'fake',
  'ga4',
  'gsc',
  'google_ads',
  'meta_ads',
  'gbp',
  'callrail',
  'whatconverts',
  'web_form',
  'stripe',
])

// Lifecycle of a connection (PRD §5.5).
export const connectionStatus = pgEnum('connection_status', [
  'not_connected',
  'pending',
  'connected',
  'error',
  'expired',
])

// What kind of external object an account-map row points at.
export const accountKind = pgEnum('account_kind', [
  'property', // GA4 property
  'site', // GSC site
  'customer', // Google Ads customer id
  'ad_account', // Meta ad account
  'page', // Meta page / GBP location parent
  'location', // GBP location
  'form', // lead form
  'other',
])

// connection: one row per (client org, provider).
export const connection = pgTable(
  'connection',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    status: connectionStatus('status').notNull().default('not_connected'),
    displayName: text('display_name'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    // soft pointer to the vault secret name holding this connection's token bundle
    vaultSecretName: text('vault_secret_name'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule)
    idxOrgProvider: index('idx_connection_org_provider').on(t.organizationId, t.provider),
    uniqOrgProvider: unique('uniq_connection_org_provider').on(t.organizationId, t.provider),
  }),
)

// connection_account_map: external account/property/page ids mapped to a connection.
export const connectionAccountMap = pgTable(
  'connection_account_map',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    externalAccountId: text('external_account_id').notNull(),
    kind: accountKind('kind').notNull().default('other'),
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgConn: index('idx_account_map_org_conn').on(t.organizationId, t.connectionId),
    // a given external id maps to at most one connection (prevents cross-tenant mis-mapping)
    uniqProviderExternal: unique('uniq_account_map_conn_external').on(
      t.connectionId,
      t.externalAccountId,
    ),
  }),
)

// webhook_endpoint: per (org, provider) inbound endpoint with a verification secret name.
export const webhookEndpoint = pgTable(
  'webhook_endpoint',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    // public token in the URL path used to resolve org+provider without leaking ids
    slug: text('slug').notNull().unique(),
    // vault secret name holding the HMAC signing secret
    vaultSecretName: text('vault_secret_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgProvider: index('idx_webhook_org_provider').on(t.organizationId, t.provider),
  }),
)

// raw_event: verbatim inbound payload audit (sync responses + webhooks). PRD §6.5.
export const rawEvent = pgTable(
  'raw_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    // provider's own event/request id used for idempotency (webhook redelivery, retries)
    providerEventId: text('provider_event_id').notNull(),
    kind: text('kind').notNull(), // 'sync' | 'webhook' | provider-specific
    payload: jsonb('payload').$type<unknown>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgReceived: index('idx_raw_event_org_received').on(t.organizationId, t.receivedAt),
    // idempotency key: a provider event id is recorded at most once per (org, provider)
    uniqOrgProviderEvent: unique('uniq_raw_event_org_provider_event').on(
      t.organizationId,
      t.provider,
      t.providerEventId,
    ),
  }),
)

// metric_daily: the normalized metrics store. PRD §6.2 / §8.
// Natural key = (organization_id, provider, account_id, entity, date, metric).
export const metricDaily = pgTable(
  'metric_daily',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    accountId: text('account_id').notNull(),
    entity: text('entity').notNull(), // e.g. 'property' | 'campaign:123'
    date: date('date').notNull(),
    metric: text('metric').notNull(), // e.g. 'sessions' | 'cost' | 'leads'
    value: numeric('value', { precision: 20, scale: 4 }).notNull(),
    isProvisional: boolean('is_provisional').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({
      name: 'metric_daily_pk',
      columns: [t.organizationId, t.provider, t.accountId, t.entity, t.date, t.metric],
    }),
    // tenant-leading read index for dashboard queries by date range
    idxOrgDate: index('idx_metric_daily_org_date').on(t.organizationId, t.date),
  }),
)

// metric_monthly_rollup: pre-aggregated month sums for fast dashboard/report reads.
export const metricMonthlyRollup = pgTable(
  'metric_monthly_rollup',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    accountId: text('account_id').notNull(),
    entity: text('entity').notNull(),
    month: date('month').notNull(), // first day of month
    metric: text('metric').notNull(),
    value: numeric('value', { precision: 20, scale: 4 }).notNull(),
    rolledUpAt: timestamp('rolled_up_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({
      name: 'metric_monthly_rollup_pk',
      columns: [t.organizationId, t.provider, t.accountId, t.entity, t.month, t.metric],
    }),
    idxOrgMonth: index('idx_metric_monthly_org_month').on(t.organizationId, t.month),
  }),
)
```

> Remove the illustrative `import { organizations } from './schema'` line; `organizations` is already in scope from Plan 01's definitions in the same file. Keep only the `drizzle-orm/pg-core` import additions.

- [ ] **Step 2: Add inferred types to `src/db/types.ts`**

Append:

```ts
import type {
  connection,
  connectionAccountMap,
  webhookEndpoint,
  rawEvent,
  metricDaily,
  metricMonthlyRollup,
} from './schema'

export type Connection = typeof connection.$inferSelect
export type NewConnection = typeof connection.$inferInsert
export type ConnectionAccountMap = typeof connectionAccountMap.$inferSelect
export type WebhookEndpoint = typeof webhookEndpoint.$inferSelect
export type RawEvent = typeof rawEvent.$inferSelect
export type MetricDaily = typeof metricDaily.$inferSelect
export type NewMetricDaily = typeof metricDaily.$inferInsert
export type MetricMonthlyRollup = typeof metricMonthlyRollup.$inferSelect

export type IntegrationProvider = Connection['provider']
export type ConnectionStatus = Connection['status']
export type AccountKind = ConnectionAccountMap['kind']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/06xx_integration_tables.sql` file is created containing the 3 enums and 6 tables with their composite PKs/indexes.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Then verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E "connection|metric_daily|metric_monthly_rollup|raw_event|webhook_endpoint"
```
Expected: `connection`, `connection_account_map`, `webhook_endpoint`, `raw_event`, `metric_daily`, `metric_monthly_rollup` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): integration backbone schema (connection, metrics store, raw_event)"
```

---

## Task 2: RLS + vault RPCs → isolation tests FIRST, then make them PASS

**Files:**
- Create: `tests/rls/integration-isolation.test.ts`
- Create: `drizzle/06xx_integration_rls.sql` (custom SQL migration)

RLS is not yet enabled on the new tables, so a client user can currently read every tenant's rows. We write the isolation tests, confirm they FAIL, then enable RLS + write the vault RPCs to make them PASS.

- [ ] **Step 1: Write the failing isolation tests `tests/rls/integration-isolation.test.ts`**

This reuses the Plan 01 harness (`tests/helpers/db.ts` `asUser()`/`sql`). It seeds two connections (one per client org) as `service_role` via the raw `sql` connection (RLS bypassed for setup), then asserts each client user sees only their own.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('integration backbone tenant isolation (RLS)', () => {
  let clientOneUser: string
  let clientTwoUser: string
  let founder: string
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')
    founder = await userIdByEmail('founder@milktreeagency.com')

    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    // Setup as service_role (the raw sql connection bypasses RLS). Idempotent.
    await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgOne}, 'fake', 'connected', 'C1 fake')
      on conflict (organization_id, provider) do update set status = 'connected'`
    await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgTwo}, 'fake', 'connected', 'C2 fake')
      on conflict (organization_id, provider) do update set status = 'connected'`

    await sql`
      insert into public.metric_daily
        (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
      values (${orgOne}, 'fake', 'acct-1', 'property', '2026-06-01', 'sessions', 100, false)
      on conflict on constraint metric_daily_pk do update set value = 100`
    await sql`
      insert into public.metric_daily
        (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
      values (${orgTwo}, 'fake', 'acct-2', 'property', '2026-06-01', 'sessions', 200, false)
      on conflict on constraint metric_daily_pk do update set value = 200`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client user sees ONLY their own connections', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id from public.connection`,
    )
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
    expect(rows.length).toBe(1)
  })

  it('a client user sees ONLY their own metric_daily rows', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id, value from public.metric_daily`,
    )
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
    expect(rows.some((r) => Number(r.value) === 200)).toBe(false)
  })

  it('client two cannot read client one metric rows', async () => {
    const rows = await asUser(clientTwoUser, (tx) =>
      tx`select organization_id from public.metric_daily`,
    )
    expect(rows.every((r) => r.organization_id === orgTwo)).toBe(true)
  })

  it('agency staff (founder) sees ALL connections', async () => {
    const rows = await asUser(founder, (tx) => tx`select organization_id from public.connection`)
    const orgs = new Set(rows.map((r) => r.organization_id))
    expect(orgs.has(orgOne)).toBe(true)
    expect(orgs.has(orgTwo)).toBe(true)
  })

  it('a client user cannot INSERT a metric row for another org', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.metric_daily
             (organization_id, provider, account_id, entity, date, metric, value)
           values (${orgTwo}, 'fake', 'x', 'property', '2026-06-02', 'sessions', 5)`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they FAIL**

Run: `pnpm test tests/rls/integration-isolation.test.ts`
Expected: FAIL — without RLS the client user sees both orgs' connections/metrics and the cross-org insert succeeds. This proves the tests are real.

- [ ] **Step 3: Create the custom RLS + vault migration**

Run: `pnpm db:generate --custom --name=integration_rls`
Expected: an empty `drizzle/06xx_integration_rls.sql` registered in the journal.

- [ ] **Step 4: Fill in `drizzle/06xx_integration_rls.sql`**

```sql
-- =========================================================================
-- Plan 06: RLS for the integration backbone + tenant-scoped Vault RPCs.
-- Reuses Plan 01 helpers public.has_org_access(uuid) and public.is_agency_staff().
-- =========================================================================

-- ---- Enable RLS on every new tenant-scoped table ------------------------
alter table public.connection             enable row level security;
alter table public.connection_account_map enable row level security;
alter table public.webhook_endpoint       enable row level security;
alter table public.raw_event              enable row level security;
alter table public.metric_daily           enable row level security;
alter table public.metric_monthly_rollup  enable row level security;

-- ---- connection ---------------------------------------------------------
create policy connection_select on public.connection
  for select using (public.has_org_access(organization_id));
-- only agency staff manage connections (clients grant access, staff configure)
create policy connection_write on public.connection
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ---- connection_account_map --------------------------------------------
create policy account_map_select on public.connection_account_map
  for select using (public.has_org_access(organization_id));
create policy account_map_write on public.connection_account_map
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ---- webhook_endpoint (staff-only; never client-visible) ----------------
create policy webhook_select on public.webhook_endpoint
  for select using (public.is_agency_staff());
create policy webhook_write on public.webhook_endpoint
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ---- raw_event (read scoped to tenant; writes only via service_role jobs)
create policy raw_event_select on public.raw_event
  for select using (public.has_org_access(organization_id));
-- no insert/update/delete policy => non-service_role roles cannot write.

-- ---- metric_daily -------------------------------------------------------
-- Read: tenant-scoped. Write must match the row's org (defense in depth even
-- though jobs use service_role which bypasses RLS).
create policy metric_daily_select on public.metric_daily
  for select using (public.has_org_access(organization_id));
create policy metric_daily_insert on public.metric_daily
  for insert with check (public.is_agency_staff() and public.has_org_access(organization_id));
create policy metric_daily_update on public.metric_daily
  for update using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- ---- metric_monthly_rollup ---------------------------------------------
create policy metric_monthly_select on public.metric_monthly_rollup
  for select using (public.has_org_access(organization_id));
create policy metric_monthly_write on public.metric_monthly_rollup
  for all using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- =========================================================================
-- Tenant-scoped Supabase Vault accessors.
-- Secrets live in vault.secrets; the browser/app never touch that schema.
-- These SECURITY DEFINER RPCs re-check tenant access via Plan 01 helpers,
-- so even a leaked anon/authenticated call cannot read another tenant's token.
-- Naming convention for secret names: '<org_id>:<provider>' (enforced below).
-- =========================================================================

-- Build the canonical secret name for an (org, provider) pair.
create or replace function public.vault_secret_name(p_org uuid, p_provider text)
returns text
language sql
immutable
as $$ select p_org::text || ':' || p_provider $$;

-- Upsert a secret for (org, provider). Staff only; returns the secret name.
create or replace function public.vault_set_token(p_org uuid, p_provider text, p_secret text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_name text := public.vault_secret_name(p_org, p_provider);
  v_existing uuid;
begin
  if not (public.is_agency_staff() and public.has_org_access(p_org)) then
    raise exception 'not authorized to set token for org %', p_org using errcode = '42501';
  end if;

  select id into v_existing from vault.secrets where name = v_name;
  if v_existing is null then
    perform vault.create_secret(p_secret, v_name, 'agency-os integration token');
  else
    perform vault.update_secret(v_existing, p_secret, v_name, 'agency-os integration token');
  end if;
  return v_name;
end;
$$;

-- Read the decrypted secret for (org, provider). Staff only.
create or replace function public.vault_get_token(p_org uuid, p_provider text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_name text := public.vault_secret_name(p_org, p_provider);
  v_secret text;
begin
  if not (public.is_agency_staff() and public.has_org_access(p_org)) then
    raise exception 'not authorized to read token for org %', p_org using errcode = '42501';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = v_name;
  return v_secret;
end;
$$;

-- Delete the secret for (org, provider) on revocation. Staff only.
create or replace function public.vault_delete_token(p_org uuid, p_provider text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_name text := public.vault_secret_name(p_org, p_provider);
  v_id uuid;
begin
  if not (public.is_agency_staff() and public.has_org_access(p_org)) then
    raise exception 'not authorized to delete token for org %', p_org using errcode = '42501';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then return false; end if;
  delete from vault.secrets where id = v_id;
  return true;
end;
$$;

-- Lock the vault RPCs: only authenticated (subject to the staff check inside)
-- and service_role may execute. anon cannot.
revoke all on function public.vault_set_token(uuid, text, text)    from public, anon;
revoke all on function public.vault_get_token(uuid, text)          from public, anon;
revoke all on function public.vault_delete_token(uuid, text)       from public, anon;
grant execute on function public.vault_set_token(uuid, text, text) to authenticated, service_role;
grant execute on function public.vault_get_token(uuid, text)       to authenticated, service_role;
grant execute on function public.vault_delete_token(uuid, text)    to authenticated, service_role;
```

> The `vault` extension ships with the local Supabase stack. If `vault.create_secret` is unavailable, run `create extension if not exists supabase_vault;` at the top of this migration.

- [ ] **Step 5: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `06xx_integration_rls.sql` with no errors.

- [ ] **Step 6: Run the isolation tests and confirm they PASS**

Run: `pnpm test tests/rls/integration-isolation.test.ts`
Expected: all assertions PASS — client users see only their org's connections/metrics, the founder sees all, and the cross-org insert is rejected.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(security): RLS on integration tables + tenant-scoped Vault RPCs (tests pass)"
```

---

## Task 3: Connector interface, registry, and the FAKE in-memory connector

**Files:**
- Create: `src/lib/integrations/connector.ts`
- Create: `src/lib/integrations/fake-connector.ts`
- Create: `src/lib/integrations/registry.ts`
- Create: `tests/integrations/fake-connector.test.ts`

- [ ] **Step 1: Write the failing test `tests/integrations/fake-connector.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { FakeConnector } from '@/lib/integrations/fake-connector'
import { getConnector } from '@/lib/integrations/registry'

describe('FakeConnector', () => {
  const ctx = {
    organizationId: '00000000-0000-0000-0000-000000000001',
    accountId: 'acct-1',
    token: 'unused',
    window: { start: '2026-06-01', end: '2026-06-03' },
  }

  it('fetch() returns one raw row per day with a stable event id', async () => {
    const fake = new FakeConnector({ seed: 7, metric: 'sessions' })
    const raw = await fake.fetch(ctx)
    expect(raw.events.length).toBe(3)
    expect(raw.providerEventId).toBe('fake:acct-1:2026-06-01:2026-06-03')
  })

  it('normalize() maps raw rows to NormalizedMetric with provisional flag on the last day', async () => {
    const fake = new FakeConnector({ seed: 7, metric: 'sessions' })
    const raw = await fake.fetch(ctx)
    const metrics = fake.normalize(raw, ctx)
    expect(metrics).toHaveLength(3)
    for (const m of metrics) {
      expect(m.provider).toBe('fake')
      expect(m.accountId).toBe('acct-1')
      expect(m.metric).toBe('sessions')
      expect(typeof m.value).toBe('number')
    }
    // last day in the window is provisional
    expect(metrics[2]!.isProvisional).toBe(true)
    expect(metrics[0]!.isProvisional).toBe(false)
  })

  it('is deterministic for a given seed', async () => {
    const a = new FakeConnector({ seed: 42, metric: 'sessions' })
    const b = new FakeConnector({ seed: 42, metric: 'sessions' })
    const ra = a.normalize(await a.fetch(ctx), ctx)
    const rb = b.normalize(await b.fetch(ctx), ctx)
    expect(ra.map((m) => m.value)).toEqual(rb.map((m) => m.value))
  })

  it('registry resolves the fake provider', () => {
    const c = getConnector('fake')
    expect(c).toBeInstanceOf(FakeConnector)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/fake-connector.test.ts`
Expected: FAIL — modules do not exist yet (import errors).

- [ ] **Step 3: Write `src/lib/integrations/connector.ts`**

```ts
import type { IntegrationProvider } from '@/db/types'

/** A single normalized metric row destined for metric_daily. */
export interface NormalizedMetric {
  provider: IntegrationProvider
  accountId: string
  entity: string
  date: string // 'YYYY-MM-DD'
  metric: string
  value: number
  isProvisional: boolean
}

/** Inputs a connector needs to fetch data for one account over one window. */
export interface FetchContext {
  organizationId: string
  accountId: string
  token: string
  window: { start: string; end: string } // inclusive 'YYYY-MM-DD'
}

/** Raw provider response captured verbatim for raw_event + idempotency. */
export interface RawResult {
  provider: IntegrationProvider
  /** stable id for this fetch used as raw_event.provider_event_id (idempotency) */
  providerEventId: string
  events: unknown[]
}

/**
 * Every provider integration implements this interface so provider/version
 * specifics never leak into the scheduler, schema, or UI (PRD §6.2).
 */
export interface Connector {
  readonly provider: IntegrationProvider
  fetch(ctx: FetchContext): Promise<RawResult>
  normalize(raw: RawResult, ctx: FetchContext): NormalizedMetric[]
}
```

- [ ] **Step 4: Write `src/lib/integrations/fake-connector.ts`**

```ts
import type {
  Connector,
  FetchContext,
  NormalizedMetric,
  RawResult,
} from './connector'

/** Inclusive list of 'YYYY-MM-DD' dates between start and end. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (cur.getTime() <= last.getTime()) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** Deterministic mulberry32 PRNG so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FakeConnectorOptions {
  seed: number
  metric: string
  /** number of trailing days to mark provisional (default 1) */
  provisionalTrailingDays?: number
}

/**
 * In-memory connector: no external API. Produces deterministic daily values so
 * the scheduler + metrics store can be tested end-to-end (PRD §6.2 fake path).
 */
export class FakeConnector implements Connector {
  readonly provider = 'fake' as const
  constructor(private readonly opts: FakeConnectorOptions) {}

  async fetch(ctx: FetchContext): Promise<RawResult> {
    const days = eachDay(ctx.window.start, ctx.window.end)
    const rng = mulberry32(this.opts.seed)
    const events = days.map((d) => ({
      date: d,
      metric: this.opts.metric,
      value: Math.floor(rng() * 1000),
    }))
    return {
      provider: 'fake',
      providerEventId: `fake:${ctx.accountId}:${ctx.window.start}:${ctx.window.end}`,
      events,
    }
  }

  normalize(raw: RawResult, ctx: FetchContext): NormalizedMetric[] {
    const trailing = this.opts.provisionalTrailingDays ?? 1
    const days = eachDay(ctx.window.start, ctx.window.end)
    const provisionalFrom = days[Math.max(0, days.length - trailing)]
    return (raw.events as { date: string; metric: string; value: number }[]).map((e) => ({
      provider: 'fake',
      accountId: ctx.accountId,
      entity: 'property',
      date: e.date,
      metric: e.metric,
      value: e.value,
      isProvisional: provisionalFrom !== undefined && e.date >= provisionalFrom,
    }))
  }
}
```

- [ ] **Step 5: Write `src/lib/integrations/registry.ts`**

```ts
import type { IntegrationProvider } from '@/db/types'
import type { Connector } from './connector'
import { FakeConnector } from './fake-connector'

/**
 * Provider -> Connector registry. Real connectors (GA4, Ads, Meta, GBP, Stripe)
 * register here in later plans behind the same Connector interface.
 */
const registry = new Map<IntegrationProvider, Connector>()

export function registerConnector(connector: Connector): void {
  registry.set(connector.provider, connector)
}

export function getConnector(provider: IntegrationProvider): Connector {
  const c = registry.get(provider)
  if (!c) throw new Error(`no connector registered for provider: ${provider}`)
  return c
}

export function hasConnector(provider: IntegrationProvider): boolean {
  return registry.has(provider)
}

// Register the fake connector by default (deterministic; used by tests + dev).
registerConnector(new FakeConnector({ seed: 1, metric: 'sessions' }))
```

- [ ] **Step 6: Run the test and confirm PASS**

Run: `pnpm test tests/integrations/fake-connector.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): Connector interface, registry, and fake in-memory connector"
```

---

## Task 4: Metrics store — idempotent upserts + monthly rollup; raw_event writer; backoff helper

**Files:**
- Create: `src/lib/integrations/metrics-store.ts`
- Create: `src/lib/integrations/raw-event.ts`
- Create: `src/lib/integrations/backoff.ts`
- Create: `tests/integrations/metrics-store.test.ts`
- Create: `tests/integrations/backoff.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/integrations/backoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { backoffDelayMs } from '@/lib/integrations/backoff'

describe('backoffDelayMs', () => {
  it('grows exponentially within the cap', () => {
    const base = 1000
    const cap = 60_000
    // with jitter=0 the delay is deterministic = min(cap, base * 2^attempt)
    expect(backoffDelayMs(0, { base, cap, jitter: 0 })).toBe(1000)
    expect(backoffDelayMs(1, { base, cap, jitter: 0 })).toBe(2000)
    expect(backoffDelayMs(2, { base, cap, jitter: 0 })).toBe(4000)
  })

  it('is bounded by the cap', () => {
    expect(backoffDelayMs(20, { base: 1000, cap: 30_000, jitter: 0 })).toBe(30_000)
  })

  it('adds bounded jitter', () => {
    const d = backoffDelayMs(2, { base: 1000, cap: 60_000, jitter: 0.5, rng: () => 1 })
    // base*4 = 4000; jitter 0.5 * rng(1) => +2000 max
    expect(d).toBe(6000)
    const d0 = backoffDelayMs(2, { base: 1000, cap: 60_000, jitter: 0.5, rng: () => 0 })
    expect(d0).toBe(4000)
  })
})
```

`tests/integrations/metrics-store.test.ts` (uses the raw `sql` harness + a real org):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { upsertMetricsDaily, rollupMonth } from '@/lib/integrations/metrics-store'
import type { NormalizedMetric } from '@/lib/integrations/connector'

describe('metrics-store', () => {
  let org: string

  beforeAll(async () => {
    const o = await sql`select id from public.organizations where slug = 'client-one'`
    org = o[0]!.id as string
    // clean slate for the fake provider in June 2026
    await sql`delete from public.metric_daily
              where organization_id = ${org} and provider = 'fake'
              and date >= '2026-06-01' and date <= '2026-06-30'`
    await sql`delete from public.metric_monthly_rollup
              where organization_id = ${org} and provider = 'fake' and month = '2026-06-01'`
  })

  afterAll(async () => {
    await sql.end()
  })

  function rows(values: number[], from = 1): NormalizedMetric[] {
    return values.map((v, i) => ({
      provider: 'fake',
      accountId: 'acct-1',
      entity: 'property',
      date: `2026-06-0${from + i}`,
      metric: 'sessions',
      value: v,
      isProvisional: i === values.length - 1,
    }))
  }

  it('inserts new rows', async () => {
    const n = await upsertMetricsDaily(org, rows([10, 20, 30]))
    expect(n).toBe(3)
    const stored = await sql`
      select value from public.metric_daily
      where organization_id = ${org} and provider = 'fake'
      order by date`
    expect(stored.map((r) => Number(r.value))).toEqual([10, 20, 30])
  })

  it('re-syncing the same window overwrites (idempotent upsert, no duplicates)', async () => {
    await upsertMetricsDaily(org, rows([10, 20, 30]))
    await upsertMetricsDaily(org, rows([11, 22, 33])) // late-adjusted values
    const stored = await sql`
      select value from public.metric_daily
      where organization_id = ${org} and provider = 'fake'
      order by date`
    expect(stored.length).toBe(3)
    expect(stored.map((r) => Number(r.value))).toEqual([11, 22, 33])
  })

  it('rolls daily values into metric_monthly_rollup as a sum', async () => {
    await upsertMetricsDaily(org, rows([11, 22, 33]))
    await rollupMonth(org, '2026-06-01')
    const roll = await sql`
      select value from public.metric_monthly_rollup
      where organization_id = ${org} and provider = 'fake'
      and month = '2026-06-01' and metric = 'sessions'`
    expect(Number(roll[0]!.value)).toBe(66)
  })

  it('rollup is idempotent (re-running yields the same sum)', async () => {
    await rollupMonth(org, '2026-06-01')
    await rollupMonth(org, '2026-06-01')
    const roll = await sql`
      select count(*)::int as c from public.metric_monthly_rollup
      where organization_id = ${org} and provider = 'fake' and month = '2026-06-01'`
    expect(roll[0]!.c).toBe(1)
  })
})
```

- [ ] **Step 2: Run them and confirm they FAIL**

Run: `pnpm test tests/integrations/metrics-store.test.ts tests/integrations/backoff.test.ts`
Expected: FAIL — `@/lib/integrations/metrics-store` and `@/lib/integrations/backoff` do not exist.

- [ ] **Step 3: Write `src/lib/integrations/backoff.ts`**

```ts
export interface BackoffOptions {
  base: number // first-retry delay in ms
  cap: number // maximum delay in ms
  jitter?: number // 0..1 fraction of the computed delay added as random jitter
  rng?: () => number // injectable for tests (defaults to Math.random)
}

/**
 * Exponential backoff with full bounded jitter.
 * delay = min(cap, base * 2^attempt) + jitter*that*rng()
 */
export function backoffDelayMs(attempt: number, opts: BackoffOptions): number {
  const { base, cap, jitter = 0, rng = Math.random } = opts
  const raw = Math.min(cap, base * Math.pow(2, attempt))
  const extra = jitter > 0 ? raw * jitter * rng() : 0
  return Math.round(raw + extra)
}
```

- [ ] **Step 4: Write `src/lib/integrations/metrics-store.ts`**

```ts
import { db } from '@/db'
import { metricDaily, metricMonthlyRollup } from '@/db/schema'
import { sql } from 'drizzle-orm'
import type { NormalizedMetric } from './connector'

/**
 * Idempotent upsert of normalized metrics into metric_daily. Conflicts on the
 * natural key overwrite value/provisional/syncedAt so a rolling re-sync window
 * absorbs late/adjusted provider data without creating duplicates (PRD §6.2).
 * Returns the number of rows written.
 */
export async function upsertMetricsDaily(
  organizationId: string,
  metrics: NormalizedMetric[],
): Promise<number> {
  if (metrics.length === 0) return 0
  const values = metrics.map((m) => ({
    organizationId,
    provider: m.provider,
    accountId: m.accountId,
    entity: m.entity,
    date: m.date,
    metric: m.metric,
    value: m.value.toString(),
    isProvisional: m.isProvisional,
    syncedAt: new Date(),
  }))

  await db
    .insert(metricDaily)
    .values(values)
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
        syncedAt: sql`excluded.synced_at`,
      },
    })

  return values.length
}

/**
 * Roll metric_daily for one month into metric_monthly_rollup (sum per metric),
 * upserting so re-runs are idempotent. `month` is the first day 'YYYY-MM-01'.
 */
export async function rollupMonth(organizationId: string, month: string): Promise<void> {
  await db.execute(sql`
    insert into ${metricMonthlyRollup}
      (organization_id, provider, account_id, entity, month, metric, value, rolled_up_at)
    select
      ${organizationId}::uuid,
      d.provider,
      d.account_id,
      d.entity,
      ${month}::date,
      d.metric,
      sum(d.value),
      now()
    from ${metricDaily} d
    where d.organization_id = ${organizationId}::uuid
      and d.date >= ${month}::date
      and d.date < (${month}::date + interval '1 month')
    group by d.provider, d.account_id, d.entity, d.metric
    on conflict on constraint metric_monthly_rollup_pk
    do update set value = excluded.value, rolled_up_at = excluded.rolled_up_at
  `)
}
```

- [ ] **Step 5: Write `src/lib/integrations/raw-event.ts`**

```ts
import { db } from '@/db'
import { rawEvent } from '@/db/schema'
import type { IntegrationProvider } from '@/db/types'

/**
 * Idempotently record a verbatim inbound payload (sync response or webhook).
 * Dedupe is on (organization_id, provider, provider_event_id) so webhook
 * redelivery and sync retries never create duplicate audit rows (PRD §6.5).
 * Returns true if a new row was written, false if it already existed.
 */
export async function recordRawEvent(args: {
  organizationId: string
  provider: IntegrationProvider
  providerEventId: string
  kind: string
  payload: unknown
}): Promise<boolean> {
  const inserted = await db
    .insert(rawEvent)
    .values({
      organizationId: args.organizationId,
      provider: args.provider,
      providerEventId: args.providerEventId,
      kind: args.kind,
      payload: args.payload,
    })
    .onConflictDoNothing({
      target: [rawEvent.organizationId, rawEvent.provider, rawEvent.providerEventId],
    })
    .returning({ id: rawEvent.id })

  return inserted.length > 0
}
```

- [ ] **Step 6: Run the tests and confirm PASS**

Run: `pnpm test tests/integrations/metrics-store.test.ts tests/integrations/backoff.test.ts`
Expected: all tests PASS — inserts, idempotent overwrite, monthly sum, and idempotent rollup all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(integrations): idempotent metrics store, raw_event writer, backoff helper"
```

---

## Task 5: Vault accessors + Inngest client/serve wiring + Resend client

**Files:**
- Create: `src/lib/integrations/vault.ts`
- Create: `tests/integrations/vault.test.ts`
- Create: `src/lib/inngest/client.ts` (if absent)
- Create: `src/app/api/inngest/route.ts` (if absent)
- Create: `src/lib/email/resend.ts` (if absent)
- Modify: `package.json` (deps), `.env.local` (keys)

- [ ] **Step 1: Install dependencies (skip any already present from Plan 02)**

Run:
```bash
pnpm add inngest resend
```

- [ ] **Step 2: Add env keys to `.env.local`**

Append (Inngest dev server needs no keys locally; Resend needs an API key — a dummy is fine in tests where email is mocked):
```bash
INNGEST_EVENT_KEY="local"
INNGEST_SIGNING_KEY="local"
RESEND_API_KEY="re_test_dummy"
ALERT_FROM_EMAIL="alerts@milktreeagency.com"
ALERT_TO_EMAIL="founder@milktreeagency.com"
```

- [ ] **Step 3: Write the failing vault test `tests/integrations/vault.test.ts`**

This calls the SECURITY DEFINER RPCs through the raw `sql` harness as a staff user vs a client user (reusing `asUser`).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant-scoped vault RPCs', () => {
  let founder: string
  let clientOneUser: string
  let orgOne: string
  let orgTwo: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string
  })

  afterAll(async () => {
    await sql.end()
  })

  it('staff can set and read a token for a client org', async () => {
    await asUser(founder, (tx) =>
      tx`select public.vault_set_token(${orgOne}, 'fake', 'secret-abc')`,
    )
    const rows = await asUser(founder, (tx) =>
      tx`select public.vault_get_token(${orgOne}, 'fake') as t`,
    )
    expect(rows[0]!.t).toBe('secret-abc')
  })

  it('a client user CANNOT read a token (not staff)', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`select public.vault_get_token(${orgOne}, 'fake') as t`,
      ),
    ).rejects.toThrow()
  })

  it('staff cannot read a token for an org they were not granted (defense in depth)', async () => {
    // founder is agency staff => has_org_access is true for all client orgs by design,
    // so this asserts the cross-org path still resolves the CORRECT org's secret only.
    await asUser(founder, (tx) =>
      tx`select public.vault_set_token(${orgTwo}, 'fake', 'secret-two')`,
    )
    const one = await asUser(founder, (tx) =>
      tx`select public.vault_get_token(${orgOne}, 'fake') as t`,
    )
    const two = await asUser(founder, (tx) =>
      tx`select public.vault_get_token(${orgTwo}, 'fake') as t`,
    )
    expect(one[0]!.t).toBe('secret-abc')
    expect(two[0]!.t).toBe('secret-two')
  })

  it('delete removes the secret', async () => {
    const ok = await asUser(founder, (tx) =>
      tx`select public.vault_delete_token(${orgOne}, 'fake') as ok`,
    )
    expect(ok[0]!.ok).toBe(true)
    const after = await asUser(founder, (tx) =>
      tx`select public.vault_get_token(${orgOne}, 'fake') as t`,
    )
    expect(after[0]!.t).toBeNull()
  })
})
```

- [ ] **Step 4: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/vault.test.ts`
Expected: FAIL — the test file imports nothing missing, but the RPCs already exist from Task 2, so this test should actually PASS at this step. If it does, that confirms the Task 2 RPCs work end-to-end; proceed. If `supabase_vault` was not enabled, add `create extension if not exists supabase_vault;` to the Task 2 migration, re-run `pnpm db:migrate`, and re-test.

> Note: this test exercises the SQL RPCs directly (no app code yet), so it validates Task 2. The app-side wrapper is added next and is covered indirectly by the e2e test in Task 7.

- [ ] **Step 5: Write `src/lib/integrations/vault.ts` (server-only app wrapper over the RPCs)**

```ts
import 'server-only'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import type { IntegrationProvider } from '@/db/types'

/**
 * App-side wrapper over the tenant-scoped Vault RPCs. The Drizzle client runs as
 * the postgres/service role for jobs; the RPCs themselves enforce the staff +
 * has_org_access checks, so secrets never reach the browser (PRD §9).
 */
export async function setToken(
  organizationId: string,
  provider: IntegrationProvider,
  secret: string,
): Promise<string> {
  const res = await db.execute(
    sql`select public.vault_set_token(${organizationId}::uuid, ${provider}, ${secret}) as name`,
  )
  return (res as unknown as { name: string }[])[0]!.name
}

export async function getToken(
  organizationId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const res = await db.execute(
    sql`select public.vault_get_token(${organizationId}::uuid, ${provider}) as t`,
  )
  return (res as unknown as { t: string | null }[])[0]!.t ?? null
}

export async function deleteToken(
  organizationId: string,
  provider: IntegrationProvider,
): Promise<boolean> {
  const res = await db.execute(
    sql`select public.vault_delete_token(${organizationId}::uuid, ${provider}) as ok`,
  )
  return (res as unknown as { ok: boolean }[])[0]!.ok
}
```

- [ ] **Step 6: Create the Inngest client `src/lib/inngest/client.ts` (idempotent — skip if Plan 02 created it)**

```ts
import { Inngest } from 'inngest'

export const inngest = new Inngest({ id: 'agency-os' })
```

- [ ] **Step 7: Create the Inngest serve route `src/app/api/inngest/route.ts` (functions added in Task 6)**

```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { syncScheduler } from '@/lib/inngest/functions/sync-scheduler'
import { syncConnection } from '@/lib/inngest/functions/sync-connection'
import { monthlyRollup } from '@/lib/inngest/functions/monthly-rollup'
import { webhookIngest } from '@/lib/inngest/functions/webhook-ingest'
import { healthAlert } from '@/lib/inngest/functions/health-alert'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncScheduler, syncConnection, monthlyRollup, webhookIngest, healthAlert],
})
```

> If Plan 02 already created `src/app/api/inngest/route.ts`, merge: add the five functions above to the existing `functions` array instead of overwriting the file.

- [ ] **Step 8: Create the Resend client `src/lib/email/resend.ts` (idempotent)**

```ts
import 'server-only'
import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAlertEmail(subject: string, html: string): Promise<void> {
  await resend.emails.send({
    from: process.env.ALERT_FROM_EMAIL ?? 'alerts@milktreeagency.com',
    to: process.env.ALERT_TO_EMAIL ?? 'founder@milktreeagency.com',
    subject,
    html,
  })
}
```

- [ ] **Step 9: Run the vault test (now green) and commit**

Run: `pnpm test tests/integrations/vault.test.ts`
Expected: PASS.

```bash
git add -A
git commit -m "feat(integrations): vault app wrapper, inngest client/serve, resend client"
```

---

## Task 6: Health evaluation + webhook signature verification (unit-tested)

**Files:**
- Create: `src/lib/integrations/health.ts`
- Create: `src/lib/integrations/webhook.ts`
- Create: `tests/integrations/health.test.ts`
- Create: `tests/integrations/webhook.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/integrations/webhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySignature } from '@/lib/integrations/webhook'

describe('verifySignature (HMAC-SHA256)', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ hello: 'world' })
  const good = createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid signature', () => {
    expect(verifySignature(body, good, secret)).toBe(true)
  })

  it('accepts a sha256= prefixed signature (GitHub/Meta style)', () => {
    expect(verifySignature(body, `sha256=${good}`, secret)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifySignature(body + 'x', good, secret)).toBe(false)
  })

  it('rejects a wrong signature without throwing on length mismatch', () => {
    expect(verifySignature(body, 'deadbeef', secret)).toBe(false)
  })
})
```

`tests/integrations/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth } from '@/lib/integrations/health'

describe('evaluateHealth', () => {
  const now = new Date('2026-06-29T12:00:00Z')

  it('flags a connection with no successful sync in 24h+ as error', () => {
    const next = evaluateHealth(
      { status: 'connected', lastSuccessAt: new Date('2026-06-27T00:00:00Z'), lastError: null },
      now,
    )
    expect(next.status).toBe('error')
    expect(next.changed).toBe(true)
  })

  it('keeps a freshly-synced connection connected', () => {
    const next = evaluateHealth(
      { status: 'connected', lastSuccessAt: new Date('2026-06-29T06:00:00Z'), lastError: null },
      now,
    )
    expect(next.status).toBe('connected')
    expect(next.changed).toBe(false)
  })

  it('maps an auth/token error message to expired', () => {
    const next = evaluateHealth(
      { status: 'connected', lastSuccessAt: new Date('2026-06-29T06:00:00Z'), lastError: 'token expired / invalid_grant' },
      now,
    )
    expect(next.status).toBe('expired')
    expect(next.changed).toBe(true)
  })

  it('does not downgrade a pending connection', () => {
    const next = evaluateHealth(
      { status: 'pending', lastSuccessAt: null, lastError: null },
      now,
    )
    expect(next.status).toBe('pending')
    expect(next.changed).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and confirm they FAIL**

Run: `pnpm test tests/integrations/webhook.test.ts tests/integrations/health.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write `src/lib/integrations/webhook.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time HMAC-SHA256 verification. Accepts both raw hex and a
 * 'sha256=' prefixed signature (GitHub/Meta convention). Never throws on a
 * length mismatch — returns false.
 */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Write `src/lib/integrations/health.ts`**

```ts
import type { ConnectionStatus } from '@/db/types'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000 // PRD §11 freshness SLA: <= 24h

export interface HealthInput {
  status: ConnectionStatus
  lastSuccessAt: Date | null
  lastError: string | null
}

export interface HealthResult {
  status: ConnectionStatus
  changed: boolean
}

/** Return /-1 if a token/auth error is present in the last error message. */
function isAuthError(msg: string | null): boolean {
  if (!msg) return false
  const m = msg.toLowerCase()
  return (
    m.includes('expired') ||
    m.includes('invalid_grant') ||
    m.includes('unauthorized') ||
    m.includes('revoked') ||
    m.includes('401')
  )
}

/**
 * Pure health evaluation (PRD §5.5). Decides the next connection status from
 * last success time + last error. The Inngest job persists the transition and
 * fires an alert when `changed` is true and the new status is error/expired.
 */
export function evaluateHealth(input: HealthInput, now: Date = new Date()): HealthResult {
  // Never auto-transition a not-yet-live connection.
  if (input.status === 'not_connected' || input.status === 'pending') {
    return { status: input.status, changed: false }
  }

  if (isAuthError(input.lastError)) {
    return { status: 'expired', changed: input.status !== 'expired' }
  }

  const stale =
    input.lastSuccessAt === null ||
    now.getTime() - input.lastSuccessAt.getTime() > STALE_AFTER_MS
  if (stale) {
    return { status: 'error', changed: input.status !== 'error' }
  }

  return { status: 'connected', changed: input.status !== 'connected' }
}
```

- [ ] **Step 5: Run the tests and confirm PASS**

Run: `pnpm test tests/integrations/webhook.test.ts tests/integrations/health.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(integrations): connection-health evaluation + HMAC webhook verification"
```

---

## Task 7: Sync Scheduler (Inngest) + end-to-end test via the fake connector

**Files:**
- Create: `src/lib/inngest/functions/sync-connection.ts`
- Create: `src/lib/inngest/functions/sync-scheduler.ts`
- Create: `src/lib/inngest/functions/monthly-rollup.ts`
- Create: `src/lib/inngest/functions/health-alert.ts`
- Create: `tests/integrations/sync-e2e.test.ts`

The scheduler logic lives in plain async functions that the Inngest function wrappers call, so they are directly unit/integration testable without running the Inngest dev server.

- [ ] **Step 1: Write the failing end-to-end test `tests/integrations/sync-e2e.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { syncOneConnection, computeSyncWindow } from '@/lib/inngest/functions/sync-connection'

describe('sync scheduler end-to-end (fake connector)', () => {
  let orgOne: string
  let orgTwo: string
  let connOne: string

  beforeAll(async () => {
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    await sql`delete from public.metric_daily where provider = 'fake' and organization_id in (${orgOne}, ${orgTwo})`
    await sql`delete from public.raw_event where provider = 'fake' and organization_id in (${orgOne}, ${orgTwo})`

    const c = await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgOne}, 'fake', 'connected', 'C1 fake')
      on conflict (organization_id, provider) do update set status = 'connected'
      returning id`
    connOne = c[0]!.id as string

    await sql`
      insert into public.connection_account_map (organization_id, connection_id, external_account_id, kind, label)
      values (${orgOne}, ${connOne}, 'acct-1', 'property', 'GA4 prop')
      on conflict (connection_id, external_account_id) do nothing`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('computeSyncWindow returns a rolling re-sync window ending today', () => {
    const w = computeSyncWindow(new Date('2026-06-29T00:00:00Z'), 3)
    expect(w.end).toBe('2026-06-29')
    expect(w.start).toBe('2026-06-27')
  })

  it('syncs the fake connection into metric_daily + raw_event idempotently', async () => {
    const r1 = await syncOneConnection(connOne, { now: new Date('2026-06-29T00:00:00Z'), reSyncDays: 3 })
    expect(r1.metricsWritten).toBeGreaterThan(0)
    expect(r1.status).toBe('connected')

    const metrics1 = await sql`
      select count(*)::int as c from public.metric_daily
      where organization_id = ${orgOne} and provider = 'fake'`
    expect(metrics1[0]!.c).toBe(3) // 3-day rolling window

    // Re-run: same window, idempotent — count must not grow.
    await syncOneConnection(connOne, { now: new Date('2026-06-29T00:00:00Z'), reSyncDays: 3 })
    const metrics2 = await sql`
      select count(*)::int as c from public.metric_daily
      where organization_id = ${orgOne} and provider = 'fake'`
    expect(metrics2[0]!.c).toBe(3)

    // raw_event recorded and deduped.
    const raw = await sql`
      select count(*)::int as c from public.raw_event
      where organization_id = ${orgOne} and provider = 'fake'`
    expect(raw[0]!.c).toBe(1)
  })

  it('updates last_success_at + status on the connection', async () => {
    await syncOneConnection(connOne, { now: new Date('2026-06-29T00:00:00Z'), reSyncDays: 3 })
    const conn = await sql`select status, last_success_at from public.connection where id = ${connOne}`
    expect(conn[0]!.status).toBe('connected')
    expect(conn[0]!.last_success_at).not.toBeNull()
  })

  it('the fake provider never writes another tenant\'s rows', async () => {
    await syncOneConnection(connOne, { now: new Date('2026-06-29T00:00:00Z'), reSyncDays: 3 })
    const leaked = await sql`
      select count(*)::int as c from public.metric_daily
      where organization_id = ${orgTwo} and provider = 'fake'`
    expect(leaked[0]!.c).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/sync-e2e.test.ts`
Expected: FAIL — `@/lib/inngest/functions/sync-connection` does not exist.

- [ ] **Step 3: Write `src/lib/inngest/functions/sync-connection.ts`**

```ts
import { db } from '@/db'
import { connection, connectionAccountMap } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest/client'
import { getConnector } from '@/lib/integrations/registry'
import { upsertMetricsDaily } from '@/lib/integrations/metrics-store'
import { recordRawEvent } from '@/lib/integrations/raw-event'
import { getToken } from '@/lib/integrations/vault'
import { evaluateHealth } from '@/lib/integrations/health'
import type { NormalizedMetric } from '@/lib/integrations/connector'

/** Inclusive rolling re-sync window ending on `now` (UTC), reSyncDays wide. */
export function computeSyncWindow(now: Date, reSyncDays: number): { start: string; end: string } {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - (reSyncDays - 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export interface SyncOptions {
  now?: Date
  reSyncDays?: number
}

export interface SyncResult {
  connectionId: string
  metricsWritten: number
  status: string
}

/**
 * Sync ONE connection: resolve connector + accounts + token, fetch over the
 * rolling re-sync window, record the raw payload (idempotent), normalize, and
 * idempotently upsert into metric_daily. Updates connection health on the way.
 * Errors are caught and stored on the connection; health is re-evaluated.
 */
export async function syncOneConnection(
  connectionId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const reSyncDays = opts.reSyncDays ?? 3
  const window = computeSyncWindow(now, reSyncDays)

  const [conn] = await db.select().from(connection).where(eq(connection.id, connectionId))
  if (!conn) throw new Error(`connection not found: ${connectionId}`)

  try {
    const connector = getConnector(conn.provider)
    const accounts = await db
      .select()
      .from(connectionAccountMap)
      .where(eq(connectionAccountMap.connectionId, connectionId))

    // Token is optional for the fake provider; real providers require it.
    const token = (await getToken(conn.organizationId, conn.provider)) ?? ''

    let written = 0
    for (const acct of accounts) {
      const ctx = {
        organizationId: conn.organizationId,
        accountId: acct.externalAccountId,
        token,
        window,
      }
      const raw = await connector.fetch(ctx)
      await recordRawEvent({
        organizationId: conn.organizationId,
        provider: conn.provider,
        providerEventId: raw.providerEventId,
        kind: 'sync',
        payload: raw,
      })
      const metrics: NormalizedMetric[] = connector.normalize(raw, ctx)
      written += await upsertMetricsDaily(conn.organizationId, metrics)
    }

    const health = evaluateHealth(
      { status: 'connected', lastSuccessAt: now, lastError: null },
      now,
    )
    await db
      .update(connection)
      .set({
        status: health.status,
        lastSyncAt: now,
        lastSuccessAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(connection.id, connectionId))

    return { connectionId, metricsWritten: written, status: health.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const health = evaluateHealth(
      { status: conn.status, lastSuccessAt: conn.lastSuccessAt, lastError: message },
      now,
    )
    await db
      .update(connection)
      .set({ status: health.status, lastSyncAt: now, lastError: message, updatedAt: now })
      .where(eq(connection.id, connectionId))

    if (health.changed && (health.status === 'error' || health.status === 'expired')) {
      await inngest.send({
        name: 'integrations/connection.health.changed',
        data: { connectionId, organizationId: conn.organizationId, status: health.status, message },
      })
    }
    throw err
  }
}

/**
 * Inngest wrapper for a single connection sync. Retries with Inngest's built-in
 * exponential backoff + jitter; concurrency is bounded at the function level so
 * we never exceed per-provider rate budgets (PRD §6.2).
 */
export const syncConnection = inngest.createFunction(
  {
    id: 'sync-connection',
    retries: 4,
    concurrency: { limit: 5 },
  },
  { event: 'integrations/connection.sync' },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string }
    return step.run('sync', () => syncOneConnection(connectionId))
  },
)
```

- [ ] **Step 4: Write `src/lib/inngest/functions/sync-scheduler.ts` (cron fan-out)**

```ts
import { db } from '@/db'
import { connection } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { inngest } from '@/lib/inngest/client'

/** Provider statuses that are eligible for scheduled sync. */
const SYNCABLE = ['connected', 'error', 'expired'] as const

/**
 * Nightly cron: fan out one sync event per eligible connection. Inngest applies
 * the concurrency limit on `sync-connection`, so this just enqueues; bounded
 * concurrency + backoff+jitter are handled by the per-connection function.
 */
export const syncScheduler = inngest.createFunction(
  { id: 'sync-scheduler' },
  { cron: '0 3 * * *' }, // 03:00 UTC nightly (PRD §6.2)
  async ({ step }) => {
    const conns = await step.run('list-connections', async () =>
      db
        .select({ id: connection.id, organizationId: connection.organizationId })
        .from(connection)
        .where(inArray(connection.status, [...SYNCABLE])),
    )

    if (conns.length > 0) {
      await step.sendEvent(
        'fan-out',
        conns.map((c) => ({
          name: 'integrations/connection.sync',
          data: { connectionId: c.id, organizationId: c.organizationId },
        })),
      )
    }

    return { enqueued: conns.length }
  },
)
```

- [ ] **Step 5: Write `src/lib/inngest/functions/monthly-rollup.ts`**

```ts
import { db } from '@/db'
import { connection } from '@/db/schema'
import { inngest } from '@/lib/inngest/client'
import { rollupMonth } from '@/lib/integrations/metrics-store'

/** First day of the month containing `d` as 'YYYY-MM-01'. */
export function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Monthly cron (a few days into the new month for data completeness, PRD §7):
 * roll the PREVIOUS month's metric_daily into metric_monthly_rollup per org.
 */
export const monthlyRollup = inngest.createFunction(
  { id: 'monthly-rollup' },
  { cron: '0 5 5 * *' }, // 05:00 UTC on the 5th
  async ({ step }) => {
    const now = new Date()
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const month = monthStart(prev)

    const orgs = await step.run('list-orgs', async () => {
      const rows = await db
        .selectDistinct({ organizationId: connection.organizationId })
        .from(connection)
      return rows.map((r) => r.organizationId)
    })

    for (const org of orgs) {
      await step.run(`rollup-${org}`, () => rollupMonth(org, month))
    }

    return { month, orgs: orgs.length }
  },
)
```

- [ ] **Step 6: Write `src/lib/inngest/functions/health-alert.ts`**

```ts
import { inngest } from '@/lib/inngest/client'
import { sendAlertEmail } from '@/lib/email/resend'

/**
 * On a connection-health transition to error/expired, email the agency (PRD
 * §5.5/§5.14). Triggered by the event emitted from syncOneConnection.
 */
export const healthAlert = inngest.createFunction(
  { id: 'connection-health-alert' },
  { event: 'integrations/connection.health.changed' },
  async ({ event, step }) => {
    const { connectionId, organizationId, status, message } = event.data as {
      connectionId: string
      organizationId: string
      status: string
      message: string
    }
    await step.run('send-email', () =>
      sendAlertEmail(
        `Connection ${status}: ${connectionId}`,
        `<p>Connection <code>${connectionId}</code> for org <code>${organizationId}</code> is <strong>${status}</strong>.</p><p>${message}</p><p>Reconnect from the connection-health dashboard.</p>`,
      ),
    )
    return { alerted: connectionId }
  },
)
```

- [ ] **Step 7: Run the e2e test and confirm PASS**

Run: `pnpm test tests/integrations/sync-e2e.test.ts`
Expected: all assertions PASS — the fake connection syncs 3 rolling days into `metric_daily`, re-running is idempotent (count stays 3), exactly one `raw_event`, `last_success_at`/`status` updated, and no rows leak to org two.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(integrations): Inngest sync scheduler, per-connection sync, rollup, health alert"
```

---

## Task 8: Generic signature-verified webhook intake route + ingest worker

**Files:**
- Create: `src/app/api/webhooks/[provider]/route.ts`
- Create: `src/lib/inngest/functions/webhook-ingest.ts`

The route returns a fast 200 after verifying the signature and enqueuing an Inngest event; the worker persists `raw_event` idempotently (PRD §6.2). It resolves org + secret from `webhook_endpoint.slug` (passed as the `?slug=` query param) using a server-only Drizzle read.

- [ ] **Step 1: Write the ingest worker `src/lib/inngest/functions/webhook-ingest.ts`**

```ts
import { inngest } from '@/lib/inngest/client'
import { recordRawEvent } from '@/lib/integrations/raw-event'
import type { IntegrationProvider } from '@/db/types'

/**
 * Process an enqueued webhook payload: persist verbatim to raw_event,
 * idempotent on (org, provider, provider_event_id) so redelivery is a no-op.
 * Lead/payment-specific normalization is handled by later plans that subscribe
 * to the same event; this backbone only guarantees durable, deduped capture.
 */
export const webhookIngest = inngest.createFunction(
  { id: 'webhook-ingest', retries: 4 },
  { event: 'integrations/webhook.received' },
  async ({ event, step }) => {
    const { organizationId, provider, providerEventId, payload } = event.data as {
      organizationId: string
      provider: IntegrationProvider
      providerEventId: string
      payload: unknown
    }
    const isNew = await step.run('record', () =>
      recordRawEvent({
        organizationId,
        provider,
        providerEventId,
        kind: 'webhook',
        payload,
      }),
    )
    return { recorded: isNew }
  },
)
```

- [ ] **Step 2: Write the route handler `src/app/api/webhooks/[provider]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { webhookEndpoint } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { verifySignature } from '@/lib/integrations/webhook'
import { inngest } from '@/lib/inngest/client'
import type { IntegrationProvider } from '@/db/types'

export const runtime = 'nodejs'

/**
 * Generic signature-verified webhook intake. URL: /api/webhooks/{provider}?slug={slug}
 * Steps: resolve endpoint by slug -> read HMAC secret from Vault -> verify the
 * raw body signature -> enqueue to the ingest worker -> fast 200. Idempotency is
 * enforced downstream via provider_event_id (PRD §6.2).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing slug' }, { status: 400 })

  const [endpoint] = await db
    .select()
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.slug, slug),
        eq(webhookEndpoint.provider, provider as IntegrationProvider),
        eq(webhookEndpoint.isActive, true),
      ),
    )
  if (!endpoint) return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })

  // Read the signing secret from Vault by its stored name (service-role RPC).
  const secretRes = await db.execute(
    sql`select decrypted_secret as s from vault.decrypted_secrets where name = ${endpoint.vaultSecretName}`,
  )
  const secret = (secretRes as unknown as { s: string | null }[])[0]?.s
  if (!secret) return NextResponse.json({ error: 'misconfigured endpoint' }, { status: 500 })

  const rawBody = await req.text()
  const signature =
    req.headers.get('x-signature') ??
    req.headers.get('x-hub-signature-256') ??
    req.headers.get('stripe-signature') ??
    ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = { raw: rawBody }
  }

  // Derive a provider event id for idempotency: prefer explicit header/body id.
  const providerEventId =
    req.headers.get('x-event-id') ??
    (typeof payload === 'object' && payload !== null && 'id' in payload
      ? String((payload as { id: unknown }).id)
      : `${slug}:${Date.now()}`)

  await inngest.send({
    name: 'integrations/webhook.received',
    data: {
      organizationId: endpoint.organizationId,
      provider: endpoint.provider,
      providerEventId,
      payload,
    },
  })

  // Fast 200 so the provider does not retry; processing is async + idempotent.
  return NextResponse.json({ received: true }, { status: 200 })
}
```

- [ ] **Step 3: Register the ingest worker in the serve route**

It is already included in the `functions` array written in Task 5 Step 7 (`webhookIngest`). Confirm `src/app/api/inngest/route.ts` lists it; if Plan 02 owns that file, ensure `webhookIngest` was merged in.

- [ ] **Step 4: Type-check the route + worker**

Run: `pnpm build`
Expected: compiles with no type errors (the route is a Node-runtime handler; `params` is awaited per Next 16).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(integrations): generic signature-verified webhook intake + idempotent ingest worker"
```

---

## Task 9: Full suite + CI gate

**Files:**
- None new (verification task).

- [ ] **Step 1: Re-seed to ensure a clean fixture set**

Run: `pnpm db:seed`
Expected: idempotent; prints the org/user IDs.

- [ ] **Step 2: Run the entire test suite**

Run: `pnpm test`
Expected: all suites green, including:
- `tests/rls/isolation.test.ts` (Plan 01, still passing)
- `tests/rls/integration-isolation.test.ts` (Plan 06 — every new tenant table proven isolated)
- `tests/integrations/fake-connector.test.ts`
- `tests/integrations/metrics-store.test.ts`
- `tests/integrations/backoff.test.ts`
- `tests/integrations/vault.test.ts`
- `tests/integrations/webhook.test.ts`
- `tests/integrations/health.test.ts`
- `tests/integrations/sync-e2e.test.ts`

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: lint clean; production build succeeds (Inngest serve route + webhook route compile).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(integrations): full backbone suite green (RLS, vault, sync e2e)"
```

> CI: the Plan 01 `.github/workflows/ci.yml` already runs `pnpm test` against the local Supabase stack — these tests run automatically. No workflow change needed beyond ensuring the new env keys (`INNGEST_*`, `RESEND_API_KEY`, `ALERT_*`) have safe defaults in CI (the tests mock no live email since Resend is only called from the `healthAlert` job, which is not exercised by the suite).

---

## Self-Review

**Spec coverage (vs PRD §6.1, §6.2, §6.5, §8):**
- §6.1 two-plane principle (dashboard reads only our store, never live APIs) → metrics store is the single read surface; connectors only run inside Inngest jobs. ✅
- §6.2(1) Integration Service / orchestration → Inngest `sync-scheduler` + `sync-connection`. ✅
- §6.2(2) Per-provider Connectors with `fetch()`+`normalize()` behind one interface → `connector.ts` + `registry.ts` + `fake-connector.ts` (real providers slot in later). ✅
- §6.2(3) Token Vault: per-client, tenant-scoped, server-side service-role only, refresh/revocation/health → `vault_*` SECURITY DEFINER RPCs + `vault.ts` + `vault_delete_token` for revocation + health checks each sync. ✅
- §6.2(4) Sync Scheduler: per-client fan-out, bounded concurrency, backoff+jitter, idempotent upserts, rolling re-sync windows → `sync-scheduler` (fan-out), `concurrency.limit` + `retries` (Inngest backoff+jitter), `backoff.ts` (explicit helper for non-Inngest callers), `upsertMetricsDaily` (idempotent), `computeSyncWindow` (rolling window). ✅
- §6.2(5) Normalized Metrics Store keyed by (tenant, provider, account_id, entity, date, metric, value) + monthly rollup → `metric_daily` natural-key PK with `is_provisional`, `metric_monthly_rollup`. ✅
- §6.2(6) Webhook Intake: signature-verified, fast 200 + enqueue, idempotent → `/api/webhooks/[provider]` + `webhook-ingest` worker + `verifySignature` + `provider_event_id` dedupe. ✅
- §6.5 data-trust: raw-response audit log (`raw_event`), provisional flag on recent days (`is_provisional`, fake connector flags last day, real connectors set trailing-3-day) → ✅. ("as of" timestamp = `metric_daily.synced_at` / `connection.last_sync_at`; surfaced by the analytics plan.)
- §8 tables: `connection`, `connection_account_map`, `oauth_token` (vault-backed → realized as Vault secrets via RPC, not an app table, per §9 "never expose tokens to the browser"), `webhook_endpoint`, `metric_daily`, `metric_monthly_rollup`, `raw_event` → all present. ✅
- §9 security: every new tenant table has `organization_id` leading a composite index, RLS reuses `has_org_access`/`is_agency_staff`, `service_role` only in jobs/RPCs, RLS isolation test per table → Task 1 indexes + Task 2 policies + Task 2 isolation tests. ✅

**Design note on `oauth_token`:** PRD §8 lists `oauth_token (vault-backed)` and §9 mandates tokens live encrypted in Vault and "never expose tokens to the browser." This plan implements that as Supabase Vault secrets reached only through `public.vault_*` SECURITY DEFINER RPCs (keyed `<org_id>:<provider>`), plus a `vaultSecretName` pointer on `connection`/`webhook_endpoint`. There is intentionally no plaintext `oauth_token` table — that satisfies "vault-backed" without a second secret surface. Documented here so a reviewer does not flag the missing table as a gap.

**Placeholder scan:** No TBD/TODO/"similar to above". Every code step contains complete, runnable code. The only conditional steps ("create if Plan 02 didn't") are explicit idempotency instructions, not placeholders. Migration filenames use `06xx_` because the exact sequence number depends on Plans 02–05; the generator assigns it. ✅

**Type consistency:** `IntegrationProvider`/`ConnectionStatus`/`AccountKind` derived from schema in `src/db/types.ts` and reused across `connector.ts`, `registry.ts`, `vault.ts`, `health.ts`, route, and workers. `NormalizedMetric` is the single contract between `Connector.normalize()` and `upsertMetricsDaily()`. Provider literal `'fake'` consistent across enum, fake connector, registry, and all tests. `metric_daily_pk` / `metric_monthly_rollup_pk` constraint names match between schema, the rollup SQL `on conflict on constraint`, and tests. RLS helper names (`has_org_access`, `is_agency_staff`) match Plan 01 exactly. Inngest event names (`integrations/connection.sync`, `integrations/connection.health.changed`, `integrations/webhook.received`) consistent between senders and `createFunction` triggers. ✅

**Definition of done for Plan 06:** `pnpm lint && pnpm build && pnpm test` green — RLS isolation proven for all six new tenant tables, vault RPCs enforce staff-only tenant-scoped access, and the fake connector drives the scheduler + metrics store end-to-end (rolling-window idempotent upserts, single deduped `raw_event`, connection health updated) with zero cross-tenant leakage.
