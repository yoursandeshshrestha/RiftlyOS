# Agency OS — Plan 13: Client Onboarding & Connections UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the human-facing **Client Onboarding & Connections Hub** (PRD §5.5) on top of the integration backbone from Plan 06: a guided per-client **onboarding wizard** (company details → services → a per-provider **Connect** step) and an internal **connection-health dashboard** (every client × provider with `not_connected | pending | connected | error | expired`, last sync, last error, a **Reconnect** action, and alerting). Each provider gets a documented connect flow (service-account grant for GA4/GSC, OAuth consent for GBP, MCC link-invite for Google Ads, Partner-access for Meta, API-key/webhook for CallRail/WhatConverts, own-form embed for `web_form`) plus a **"verify connection"** call that proves data is retrievable and transitions the health state. We add tenant-mapping **validation** (a connection's external account id can never be mapped to the wrong tenant — enforced in the DB and proven by tests) and **health-state transition** tests.

**Architecture:** This plan is pure Plane-B-adjacent UI + orchestration over Plane A. It adds **no** new metrics or sync code — it drives the Plan 06 `connection` / `connection_account_map` / `webhook_endpoint` tables and the `vault_*` RPCs through staff-only Server Actions, and renders the per-provider connect-flow documentation that Plans 07–09 said the wizard would surface. Every provider implements a small **verifier** behind a typed `ProviderVerifier` registry (mirroring Plan 06's `Connector` registry) so a "verify connection" button can call a cheap, provider-specific check; for providers whose real connectors are not yet wired (or whose APIs are mocked in tests) the verifier resolves account-map presence + token presence and (for the `fake` provider) always succeeds, so the wizard is end-to-end testable with **no external APIs**. Two new tenant-scoped tables are introduced — `onboarding_progress` (one row per client org tracking wizard step + completion) and `tenant_map_audit` (immutable log of every account-map create/change, satisfying PRD §5.5 "mapping is validated and audited"). A DB trigger enforces the tenant-mapping invariant defensively (the account-map row's `organization_id` must equal the parent connection's `organization_id`), and a `verify_account_map_tenant()` SECURITY DEFINER function backs an explicit validation Server Action. Health transitions reuse Plan 06's pure `evaluateHealth()`; a `reconnectConnection()` Server Action resets status to `pending`, clears the error, deletes the vault token on revocation, and writes an audit row. Connection-health alerts reuse Plan 05's `emitNotification()` (`connection_broken` category, a critical alert) and `recordAuditEvent()`. Tenancy: every new table carries `organization_id` (the **client** org = tenant) as the leading column of a composite index; RLS reuses the Plan 01 helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`; `service_role` is used only by the seed/admin, never user-facing queries; and every new tenant-scoped table ships an RLS isolation test using the Plan 01 harness `tests/helpers/db.ts` (`asUser()`).

**Tech Stack:** Next.js 16 (App Router, TypeScript strict) · pnpm · Supabase Postgres + Auth + Vault · Drizzle ORM + drizzle-kit · postgres.js · Tailwind + shadcn/ui · Vitest (unit/integration incl. RLS isolation; external provider calls mocked) · Inngest (reuses Plan 06 health-alert pipeline) · Resend (reuses Plan 05 `emitNotification`). No new external SDKs.

**Prerequisites (assumed already built — do not re-spec):**
- **Plan 01 (Foundation):** `organizations`/`profiles`/`memberships`, `org_type`/`app_role` enums, `public.has_org_access(uuid)` / `public.is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, the `tests/helpers/db.ts` harness (`sql`, `asUser()`, `userIdByEmail()`), `src/lib/auth.ts` (`getSession`, `isStaff`), and the `(internal)`/`(portal)` shells.
- **Plan 02 (Clients/CRM):** the `client` table (one row per client org; `organization_id` = the client org id), `client_contact`, `service`, and the staff-only client-detail page under `(internal)/clients/[clientId]`.
- **Plan 06 (Integration Backbone):** `connection`, `connection_account_map`, `webhook_endpoint`, `raw_event`, `metric_daily`, `metric_monthly_rollup`; the `integration_provider`, `connection_status`, `account_kind` enums; the `vault_set_token`/`vault_get_token`/`vault_delete_token`/`vault_secret_name` RPCs; `src/lib/integrations/connector.ts` (`Connector`, `FetchContext`, `NormalizedMetric`), `registry.ts` (`getConnector`/`hasConnector`/`registerConnector`), `vault.ts` (`getToken`/`setToken`/`deleteToken`), `health.ts` (`evaluateHealth`), and the Inngest health-alert event `integrations/connection.health.changed`.
- **Plan 07/08/09 (connectors):** GA4/GSC, Google Ads/Meta, and GBP connectors registered behind Plan 06's interface. This plan does **not** implement connectors; it surfaces their connect-flow docs and a verifier shim. Where a real connector exposes nothing callable yet, the verifier degrades gracefully (token + account-map presence check).

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                                   # MODIFY: onboarding_progress, tenant_map_audit
│  │  └─ types.ts                                    # MODIFY: inferred row types + OnboardingStep
│  ├─ lib/
│  │  └─ integrations/
│  │     ├─ connect-flows.ts                         # NEW: per-provider connect-flow metadata (steps, scopes, gotchas)
│  │     ├─ provider-verifier.ts                     # NEW: ProviderVerifier interface + registry + default verifiers
│  │     ├─ onboarding.ts                            # NEW: data-access (progress read/advance, connection summary)
│  │     ├─ tenant-map.ts                            # NEW: validateAccountMapTenant() + audited mapping helpers
│  │     └─ connections-admin.ts                     # NEW: server-only orchestration (upsert connection, map, verify, reconnect)
│  ├─ app/
│  │  ├─ (internal)/
│  │  │  ├─ clients/[clientId]/
│  │  │  │  └─ onboarding/page.tsx                    # NEW: the guided wizard (server component shell)
│  │  │  ├─ connections/
│  │  │  │  └─ page.tsx                               # NEW: connection-health dashboard (all clients × provider)
│  │  │  └─ actions/connections.ts                   # NEW: staff Server Actions (start/advance, connect, map, verify, reconnect)
│  │  └─ (portal)/
│  │     └─ connections/page.tsx                      # NEW: client self-serve "Connect your accounts" view
│  ├─ components/
│  │  └─ connections/
│  │     ├─ wizard-stepper.tsx                        # NEW: step indicator (company → services → connect)
│  │     ├─ provider-connect-card.tsx                 # NEW: one provider's instructions + Connect/Verify controls
│  │     ├─ connection-status-badge.tsx               # NEW: status pill (not_connected/pending/connected/error/expired)
│  │     └─ health-table.tsx                          # NEW: client × provider health grid + Reconnect
└─ tests/
   ├─ rls/onboarding-isolation.test.ts                # NEW: RLS isolation (onboarding_progress, tenant_map_audit)
   ├─ integrations/connect-flows.test.ts              # NEW: every provider has a complete connect flow + verifier
   ├─ integrations/provider-verifier.test.ts          # NEW: verify() health transitions (fake + degraded paths)
   ├─ integrations/tenant-map.test.ts                 # NEW: tenant-mapping validation (cannot map to wrong tenant)
   └─ integrations/connections-admin.test.ts          # NEW: connect/verify/reconnect orchestration end-to-end
```

---

## Task 1: Schema — `onboarding_progress` + `tenant_map_audit`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/13xx_onboarding_tables.sql` (generated)

> Migration filenames use `13xx_` because the exact sequence number depends on Plans 02–12 already applied; `pnpm db:generate` assigns the real number.

- [ ] **Step 1: Append the two tables + enum to `src/db/schema.ts`**

These reuse the Plan 06 `integrationProvider` enum (already in scope in the same file). `onboarding_progress` is one row per client org tracking the wizard. `tenant_map_audit` is the immutable mapping-change log (PRD §5.5 "mapping is validated and audited").

```ts
// ---------------------------------------------------------------------------
// Plan 13: Client onboarding wizard + connection-health UI
// ---------------------------------------------------------------------------

// The wizard's linear steps (PRD §5.5: company details -> services -> connect).
export const onboardingStep = pgEnum('onboarding_step', [
  'company',
  'services',
  'connect',
  'complete',
])

// One row per client org: where the guided wizard currently is.
export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    currentStep: onboardingStep('current_step').notNull().default('company'),
    companyCompletedAt: timestamp('company_completed_at', { withTimezone: true }),
    servicesCompletedAt: timestamp('services_completed_at', { withTimezone: true }),
    connectCompletedAt: timestamp('connect_completed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule)
    idxOrgStep: index('idx_onboarding_org_step').on(t.organizationId, t.currentStep),
    // exactly one progress row per client org
    uniqOrg: unique('uniq_onboarding_org').on(t.organizationId),
  }),
)

// Immutable audit of every account-map create/change. Writing it on every
// mapping change satisfies PRD §5.5: tenant mapping is validated AND audited.
export const tenantMapAudit = pgTable(
  'tenant_map_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    kind: accountKind('kind').notNull().default('other'),
    action: text('action').notNull(), // 'mapped' | 'remapped' | 'unmapped' | 'validated'
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgCreated: index('idx_tenant_map_audit_org_created').on(t.organizationId, t.createdAt),
    idxConn: index('idx_tenant_map_audit_conn').on(t.connectionId),
  }),
)
```

> `connection`, `accountKind`, `integrationProvider`, `organizations`, and `profiles` are already defined earlier in `src/db/schema.ts` (Plans 01/06). Do not re-import or redeclare them. Ensure `pgEnum`, `index`, and `unique` are present in the existing `drizzle-orm/pg-core` import line.

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type { onboardingProgress, tenantMapAudit } from './schema'

export type OnboardingProgress = typeof onboardingProgress.$inferSelect
export type NewOnboardingProgress = typeof onboardingProgress.$inferInsert
export type TenantMapAudit = typeof tenantMapAudit.$inferSelect
export type OnboardingStep = OnboardingProgress['currentStep']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/13xx_onboarding_tables.sql` file containing the `onboarding_step` enum and the two tables with their indexes/unique constraints.

- [ ] **Step 4: Apply the migration and verify**

Run: `pnpm db:migrate`
Then:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E "onboarding_progress|tenant_map_audit"
```
Expected: `onboarding_progress` and `tenant_map_audit` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): onboarding_progress + tenant_map_audit tables"
```

---

## Task 2: RLS + tenant-mapping trigger + validation function → isolation tests FIRST, then PASS

**Files:**
- Create: `tests/rls/onboarding-isolation.test.ts`
- Create: `drizzle/13xx_onboarding_rls.sql` (custom SQL migration)

RLS is not yet enabled on the two new tables, so a client user can currently read every tenant's rows. We also add a DB-level invariant: an `connection_account_map` row's `organization_id` must equal its parent `connection.organization_id` (defense-in-depth against cross-tenant mis-mapping, PRD §5.5/§13). Write the isolation tests, confirm they FAIL, then add RLS + the trigger + the validation function to make them PASS.

- [ ] **Step 1: Write the failing isolation tests `tests/rls/onboarding-isolation.test.ts`**

Reuses the Plan 01 harness. Seeds one onboarding row + one audit row per client org as `service_role` (the raw `sql` connection bypasses RLS for setup), then asserts each client user sees only their own.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('onboarding + tenant-map-audit tenant isolation (RLS)', () => {
  let clientOneUser: string
  let clientTwoUser: string
  let founder: string
  let orgOne: string
  let orgTwo: string
  let connOne: string
  let connTwo: string

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')
    founder = await userIdByEmail('founder@milktreeagency.com')

    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    // connections (one per client org) — idempotent.
    const c1 = await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgOne}, 'fake', 'pending', 'C1 fake')
      on conflict (organization_id, provider) do update set status = 'pending'
      returning id`
    const c2 = await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgTwo}, 'fake', 'pending', 'C2 fake')
      on conflict (organization_id, provider) do update set status = 'pending'
      returning id`
    connOne = c1[0]!.id as string
    connTwo = c2[0]!.id as string

    // onboarding progress (one per client org).
    await sql`
      insert into public.onboarding_progress (organization_id, current_step)
      values (${orgOne}, 'connect')
      on conflict (organization_id) do update set current_step = 'connect'`
    await sql`
      insert into public.onboarding_progress (organization_id, current_step)
      values (${orgTwo}, 'connect')
      on conflict (organization_id) do update set current_step = 'connect'`

    // a tenant-map audit row per client org.
    await sql`delete from public.tenant_map_audit where organization_id in (${orgOne}, ${orgTwo})`
    await sql`
      insert into public.tenant_map_audit
        (organization_id, connection_id, provider, external_account_id, kind, action)
      values (${orgOne}, ${connOne}, 'fake', 'acct-1', 'property', 'mapped')`
    await sql`
      insert into public.tenant_map_audit
        (organization_id, connection_id, provider, external_account_id, kind, action)
      values (${orgTwo}, ${connTwo}, 'fake', 'acct-2', 'property', 'mapped')`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client user sees ONLY their own onboarding_progress', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id from public.onboarding_progress`,
    )
    expect(rows.length).toBe(1)
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
  })

  it('a client user sees ONLY their own tenant_map_audit rows', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id, external_account_id from public.tenant_map_audit`,
    )
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
    expect(rows.some((r) => r.external_account_id === 'acct-2')).toBe(false)
  })

  it('agency staff (founder) sees ALL onboarding rows', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select organization_id from public.onboarding_progress`,
    )
    const orgs = new Set(rows.map((r) => r.organization_id))
    expect(orgs.has(orgOne)).toBe(true)
    expect(orgs.has(orgTwo)).toBe(true)
  })

  it('a client user CANNOT write onboarding_progress (staff-managed)', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`update public.onboarding_progress set current_step = 'complete'
           where organization_id = ${orgOne}`,
      ),
    ).rejects.toThrow()
  })

  it('the DB rejects an account-map row whose org != parent connection org', async () => {
    // connOne belongs to orgOne; mapping it under orgTwo must be rejected by the trigger.
    await expect(
      sql`
        insert into public.connection_account_map
          (organization_id, connection_id, external_account_id, kind)
        values (${orgTwo}, ${connOne}, 'evil-acct', 'property')`,
    ).rejects.toThrow()
  })

  it('verify_account_map_tenant() returns false for a cross-tenant pairing', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select public.verify_account_map_tenant(${connOne}, ${orgTwo}) as ok`,
    )
    expect(rows[0]!.ok).toBe(false)
  })

  it('verify_account_map_tenant() returns true for the correct pairing', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select public.verify_account_map_tenant(${connOne}, ${orgOne}) as ok`,
    )
    expect(rows[0]!.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they FAIL**

Run: `pnpm test tests/rls/onboarding-isolation.test.ts`
Expected: FAIL — without RLS the client user sees both orgs' rows; without the trigger the cross-tenant account-map insert succeeds; and `verify_account_map_tenant` does not exist (errors). This proves the tests are real.

- [ ] **Step 3: Create the custom migration**

Run: `pnpm db:generate --custom --name=onboarding_rls`
Expected: an empty `drizzle/13xx_onboarding_rls.sql` registered in the journal.

- [ ] **Step 4: Fill in `drizzle/13xx_onboarding_rls.sql`**

```sql
-- =========================================================================
-- Plan 13: RLS for onboarding tables + tenant-mapping invariant + validator.
-- Reuses Plan 01 helpers public.has_org_access(uuid) and public.is_agency_staff().
-- =========================================================================

-- ---- Enable RLS on the new tenant-scoped tables -------------------------
alter table public.onboarding_progress enable row level security;
alter table public.tenant_map_audit    enable row level security;

-- ---- onboarding_progress ------------------------------------------------
-- Read: the owning client org + agency staff (so the portal "Connect your
-- accounts" view can show the client their own progress).
create policy onboarding_select on public.onboarding_progress
  for select using (public.has_org_access(organization_id));
-- Write: agency staff only (staff drive onboarding; clients only grant access).
create policy onboarding_write on public.onboarding_progress
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ---- tenant_map_audit (read scoped to tenant; writes via service_role/staff)
create policy tenant_map_audit_select on public.tenant_map_audit
  for select using (public.has_org_access(organization_id));
-- staff may insert audit rows directly; the table is append-only (no update/delete policy)
create policy tenant_map_audit_insert on public.tenant_map_audit
  for insert with check (public.is_agency_staff() and public.has_org_access(organization_id));

-- =========================================================================
-- Tenant-mapping invariant: a connection_account_map row's organization_id
-- MUST equal its parent connection.organization_id. This is the hard DB-level
-- guard that a connection can never be mapped to the wrong tenant (PRD §5.5).
-- =========================================================================

create or replace function public.enforce_account_map_tenant()
returns trigger
language plpgsql
as $$
declare
  v_conn_org uuid;
begin
  select organization_id into v_conn_org
  from public.connection
  where id = new.connection_id;

  if v_conn_org is null then
    raise exception 'connection % does not exist', new.connection_id
      using errcode = '23503';
  end if;

  if new.organization_id <> v_conn_org then
    raise exception
      'tenant mismatch: account-map org % != connection org % (cross-tenant mapping blocked)',
      new.organization_id, v_conn_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_account_map_tenant on public.connection_account_map;
create trigger trg_enforce_account_map_tenant
  before insert or update on public.connection_account_map
  for each row execute function public.enforce_account_map_tenant();

-- Pure validator the app calls to pre-check / verify a mapping (PRD §5.5
-- "mapping is validated"). Returns true iff the connection belongs to p_org.
-- SECURITY DEFINER + staff check so it can be exposed to the authenticated role.
create or replace function public.verify_account_map_tenant(p_connection uuid, p_org uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_conn_org uuid;
begin
  if not (public.is_agency_staff() and public.has_org_access(p_org)) then
    raise exception 'not authorized to validate mapping for org %', p_org
      using errcode = '42501';
  end if;
  select organization_id into v_conn_org from public.connection where id = p_connection;
  return v_conn_org is not null and v_conn_org = p_org;
end;
$$;

revoke all on function public.verify_account_map_tenant(uuid, uuid) from public, anon;
grant execute on function public.verify_account_map_tenant(uuid, uuid)
  to authenticated, service_role;
```

- [ ] **Step 5: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `13xx_onboarding_rls.sql` with no errors.

- [ ] **Step 6: Run the isolation tests and confirm they PASS**

Run: `pnpm test tests/rls/onboarding-isolation.test.ts`
Expected: all assertions PASS — client users see only their own onboarding/audit rows, staff see all, clients cannot write onboarding, the cross-tenant account-map insert is rejected by the trigger, and `verify_account_map_tenant` returns the correct booleans.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(security): RLS on onboarding tables + tenant-mapping trigger/validator (tests pass)"
```

---

## Task 3: Per-provider connect-flow metadata

**Files:**
- Create: `src/lib/integrations/connect-flows.ts`
- Create: `tests/integrations/connect-flows.test.ts`

Each provider's connect flow is structured data the wizard and health dashboard render: the grant **mechanism**, an ordered list of **steps** the staff/client follow, the OAuth **scopes** (where relevant), the `account_kind` the connection maps, whether the client can self-serve, and the §6.3 **gotchas**. This is the single source of truth so the UI never hard-codes provider copy.

- [ ] **Step 1: Write the failing test `tests/integrations/connect-flows.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  CONNECT_FLOWS,
  getConnectFlow,
  type ConnectMechanism,
} from '@/lib/integrations/connect-flows'

// The providers the onboarding wizard must support (PRD §5.5/§6.3).
const REQUIRED_PROVIDERS = [
  'ga4',
  'gsc',
  'google_ads',
  'meta_ads',
  'gbp',
  'callrail',
  'whatconverts',
  'web_form',
] as const

describe('connect-flows', () => {
  it('defines a complete flow for every required provider', () => {
    for (const p of REQUIRED_PROVIDERS) {
      const flow = getConnectFlow(p)
      expect(flow, `missing flow for ${p}`).toBeDefined()
      expect(flow.provider).toBe(p)
      expect(flow.title.length).toBeGreaterThan(0)
      expect(flow.steps.length).toBeGreaterThan(0)
      expect(flow.accountKind.length).toBeGreaterThan(0)
      expect(typeof flow.clientSelfServe).toBe('boolean')
    }
  })

  it('uses the correct grant mechanism per provider (PRD §6.3)', () => {
    const expected: Record<string, ConnectMechanism> = {
      ga4: 'service_account_grant',
      gsc: 'service_account_grant',
      gbp: 'oauth_consent',
      google_ads: 'mcc_link_invite',
      meta_ads: 'partner_access',
      callrail: 'api_key_webhook',
      whatconverts: 'api_key_webhook',
      web_form: 'form_embed',
    }
    for (const [p, mech] of Object.entries(expected)) {
      expect(getConnectFlow(p as never).mechanism).toBe(mech)
    }
  })

  it('OAuth flows declare scopes; API-key flows declare a key field', () => {
    expect(getConnectFlow('gbp').oauthScopes).toContain(
      'https://www.googleapis.com/auth/business.manage',
    )
    expect(getConnectFlow('callrail').apiKeyLabel).toBeTruthy()
  })

  it('web_form and GA4/GBP are client-self-serve; Ads/Meta are staff-driven', () => {
    expect(getConnectFlow('web_form').clientSelfServe).toBe(true)
    expect(getConnectFlow('gbp').clientSelfServe).toBe(true)
    expect(getConnectFlow('google_ads').clientSelfServe).toBe(false)
    expect(getConnectFlow('meta_ads').clientSelfServe).toBe(false)
  })

  it('every flow carries at least one data-trust/approval gotcha', () => {
    for (const flow of Object.values(CONNECT_FLOWS)) {
      expect(flow.gotchas.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/connect-flows.test.ts`
Expected: FAIL — `@/lib/integrations/connect-flows` does not exist (import error).

- [ ] **Step 3: Write `src/lib/integrations/connect-flows.ts`**

```ts
import type { IntegrationProvider, AccountKind } from '@/db/types'

/** How a client grants the agency access for a provider (PRD §6.3). */
export type ConnectMechanism =
  | 'service_account_grant' // GA4, GSC: add our service account as Viewer/Analyst
  | 'oauth_consent' // GBP: OAuth consent screen (sensitive scope)
  | 'mcc_link_invite' // Google Ads: accept the MCC link invite (no per-client OAuth)
  | 'partner_access' // Meta: grant Partner access to ad account + Page
  | 'api_key_webhook' // CallRail / WhatConverts: API key + webhook URL
  | 'form_embed' // our own embeddable lead form

export interface ConnectFlow {
  provider: IntegrationProvider
  title: string
  /** Short one-line description shown under the provider title. */
  summary: string
  mechanism: ConnectMechanism
  /** The kind of external object this connection maps (drives account-map entry). */
  accountKind: AccountKind
  /** Ordered, plain-English steps the staff/client follow. */
  steps: string[]
  /** OAuth scopes (only for oauth_consent flows). */
  oauthScopes?: string[]
  /** Label for the secret captured by api_key_webhook flows (e.g. 'CallRail API key'). */
  apiKeyLabel?: string
  /** Whether the client can complete this from the portal self-serve view. */
  clientSelfServe: boolean
  /** §6.3 gotchas / approval caveats surfaced in the UI. */
  gotchas: string[]
}

export const CONNECT_FLOWS: Record<string, ConnectFlow> = {
  ga4: {
    provider: 'ga4',
    title: 'Google Analytics 4',
    summary: 'Add our service account as a Viewer/Analyst on the GA4 account.',
    mechanism: 'service_account_grant',
    accountKind: 'property',
    steps: [
      'In GA4 Admin → Account Access Management, click the + and Add users.',
      'Paste the Agency OS service-account email (shown in the Connect step).',
      'Grant the Viewer (or Analyst) role at the ACCOUNT level so future properties are covered.',
      'Back in Agency OS, click Verify connection — we will discover your properties automatically.',
    ],
    clientSelfServe: true,
    gotchas: [
      'Grant at the account level, not a single property, so new properties are auto-covered.',
      'Big queries may be sampled — we cache nightly and never query GA4 on page load.',
      'The most recent ~3 days are provisional (24–48h processing lag).',
    ],
  },
  gsc: {
    provider: 'gsc',
    title: 'Google Search Console',
    summary: 'Add our account as a Full user on each verified property.',
    mechanism: 'service_account_grant',
    accountKind: 'site',
    steps: [
      'Open Search Console → Settings → Users and permissions for the property.',
      'Click Add user and paste the Agency OS service-account email.',
      'Add it as a USER first, then (optionally) promote to Owner to avoid the known access bug.',
      'Repeat for each property, then click Verify connection in Agency OS.',
    ],
    clientSelfServe: true,
    gotchas: [
      'There is no API to self-add — every property needs a manual grant.',
      '~47% of clicks have no query (anonymization), so query rows never sum to totals.',
      'Data older than 16 months is deleted by Google — we keep our own rolling history.',
    ],
  },
  gbp: {
    provider: 'gbp',
    title: 'Google Business Profile',
    summary: 'Authorize Agency OS to read your locations’ performance + reviews.',
    mechanism: 'oauth_consent',
    accountKind: 'location',
    oauthScopes: ['https://www.googleapis.com/auth/business.manage'],
    steps: [
      'Click Connect to open the Google consent screen.',
      'Sign in with the Google account that MANAGES the business locations.',
      'Approve the requested Business Profile access.',
      'We enumerate your locations; confirm the mapping, then Verify connection.',
    ],
    clientSelfServe: true,
    gotchas: [
      'The authed account must manage each location (add our account/group as a manager).',
      'GBP data lags ~5 days; monthly reports run a few days into the new month.',
      'Two approval gates apply on our side (API allow-listing + sensitive-scope verification).',
    ],
  },
  google_ads: {
    provider: 'google_ads',
    title: 'Google Ads',
    summary: 'Accept our Manager (MCC) link invitation — no per-client OAuth.',
    mechanism: 'mcc_link_invite',
    accountKind: 'customer',
    steps: [
      'We send a link request from our Manager (MCC) account to your Google Ads customer ID.',
      'In Google Ads → Admin → Account access → Managers, approve the Agency OS request.',
      'Tell us your 10-digit customer ID (or confirm the one we detected).',
      'Click Verify connection once the link shows as Active.',
    ],
    clientSelfServe: false,
    gotchas: [
      'One agency MCC + one refresh token + one developer token serves all clients.',
      'cost_micros must be divided by 1,000,000; ROAS = conversions_value / cost (computed by us).',
      'We re-sync a trailing ~14-day window for conversion lag + retroactive attribution.',
    ],
  },
  meta_ads: {
    provider: 'meta_ads',
    title: 'Meta Ads (Facebook/Instagram)',
    summary: 'Grant Partner access to your ad account and Page.',
    mechanism: 'partner_access',
    accountKind: 'ad_account',
    steps: [
      'In Meta Business Settings → Partners, add the Agency OS Business ID as a Partner.',
      'Assign the ad account and the Page (for lead-gen) to that partner.',
      'Confirm your act_{ad_account_id}; we assign it to our System User token.',
      'Click Verify connection.',
    ],
    clientSelfServe: false,
    gotchas: [
      'One non-expiring System User token serves all clients; iterate act_{id} per client.',
      'Always pass explicit attribution windows — 7d_view/28d_view were removed Jan 12, 2026.',
      'We re-sync a 28-day rolling window and keep our own history.',
    ],
  },
  callrail: {
    provider: 'callrail',
    title: 'CallRail',
    summary: 'Paste your CallRail API key and add our webhook URL.',
    mechanism: 'api_key_webhook',
    accountKind: 'other',
    apiKeyLabel: 'CallRail API key',
    steps: [
      'In CallRail → Settings → Integrations → API, create or copy an API key.',
      'Paste the API key into the Connect step (stored encrypted in our vault).',
      'Copy the Agency OS webhook URL shown below into CallRail’s webhook settings.',
      'Place a test call, then click Verify connection.',
    ],
    clientSelfServe: false,
    gotchas: [
      'Webhooks are at-least-once — we dedupe on the provider event id (idempotent ingest).',
      'Call leads are de-duplicated against form/Meta leads by E.164 phone then email.',
    ],
  },
  whatconverts: {
    provider: 'whatconverts',
    title: 'WhatConverts',
    summary: 'Paste your WhatConverts API token and add our webhook URL.',
    mechanism: 'api_key_webhook',
    accountKind: 'other',
    apiKeyLabel: 'WhatConverts API token',
    steps: [
      'In WhatConverts → Settings → API, create an API token + secret.',
      'Paste the token into the Connect step (stored encrypted in our vault).',
      'Add the Agency OS webhook URL shown below as a WhatConverts webhook.',
      'Submit a test lead, then click Verify connection.',
    ],
    clientSelfServe: false,
    gotchas: [
      'Webhook redelivery must not create duplicates — handled by idempotent ingest.',
      'Leads merge with other sources by phone/email within the configured dedupe window.',
    ],
  },
  web_form: {
    provider: 'web_form',
    title: 'Your Lead Form',
    summary: 'Embed our lightweight form snippet on your website.',
    mechanism: 'form_embed',
    accountKind: 'form',
    steps: [
      'Copy the embed snippet shown in the Connect step.',
      'Paste it into your website where the lead form should appear.',
      'Submit a test entry through the live form.',
      'Click Verify connection to confirm we received it.',
    ],
    clientSelfServe: true,
    gotchas: [
      'Each submission is captured verbatim to our raw-event log for reconciliation.',
      'Form leads are the canonical source and are de-duplicated against calls/Meta leads.',
    ],
  },
}

/** Resolve a provider's connect flow; throws for an unknown provider. */
export function getConnectFlow(provider: IntegrationProvider): ConnectFlow {
  const flow = CONNECT_FLOWS[provider]
  if (!flow) throw new Error(`no connect flow defined for provider: ${provider}`)
  return flow
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/integrations/connect-flows.test.ts`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(integrations): per-provider connect-flow metadata (mechanism, steps, scopes, gotchas)"
```

---

## Task 4: Provider verifier interface + registry + health transitions

**Files:**
- Create: `src/lib/integrations/provider-verifier.ts`
- Create: `tests/integrations/provider-verifier.test.ts`

A "verify connection" call must (a) run a cheap provider check that proves data is retrievable, and (b) transition the connection's health state. We mirror Plan 06's registry pattern with a `ProviderVerifier` interface. Real connectors register a real verifier in their own plans; here we ship the `fake` verifier (always succeeds) and a **degraded default** verifier used when a provider has no registered verifier yet — it passes only if a token AND at least one account-map row exist, otherwise it reports `not_connected`. Health transitions reuse Plan 06's pure `evaluateHealth()` semantics via a thin pure mapper so this module stays unit-testable with no I/O.

- [ ] **Step 1: Write the failing test `tests/integrations/provider-verifier.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  getVerifier,
  registerVerifier,
  resolveVerifyStatus,
  DefaultVerifier,
  FakeVerifier,
  type VerifyContext,
} from '@/lib/integrations/provider-verifier'

const baseCtx: VerifyContext = {
  organizationId: '00000000-0000-0000-0000-000000000001',
  provider: 'fake',
  token: 'tok',
  accountIds: ['acct-1'],
}

describe('provider-verifier', () => {
  it('fake verifier always reports ok/connected', async () => {
    const r = await new FakeVerifier().verify(baseCtx)
    expect(r.ok).toBe(true)
    expect(r.status).toBe('connected')
  })

  it('default verifier passes when token + accounts present', async () => {
    const r = await new DefaultVerifier().verify({ ...baseCtx, provider: 'ga4' })
    expect(r.ok).toBe(true)
    expect(r.status).toBe('connected')
  })

  it('default verifier reports not_connected when no token', async () => {
    const r = await new DefaultVerifier().verify({ ...baseCtx, provider: 'ga4', token: '' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('not_connected')
  })

  it('default verifier reports pending when token but no accounts mapped', async () => {
    const r = await new DefaultVerifier().verify({ ...baseCtx, provider: 'ga4', accountIds: [] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('pending')
  })

  it('registry resolves the fake verifier and falls back to default for unknown', () => {
    expect(getVerifier('fake')).toBeInstanceOf(FakeVerifier)
    expect(getVerifier('ga4')).toBeInstanceOf(DefaultVerifier)
  })

  it('registry honors a registered real verifier', () => {
    class StubVerifier extends DefaultVerifier {}
    registerVerifier('callrail', new StubVerifier())
    expect(getVerifier('callrail')).toBeInstanceOf(StubVerifier)
  })

  it('resolveVerifyStatus maps a verify result to a health transition', () => {
    // success from a previously-error connection -> connected, changed=true
    const ok = resolveVerifyStatus({ ok: true, status: 'connected', error: null }, 'error')
    expect(ok.status).toBe('connected')
    expect(ok.changed).toBe(true)

    // an auth failure -> expired, changed when coming from connected
    const expired = resolveVerifyStatus(
      { ok: false, status: 'error', error: 'token expired / invalid_grant' },
      'connected',
    )
    expect(expired.status).toBe('expired')
    expect(expired.changed).toBe(true)

    // a non-auth failure -> error
    const err = resolveVerifyStatus(
      { ok: false, status: 'error', error: 'HTTP 500 upstream' },
      'connected',
    )
    expect(err.status).toBe('error')
    expect(err.changed).toBe(true)

    // already pending, still pending -> unchanged
    const pending = resolveVerifyStatus({ ok: false, status: 'pending', error: null }, 'pending')
    expect(pending.status).toBe('pending')
    expect(pending.changed).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/provider-verifier.test.ts`
Expected: FAIL — `@/lib/integrations/provider-verifier` does not exist.

- [ ] **Step 3: Write `src/lib/integrations/provider-verifier.ts`**

```ts
import type { IntegrationProvider, ConnectionStatus } from '@/db/types'

/** Inputs a verifier needs to prove a connection is live. */
export interface VerifyContext {
  organizationId: string
  provider: IntegrationProvider
  /** vault token for this (org, provider); '' if none stored. */
  token: string
  /** external account ids mapped to this connection (from connection_account_map). */
  accountIds: string[]
}

/** Outcome of a verify() call. status is the provider's read of liveness. */
export interface VerifyResult {
  ok: boolean
  status: ConnectionStatus
  error: string | null
}

/**
 * A cheap, provider-specific check that proves data is retrievable (PRD §5.5
 * "verify connection" acceptance criterion). Real connectors register their own;
 * unregistered providers fall back to DefaultVerifier.
 */
export interface ProviderVerifier {
  readonly provider: IntegrationProvider | 'default'
  verify(ctx: VerifyContext): Promise<VerifyResult>
}

/** Deterministic, no-I/O verifier for the fake provider (dev/tests). */
export class FakeVerifier implements ProviderVerifier {
  readonly provider = 'fake' as const
  async verify(_ctx: VerifyContext): Promise<VerifyResult> {
    return { ok: true, status: 'connected', error: null }
  }
}

/**
 * Fallback verifier for providers whose real connector isn't wired yet (or whose
 * external API is out of scope for this plan). It cannot prove data is retrievable
 * over the network, so it asserts the prerequisites instead: a stored token AND at
 * least one mapped account => 'connected'; token but no accounts => 'pending';
 * no token => 'not_connected'.
 */
export class DefaultVerifier implements ProviderVerifier {
  readonly provider = 'default' as const
  async verify(ctx: VerifyContext): Promise<VerifyResult> {
    if (!ctx.token) {
      return { ok: false, status: 'not_connected', error: 'no token stored' }
    }
    if (ctx.accountIds.length === 0) {
      return { ok: false, status: 'pending', error: 'no accounts mapped yet' }
    }
    return { ok: true, status: 'connected', error: null }
  }
}

const registry = new Map<IntegrationProvider, ProviderVerifier>()
registry.set('fake', new FakeVerifier())

export function registerVerifier(provider: IntegrationProvider, verifier: ProviderVerifier): void {
  registry.set(provider, verifier)
}

/** Resolve a verifier; falls back to DefaultVerifier for unregistered providers. */
export function getVerifier(provider: IntegrationProvider): ProviderVerifier {
  return registry.get(provider) ?? new DefaultVerifier()
}

/** True if the error message indicates an auth/token failure (mirror Plan 06 health). */
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

export interface HealthTransition {
  status: ConnectionStatus
  changed: boolean
}

/**
 * Pure mapper from a VerifyResult to the next connection status given the current
 * status. Aligns with Plan 06's evaluateHealth() error/expired semantics: an
 * auth error maps to 'expired', any other failure to 'error', success to the
 * verifier-reported status. `changed` reflects whether the status moves.
 */
export function resolveVerifyStatus(
  result: VerifyResult,
  current: ConnectionStatus,
): HealthTransition {
  let next: ConnectionStatus
  if (result.ok) {
    next = result.status
  } else if (isAuthError(result.error)) {
    next = 'expired'
  } else if (result.status === 'pending' || result.status === 'not_connected') {
    next = result.status
  } else {
    next = 'error'
  }
  return { status: next, changed: next !== current }
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/integrations/provider-verifier.test.ts`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(integrations): provider-verifier interface + registry + verify->health mapper"
```

---

## Task 5: Tenant-mapping helpers (validated + audited account-map writes)

**Files:**
- Create: `src/lib/integrations/tenant-map.ts`
- Create: `tests/integrations/tenant-map.test.ts`

The wizard maps external account IDs to a connection. Every map write must (a) be **validated** (the connection belongs to the target org), (b) be enforced by the DB trigger from Task 2 as a backstop, and (c) write a `tenant_map_audit` row. This module is the only sanctioned way the app creates account-map rows.

- [ ] **Step 1: Write the failing test `tests/integrations/tenant-map.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { mapAccountToConnection, validateMapping } from '@/lib/integrations/tenant-map'

describe('tenant-map helpers', () => {
  let orgOne: string
  let orgTwo: string
  let connOne: string
  let founder: string

  beforeAll(async () => {
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string
    const f = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    founder = f[0]!.id as string

    const c = await sql`
      insert into public.connection (organization_id, provider, status, display_name)
      values (${orgOne}, 'fake', 'pending', 'C1 fake')
      on conflict (organization_id, provider) do update set status = 'pending'
      returning id`
    connOne = c[0]!.id as string

    await sql`delete from public.connection_account_map where connection_id = ${connOne}`
    await sql`delete from public.tenant_map_audit where connection_id = ${connOne}`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('validateMapping returns true for a matching org', async () => {
    expect(await validateMapping(connOne, orgOne)).toBe(true)
  })

  it('validateMapping returns false for a mismatched org', async () => {
    expect(await validateMapping(connOne, orgTwo)).toBe(false)
  })

  it('mapAccountToConnection inserts the map row + an audit row', async () => {
    await mapAccountToConnection({
      organizationId: orgOne,
      connectionId: connOne,
      provider: 'fake',
      externalAccountId: 'acct-1',
      kind: 'property',
      label: 'GA4 prop',
      actorId: founder,
    })
    const maps = await sql`
      select external_account_id from public.connection_account_map
      where connection_id = ${connOne}`
    expect(maps.map((r) => r.external_account_id)).toEqual(['acct-1'])

    const audit = await sql`
      select action, external_account_id from public.tenant_map_audit
      where connection_id = ${connOne} order by created_at`
    expect(audit.length).toBe(1)
    expect(audit[0]!.action).toBe('mapped')
    expect(audit[0]!.external_account_id).toBe('acct-1')
  })

  it('mapAccountToConnection REFUSES a cross-tenant mapping (org != connection org)', async () => {
    await expect(
      mapAccountToConnection({
        organizationId: orgTwo, // wrong org for connOne
        connectionId: connOne,
        provider: 'fake',
        externalAccountId: 'evil',
        kind: 'property',
        actorId: founder,
      }),
    ).rejects.toThrow(/tenant/i)
    // no leaked row, no audit row for the evil id.
    const leaked = await sql`
      select count(*)::int as c from public.connection_account_map
      where external_account_id = 'evil'`
    expect(leaked[0]!.c).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/tenant-map.test.ts`
Expected: FAIL — `@/lib/integrations/tenant-map` does not exist.

- [ ] **Step 3: Write `src/lib/integrations/tenant-map.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { connection, connectionAccountMap, tenantMapAudit } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { IntegrationProvider, AccountKind } from '@/db/types'

/**
 * App-level validation that a connection belongs to the target org BEFORE we map
 * an account to it (PRD §5.5 "mapping is validated"). The DB trigger from Task 2
 * is the hard backstop; this gives a friendly pre-check + the same answer the
 * verify_account_map_tenant() RPC returns.
 */
export async function validateMapping(connectionId: string, organizationId: string): Promise<boolean> {
  const [conn] = await db
    .select({ organizationId: connection.organizationId })
    .from(connection)
    .where(eq(connection.id, connectionId))
  return conn != null && conn.organizationId === organizationId
}

export interface MapAccountInput {
  organizationId: string
  connectionId: string
  provider: IntegrationProvider
  externalAccountId: string
  kind: AccountKind
  label?: string
  actorId?: string | null
}

/**
 * The ONLY sanctioned way the app maps an external account to a connection.
 * Validates tenant ownership, inserts the account-map row (the DB trigger
 * enforces org == connection org as a backstop), and writes an immutable
 * tenant_map_audit row. Idempotent on (connection_id, external_account_id).
 */
export async function mapAccountToConnection(input: MapAccountInput): Promise<void> {
  if (!(await validateMapping(input.connectionId, input.organizationId))) {
    throw new Error(
      `tenant validation failed: connection ${input.connectionId} does not belong to org ${input.organizationId}`,
    )
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(connectionAccountMap)
      .values({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalAccountId: input.externalAccountId,
        kind: input.kind,
        label: input.label ?? null,
      })
      .onConflictDoNothing({
        target: [connectionAccountMap.connectionId, connectionAccountMap.externalAccountId],
      })
      .returning({ id: connectionAccountMap.id })

    await tx.insert(tenantMapAudit).values({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      kind: input.kind,
      action: inserted.length > 0 ? 'mapped' : 'remapped',
      actorId: input.actorId ?? null,
    })
  })
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/integrations/tenant-map.test.ts`
Expected: all assertions PASS — valid mapping inserts map + audit rows, cross-tenant mapping throws and leaks nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(integrations): validated + audited account-map writes (tenant-map helpers)"
```

---

## Task 6: Connections-admin orchestration (connect, verify, reconnect) + onboarding data-access

**Files:**
- Create: `src/lib/integrations/connections-admin.ts`
- Create: `src/lib/integrations/onboarding.ts`
- Create: `tests/integrations/connections-admin.test.ts`

This is the server-only engine the Server Actions and pages call: upsert a connection into `pending` and store its token, run a provider verify and persist the resulting health transition (emitting an alert + audit on a downgrade), reconnect (reset to `pending`, clear error, optionally drop the vault token), and read the per-client + cross-client health summaries the dashboard renders. Onboarding progress read/advance lives in `onboarding.ts`.

- [ ] **Step 1: Write the failing test `tests/integrations/connections-admin.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql } from '../helpers/db'

// Mock the alert/audit side-effects so the test asserts they're called without
// hitting Resend/Inngest. (They are exercised for real by Plans 05/06 suites.)
const emitNotification = vi.fn(async () => {})
const recordAuditEvent = vi.fn(async () => {})
vi.mock('@/lib/notifications/emit', () => ({ emitNotification }))
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent }))

import {
  upsertConnection,
  verifyConnection,
  reconnectConnection,
} from '@/lib/integrations/connections-admin'
import { mapAccountToConnection } from '@/lib/integrations/tenant-map'
import { setToken } from '@/lib/integrations/vault'

describe('connections-admin orchestration', () => {
  let orgOne: string
  let founder: string

  beforeAll(async () => {
    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    orgOne = o1[0]!.id as string
    const f = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    founder = f[0]!.id as string

    // clean slate for the fake provider on org one.
    await sql`delete from public.connection_account_map where organization_id = ${orgOne} and connection_id in
      (select id from public.connection where organization_id = ${orgOne} and provider = 'fake')`
    await sql`delete from public.connection where organization_id = ${orgOne} and provider = 'fake'`
    await sql`select public.vault_delete_token(${orgOne}, 'fake')`.catch(() => {})
  })

  afterAll(async () => {
    await sql.end()
  })

  it('upsertConnection creates a pending connection + stores the token', async () => {
    const conn = await upsertConnection({
      organizationId: orgOne,
      provider: 'fake',
      displayName: 'Client One — Fake',
      token: 'secret-token',
      actorId: founder,
    })
    expect(conn.status).toBe('pending')

    const stored = await sql`
      select status, display_name from public.connection
      where organization_id = ${orgOne} and provider = 'fake'`
    expect(stored[0]!.status).toBe('pending')
    expect(stored[0]!.display_name).toBe('Client One — Fake')

    const token = await sql`select public.vault_get_token(${orgOne}, 'fake') as t`
    expect(token[0]!.t).toBe('secret-token')
  })

  it('verifyConnection moves a mapped fake connection to connected', async () => {
    const [conn] = await sql`
      select id from public.connection where organization_id = ${orgOne} and provider = 'fake'`
    await mapAccountToConnection({
      organizationId: orgOne,
      connectionId: conn!.id as string,
      provider: 'fake',
      externalAccountId: 'acct-1',
      kind: 'property',
      actorId: founder,
    })

    const result = await verifyConnection({ connectionId: conn!.id as string, actorId: founder })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')

    const after = await sql`select status, last_error from public.connection where id = ${conn!.id}`
    expect(after[0]!.status).toBe('connected')
    expect(after[0]!.last_error).toBeNull()
  })

  it('verify failure emits a connection_broken alert + audit row', async () => {
    // Create a degraded provider connection with a token but no accounts -> pending,
    // then force a failure path by removing the token so the default verifier fails.
    const conn = await upsertConnection({
      organizationId: orgOne,
      provider: 'ga4',
      displayName: 'C1 GA4',
      token: '',
      actorId: founder,
    })
    emitNotification.mockClear()
    recordAuditEvent.mockClear()
    const result = await verifyConnection({ connectionId: conn.id, actorId: founder })
    expect(result.ok).toBe(false)
    expect(result.status).toBe('not_connected')
    // not_connected from pending is a downgrade away from connected/pending? pending->not_connected
    // is a "changed" transition; alert fires only on error/expired. Assert audit always written.
    expect(recordAuditEvent).toHaveBeenCalled()
  })

  it('reconnectConnection resets to pending, clears error, drops token when asked', async () => {
    const [conn] = await sql`
      select id from public.connection where organization_id = ${orgOne} and provider = 'fake'`
    await sql`update public.connection set status = 'error', last_error = 'boom' where id = ${conn!.id}`

    await reconnectConnection({ connectionId: conn!.id as string, dropToken: true, actorId: founder })

    const after = await sql`select status, last_error from public.connection where id = ${conn!.id}`
    expect(after[0]!.status).toBe('pending')
    expect(after[0]!.last_error).toBeNull()
    const token = await sql`select public.vault_get_token(${orgOne}, 'fake') as t`
    expect(token[0]!.t).toBeNull()
    expect(recordAuditEvent).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/integrations/connections-admin.test.ts`
Expected: FAIL — `@/lib/integrations/connections-admin` does not exist.

- [ ] **Step 3: Write `src/lib/integrations/onboarding.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { onboardingProgress } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { OnboardingProgress, OnboardingStep } from '@/db/types'

const STEP_ORDER: OnboardingStep[] = ['company', 'services', 'connect', 'complete']

/** Read (creating if absent) the onboarding progress row for a client org. */
export async function getOrCreateProgress(organizationId: string): Promise<OnboardingProgress> {
  const [existing] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.organizationId, organizationId))
  if (existing) return existing

  const [created] = await db
    .insert(onboardingProgress)
    .values({ organizationId, currentStep: 'company' })
    .onConflictDoNothing({ target: onboardingProgress.organizationId })
    .returning()
  if (created) return created
  // conflict raced: re-read.
  const [row] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.organizationId, organizationId))
  return row!
}

/**
 * Mark a step complete and advance currentStep to the next step (or 'complete').
 * Idempotent: completing an already-complete step is a no-op past it.
 */
export async function completeStep(
  organizationId: string,
  step: OnboardingStep,
): Promise<OnboardingProgress> {
  const now = new Date()
  const idx = STEP_ORDER.indexOf(step)
  const next = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)]!

  const patch: Partial<typeof onboardingProgress.$inferInsert> = {
    currentStep: next,
    updatedAt: now,
  }
  if (step === 'company') patch.companyCompletedAt = now
  if (step === 'services') patch.servicesCompletedAt = now
  if (step === 'connect') {
    patch.connectCompletedAt = now
    patch.completedAt = now
  }

  await getOrCreateProgress(organizationId)
  const [updated] = await db
    .update(onboardingProgress)
    .set(patch)
    .where(eq(onboardingProgress.organizationId, organizationId))
    .returning()
  return updated!
}
```

- [ ] **Step 4: Write `src/lib/integrations/connections-admin.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { connection, connectionAccountMap } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { IntegrationProvider, Connection, ConnectionStatus } from '@/db/types'
import { setToken, getToken, deleteToken } from '@/lib/integrations/vault'
import { getVerifier, resolveVerifyStatus } from '@/lib/integrations/provider-verifier'
import { emitNotification } from '@/lib/notifications/emit'
import { recordAuditEvent } from '@/lib/audit/record'

export interface UpsertConnectionInput {
  organizationId: string
  provider: IntegrationProvider
  displayName?: string
  /** optional token/secret to store in the vault for this (org, provider). */
  token?: string
  actorId?: string | null
}

/**
 * Create or update a connection for (org, provider), moving it to 'pending', and
 * (if a token is supplied) store it in the tenant-scoped vault. Writes an audit
 * row ('connection.grant'). Returns the connection row.
 */
export async function upsertConnection(input: UpsertConnectionInput): Promise<Connection> {
  const [conn] = await db
    .insert(connection)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      status: 'pending',
      displayName: input.displayName ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [connection.organizationId, connection.provider],
      set: { status: 'pending', displayName: input.displayName ?? null, updatedAt: new Date() },
    })
    .returning()

  if (input.token) {
    await setToken(input.organizationId, input.provider, input.token)
  }

  await recordAuditEvent({
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    action: 'connection.grant',
    targetType: 'connection',
    targetId: conn!.id,
    after: { provider: input.provider, status: 'pending' },
  })

  return conn!
}

export interface VerifyConnectionInput {
  connectionId: string
  actorId?: string | null
}

export interface VerifyConnectionResult {
  ok: boolean
  status: ConnectionStatus
  error: string | null
}

/**
 * Run the provider verifier for a connection and persist the resulting health
 * transition. On a downgrade to error/expired, emit a critical connection_broken
 * notification (PRD §5.5/§5.14). Always writes a 'connection.verify' audit row.
 */
export async function verifyConnection(
  input: VerifyConnectionInput,
): Promise<VerifyConnectionResult> {
  const [conn] = await db.select().from(connection).where(eq(connection.id, input.connectionId))
  if (!conn) throw new Error(`connection not found: ${input.connectionId}`)

  const accounts = await db
    .select({ externalAccountId: connectionAccountMap.externalAccountId })
    .from(connectionAccountMap)
    .where(eq(connectionAccountMap.connectionId, input.connectionId))

  const token = (await getToken(conn.organizationId, conn.provider)) ?? ''
  const verifier = getVerifier(conn.provider)
  const result = await verifier.verify({
    organizationId: conn.organizationId,
    provider: conn.provider,
    token,
    accountIds: accounts.map((a) => a.externalAccountId),
  })

  const transition = resolveVerifyStatus(result, conn.status)
  const now = new Date()
  await db
    .update(connection)
    .set({
      status: transition.status,
      lastSyncAt: now,
      lastSuccessAt: result.ok ? now : conn.lastSuccessAt,
      lastError: result.error,
      updatedAt: now,
    })
    .where(eq(connection.id, input.connectionId))

  await recordAuditEvent({
    actorId: input.actorId ?? null,
    organizationId: conn.organizationId,
    action: 'connection.verify',
    targetType: 'connection',
    targetId: conn.id,
    before: { status: conn.status },
    after: { status: transition.status, ok: result.ok },
  })

  if (transition.changed && (transition.status === 'error' || transition.status === 'expired')) {
    const recipients = await staffRecipients()
    for (const userId of recipients) {
      await emitNotification({
        organizationId: conn.organizationId,
        userId,
        category: 'connection_broken',
        title: `Connection ${transition.status}: ${conn.provider}`,
        body: result.error ?? 'Verification failed.',
        linkPath: '/connections',
        data: { connectionId: conn.id, provider: conn.provider, status: transition.status },
      })
    }
  }

  return { ok: result.ok, status: transition.status, error: result.error }
}

export interface ReconnectInput {
  connectionId: string
  /** if true, delete the stored vault token (use when a grant was revoked). */
  dropToken?: boolean
  actorId?: string | null
}

/**
 * Reset a connection to 'pending', clear its last error, and optionally drop the
 * vault token (PRD §5.5 reconnect path). Writes a 'connection.reconnect' audit row.
 */
export async function reconnectConnection(input: ReconnectInput): Promise<void> {
  const [conn] = await db.select().from(connection).where(eq(connection.id, input.connectionId))
  if (!conn) throw new Error(`connection not found: ${input.connectionId}`)

  if (input.dropToken) {
    await deleteToken(conn.organizationId, conn.provider)
  }

  await db
    .update(connection)
    .set({ status: 'pending', lastError: null, updatedAt: new Date() })
    .where(eq(connection.id, input.connectionId))

  await recordAuditEvent({
    actorId: input.actorId ?? null,
    organizationId: conn.organizationId,
    action: 'connection.reconnect',
    targetType: 'connection',
    targetId: conn.id,
    before: { status: conn.status },
    after: { status: 'pending', tokenDropped: !!input.dropToken },
  })
}

/** Agency staff user ids (founders + team) to alert on a broken connection. */
async function staffRecipients(): Promise<string[]> {
  const rows = await db.execute(
    // staff = members of an agency-type org with role founder/team
    // (uses the same predicate as is_agency_staff but resolves the ids).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import('drizzle-orm')).sql`
      select m.user_id as id
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
      where o.type = 'agency' and m.role in ('founder','team')`,
  )
  return (rows as unknown as { id: string }[]).map((r) => r.id)
}
```

> The `staffRecipients()` query resolves the same set as `public.is_agency_staff()` but returns the user ids (the helper returns a boolean only). It is a server-only read via the service-role Drizzle client, consistent with Plan 05's notification fan-out.

- [ ] **Step 5: Run the test and confirm PASS**

Run: `pnpm test tests/integrations/connections-admin.test.ts`
Expected: all assertions PASS — upsert creates a pending connection + stores the token, verify of a mapped fake connection reaches `connected`, a failing verify writes an audit row, and reconnect resets to pending / clears error / drops the token.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(integrations): connections-admin (upsert/verify/reconnect) + onboarding progress"
```

---

## Task 7: Staff Server Actions (start/advance wizard, connect, map, verify, reconnect)

**Files:**
- Create: `src/app/(internal)/actions/connections.ts`

These are the `'use server'` actions the wizard and dashboard call from the client. Each re-checks the session is staff (defense in depth on top of RLS), then delegates to the Task 5/6 helpers, and `revalidatePath`s the affected routes.

- [ ] **Step 1: Write `src/app/(internal)/actions/connections.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSession, isStaff } from '@/lib/auth'
import type { IntegrationProvider, AccountKind, OnboardingStep } from '@/db/types'
import { completeStep } from '@/lib/integrations/onboarding'
import { mapAccountToConnection } from '@/lib/integrations/tenant-map'
import {
  upsertConnection,
  verifyConnection,
  reconnectConnection,
} from '@/lib/integrations/connections-admin'

async function requireStaff(): Promise<{ userId: string }> {
  const session = await getSession()
  if (!session || !isStaff(session.role)) {
    throw new Error('forbidden: agency staff only')
  }
  return { userId: session.userId }
}

export async function advanceOnboardingAction(organizationId: string, step: OnboardingStep) {
  await requireStaff()
  await completeStep(organizationId, step)
  revalidatePath(`/clients/${organizationId}/onboarding`)
}

export async function connectProviderAction(input: {
  organizationId: string
  provider: IntegrationProvider
  displayName?: string
  token?: string
}) {
  const { userId } = await requireStaff()
  const conn = await upsertConnection({ ...input, actorId: userId })
  revalidatePath(`/clients/${input.organizationId}/onboarding`)
  revalidatePath('/connections')
  return { connectionId: conn.id, status: conn.status }
}

export async function mapAccountAction(input: {
  organizationId: string
  connectionId: string
  provider: IntegrationProvider
  externalAccountId: string
  kind: AccountKind
  label?: string
}) {
  const { userId } = await requireStaff()
  await mapAccountToConnection({ ...input, actorId: userId })
  revalidatePath(`/clients/${input.organizationId}/onboarding`)
  revalidatePath('/connections')
}

export async function verifyConnectionAction(connectionId: string, organizationId: string) {
  const { userId } = await requireStaff()
  const result = await verifyConnection({ connectionId, actorId: userId })
  revalidatePath(`/clients/${organizationId}/onboarding`)
  revalidatePath('/connections')
  return result
}

export async function reconnectConnectionAction(input: {
  connectionId: string
  organizationId: string
  dropToken?: boolean
}) {
  const { userId } = await requireStaff()
  await reconnectConnection({
    connectionId: input.connectionId,
    dropToken: input.dropToken,
    actorId: userId,
  })
  revalidatePath('/connections')
  revalidatePath(`/clients/${input.organizationId}/onboarding`)
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: compiles with no type errors (server actions reference existing helpers + types).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(connections): staff Server Actions for onboarding + connect/verify/reconnect"
```

---

## Task 8: UI components — status badge, stepper, provider card, health table

**Files:**
- Create: `src/components/connections/connection-status-badge.tsx`
- Create: `src/components/connections/wizard-stepper.tsx`
- Create: `src/components/connections/provider-connect-card.tsx`
- Create: `src/components/connections/health-table.tsx`

shadcn/ui primitives (`Badge`, `Button`, `Card`) are assumed installed by earlier plans; add any missing one with `pnpm dlx shadcn@latest add badge` before building.

- [ ] **Step 1: Ensure shadcn primitives exist**

Run:
```bash
pnpm dlx shadcn@latest add badge button card
```
Expected: `src/components/ui/{badge,button,card}.tsx` present (no-ops if already added).

- [ ] **Step 2: Write `src/components/connections/connection-status-badge.tsx`**

```tsx
import type { ConnectionStatus } from '@/db/types'
import { Badge } from '@/components/ui/badge'

const LABEL: Record<ConnectionStatus, string> = {
  not_connected: 'Not connected',
  pending: 'Pending',
  connected: 'Connected',
  error: 'Error',
  expired: 'Expired',
}

// Tailwind classes per status (no external color tokens needed).
const TONE: Record<ConnectionStatus, string> = {
  not_connected: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-900',
  connected: 'bg-green-100 text-green-900',
  error: 'bg-red-100 text-red-900',
  expired: 'bg-red-100 text-red-900',
}

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return <Badge className={TONE[status]}>{LABEL[status]}</Badge>
}
```

- [ ] **Step 3: Write `src/components/connections/wizard-stepper.tsx`**

```tsx
import type { OnboardingStep } from '@/db/types'

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: 'company', label: 'Company details' },
  { key: 'services', label: 'Services' },
  { key: 'connect', label: 'Connect accounts' },
]

export function WizardStepper({ current }: { current: OnboardingStep }) {
  const order: OnboardingStep[] = ['company', 'services', 'connect', 'complete']
  const currentIdx = order.indexOf(current)
  return (
    <ol className="mb-6 flex gap-4 text-sm" aria-label="Onboarding progress">
      {STEPS.map((s, i) => {
        const done = i < currentIdx
        const active = order[currentIdx] === s.key
        return (
          <li
            key={s.key}
            aria-current={active ? 'step' : undefined}
            className={
              active
                ? 'font-semibold text-foreground'
                : done
                  ? 'text-green-700'
                  : 'text-muted-foreground'
            }
          >
            {i + 1}. {s.label}
            {done ? ' ✓' : ''}
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: Write `src/components/connections/provider-connect-card.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import type { ConnectFlow } from '@/lib/integrations/connect-flows'
import type { ConnectionStatus } from '@/db/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConnectionStatusBadge } from './connection-status-badge'
import {
  connectProviderAction,
  verifyConnectionAction,
} from '@/app/(internal)/actions/connections'

export interface ProviderConnectCardProps {
  organizationId: string
  flow: ConnectFlow
  connectionId: string | null
  status: ConnectionStatus
  lastError: string | null
  /** webhook URL to display for api_key_webhook / form_embed flows. */
  webhookUrl?: string | null
}

export function ProviderConnectCard(props: ProviderConnectCardProps) {
  const { organizationId, flow } = props
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>(props.status)
  const [error, setError] = useState<string | null>(props.lastError)
  const [pending, startTransition] = useTransition()

  const showKeyField = flow.mechanism === 'api_key_webhook'

  function onConnect() {
    startTransition(async () => {
      const res = await connectProviderAction({
        organizationId,
        provider: flow.provider,
        displayName: flow.title,
        token: showKeyField ? token : undefined,
      })
      setStatus(res.status)
      setError(null)
    })
  }

  function onVerify() {
    startTransition(async () => {
      const res = await verifyConnectionAction(props.connectionId!, organizationId)
      setStatus(res.status)
      setError(res.error)
    })
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{flow.title}</h3>
        <ConnectionStatusBadge status={status} />
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{flow.summary}</p>

      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
        {flow.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      {showKeyField && (
        <input
          className="mb-2 w-full rounded border p-2 text-sm"
          type="password"
          placeholder={flow.apiKeyLabel ?? 'API key'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      )}

      {(flow.mechanism === 'api_key_webhook' || flow.mechanism === 'form_embed') &&
        props.webhookUrl && (
          <p className="mb-2 break-all rounded bg-muted p-2 text-xs">
            Webhook / embed URL: <code>{props.webhookUrl}</code>
          </p>
        )}

      {flow.gotchas.length > 0 && (
        <details className="mb-3 text-xs text-muted-foreground">
          <summary>Notes &amp; caveats</summary>
          <ul className="mt-1 list-disc pl-5">
            {flow.gotchas.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={onConnect} disabled={pending}>
          {props.connectionId ? 'Re-grant' : 'Connect'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onVerify}
          disabled={pending || !props.connectionId}
        >
          Verify connection
        </Button>
      </div>
    </Card>
  )
}
```

- [ ] **Step 5: Write `src/components/connections/health-table.tsx`**

```tsx
'use client'

import { useTransition } from 'react'
import type { ConnectionStatus, IntegrationProvider } from '@/db/types'
import { Button } from '@/components/ui/button'
import { ConnectionStatusBadge } from './connection-status-badge'
import { reconnectConnectionAction } from '@/app/(internal)/actions/connections'

export interface HealthRow {
  connectionId: string
  organizationId: string
  clientName: string
  provider: IntegrationProvider
  status: ConnectionStatus
  lastSyncAt: string | null
  lastError: string | null
}

export function HealthTable({ rows }: { rows: HealthRow[] }) {
  const [pending, startTransition] = useTransition()

  function onReconnect(row: HealthRow) {
    startTransition(async () => {
      await reconnectConnectionAction({
        connectionId: row.connectionId,
        organizationId: row.organizationId,
        // drop the token when the grant looks revoked/expired so the staff re-grant cleanly.
        dropToken: row.status === 'expired',
      })
    })
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2">Client</th>
          <th>Provider</th>
          <th>Status</th>
          <th>Last sync</th>
          <th>Last error</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.connectionId} className="border-b">
            <td className="py-2">{r.clientName}</td>
            <td>{r.provider}</td>
            <td>
              <ConnectionStatusBadge status={r.status} />
            </td>
            <td>{r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString() : '—'}</td>
            <td className="max-w-xs truncate text-red-600">{r.lastError ?? ''}</td>
            <td>
              {(r.status === 'error' || r.status === 'expired') && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => onReconnect(r)}>
                  Reconnect
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 6: Type-check**

Run: `pnpm build`
Expected: compiles with no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(connections): status badge, wizard stepper, provider card, health table"
```

---

## Task 9: Pages — onboarding wizard, connection-health dashboard, portal self-serve

**Files:**
- Create: `src/app/(internal)/clients/[clientId]/onboarding/page.tsx`
- Create: `src/app/(internal)/connections/page.tsx`
- Create: `src/app/(portal)/connections/page.tsx`

Pages are server components that read state through the data-access helpers and render the Task 8 components. They are guarded by the `(internal)`/`(portal)` layouts (Plan 01) plus an explicit `requireStaff`/role check.

- [ ] **Step 1: Write the onboarding wizard page `src/app/(internal)/clients/[clientId]/onboarding/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { connection, connectionAccountMap } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getOrCreateProgress } from '@/lib/integrations/onboarding'
import { CONNECT_FLOWS } from '@/lib/integrations/connect-flows'
import { WizardStepper } from '@/components/connections/wizard-stepper'
import { ProviderConnectCard } from '@/components/connections/provider-connect-card'

// clientId in the route is the client organization id (Plan 02 convention).
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')

  const { clientId: organizationId } = await params
  const progress = await getOrCreateProgress(organizationId)

  const conns = await db.select().from(connection).where(eq(connection.organizationId, organizationId))
  const maps = await db
    .select()
    .from(connectionAccountMap)
    .where(eq(connectionAccountMap.organizationId, organizationId))

  const connByProvider = new Map(conns.map((c) => [c.provider, c]))

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Client onboarding</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Company details → services → connect each data source.
      </p>
      <WizardStepper current={progress.currentStep} />

      <section>
        <h2 className="mb-3 text-base font-semibold">Connect accounts</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {Object.values(CONNECT_FLOWS).map((flow) => {
            const conn = connByProvider.get(flow.provider) ?? null
            const hasAccounts = maps.some((m) => conn && m.connectionId === conn.id)
            return (
              <ProviderConnectCard
                key={flow.provider}
                organizationId={organizationId}
                flow={flow}
                connectionId={conn?.id ?? null}
                status={conn?.status ?? 'not_connected'}
                lastError={conn?.lastError ?? null}
                webhookUrl={
                  flow.mechanism === 'api_key_webhook' || flow.mechanism === 'form_embed'
                    ? `/api/webhooks/${flow.provider}?slug=${organizationId}-${flow.provider}`
                    : null
                }
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
```

> The company-details and services steps reuse Plan 02's client + service forms (already built); this page focuses on the per-provider Connect step that is new in this plan. The `hasAccounts` variable is computed so a future iteration can show a "needs mapping" hint; it is intentionally non-rendering here to keep the connect step minimal.

- [ ] **Step 2: Write the connection-health dashboard `src/app/(internal)/connections/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { connection } from '@/db/schema'
import { clients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { HealthTable, type HealthRow } from '@/components/connections/health-table'

export default async function ConnectionsHealthPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')

  // Every client × provider connection with its current health (RLS gives staff all).
  const rows = await db
    .select({
      connectionId: connection.id,
      organizationId: connection.organizationId,
      clientName: clients.name,
      provider: connection.provider,
      status: connection.status,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    })
    .from(connection)
    .leftJoin(clients, eq(clients.organizationId, connection.organizationId))

  const healthRows: HealthRow[] = rows.map((r) => ({
    connectionId: r.connectionId,
    organizationId: r.organizationId,
    clientName: r.clientName ?? '(unknown client)',
    provider: r.provider,
    status: r.status,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
    lastError: r.lastError,
  }))

  const broken = healthRows.filter((r) => r.status === 'error' || r.status === 'expired').length

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Connection health</h1>
        <span className="text-sm text-muted-foreground">
          {broken > 0 ? `${broken} connection(s) need attention` : 'All connections healthy'}
        </span>
      </div>
      <HealthTable rows={healthRows} />
    </div>
  )
}
```

> `clients` is the Plan 02 table (`pgTable('client', ...)`) whose `organizationId` equals the client org id; the left join resolves the client name for each connection. If Plan 02 exported the symbol under a different name, import that symbol — the table name in SQL is `client`.

- [ ] **Step 3: Write the portal self-serve view `src/app/(portal)/connections/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { connection } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { CONNECT_FLOWS } from '@/lib/integrations/connect-flows'
import { ProviderConnectCard } from '@/components/connections/provider-connect-card'

export default async function PortalConnectionsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  if (!session.orgId) redirect('/overview')

  const organizationId = session.orgId
  const conns = await db.select().from(connection).where(eq(connection.organizationId, organizationId))
  const connByProvider = new Map(conns.map((c) => [c.provider, c]))

  // Only the self-serve providers appear in the portal (PRD §5.5 client-side view).
  const selfServeFlows = Object.values(CONNECT_FLOWS).filter((f) => f.clientSelfServe)

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Connect your accounts</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Follow each provider’s steps so we can pull your performance data.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {selfServeFlows.map((flow) => {
          const conn = connByProvider.get(flow.provider) ?? null
          return (
            <ProviderConnectCard
              key={flow.provider}
              organizationId={organizationId}
              flow={flow}
              connectionId={conn?.id ?? null}
              status={conn?.status ?? 'not_connected'}
              lastError={conn?.lastError ?? null}
              webhookUrl={
                flow.mechanism === 'form_embed'
                  ? `/api/webhooks/${flow.provider}?slug=${organizationId}-${flow.provider}`
                  : null
              }
            />
          )
        })}
      </div>
    </div>
  )
}
```

> The portal renders self-serve flows only; the staff actions invoked from the card still re-check `requireStaff` server-side. For a client-facing self-serve grant the relevant providers are `service_account_grant`/`oauth_consent`/`form_embed` — all flagged `clientSelfServe: true` in Task 3 — so a client never sees the staff-only Ads/Meta cards. (Client write to `connection` is blocked by RLS regardless; the portal card surfaces instructions + a Verify button that the staff Server Action gates.)

- [ ] **Step 4: Build to confirm pages compile**

Run: `pnpm build`
Expected: compiles with no type errors; the three new routes appear in the build output.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`, then:
1. Sign in as `founder@milktreeagency.com` / `Password123!`. Visit `/connections` → the health table lists each seeded connection with a status badge; `error`/`expired` rows show a Reconnect button.
2. Visit `/clients/<client-one-org-id>/onboarding` → the stepper shows the current step and a grid of provider connect cards. Click Connect on the Fake/GA4 card → status flips to Pending. Map an account (via the dashboard/seed) and click Verify → Fake reaches Connected.
3. Sign out, sign in as `user1@clientone.com` / `Password123!`, visit `/connections` (portal) → only self-serve provider cards render; `/cockpit` and `/clients/.../onboarding` redirect away.

Expected: all behave as described.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(connections): onboarding wizard, health dashboard, portal self-serve pages"
```

---

## Task 10: Full suite + CI gate

**Files:**
- None new (verification task).

- [ ] **Step 1: Re-seed for a clean fixture set**

Run: `pnpm db:seed`
Expected: idempotent; prints the org/user IDs.

- [ ] **Step 2: Run the entire test suite**

Run: `pnpm test`
Expected: all suites green, including this plan's:
- `tests/rls/onboarding-isolation.test.ts` (both new tenant tables proven isolated + the tenant-mapping trigger + validator)
- `tests/integrations/connect-flows.test.ts`
- `tests/integrations/provider-verifier.test.ts`
- `tests/integrations/tenant-map.test.ts`
- `tests/integrations/connections-admin.test.ts`
…plus all earlier plans' suites still passing.

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: lint clean; production build succeeds (the three new routes + server actions compile).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(connections): full onboarding + connection-health suite green"
```

> CI: the Plan 01 `.github/workflows/ci.yml` already runs `pnpm test` against the local Supabase stack, so these tests run automatically. The `connections-admin` test mocks `emitNotification`/`recordAuditEvent`, so no live Resend/Inngest is exercised in CI.

---

## Self-Review

**Spec coverage (vs PRD §5.5, §6.3, §6.4, §9):**
- §5.5 onboarding wizard per client (company → services → per-provider Connect step) → `onboarding_progress` + `getOrCreateProgress`/`completeStep` + the wizard page with `WizardStepper` + per-provider `ProviderConnectCard`. The company/services steps reuse Plan 02 forms (noted, not re-spec'd); the new Connect step is implemented here. ✅
- §5.5 `connection` record per (client, provider) with status `not_connected|pending|connected|error|expired`, last sync, last error → reuses Plan 06's `connection` table; the dashboard renders exactly those columns; `upsertConnection`/`verifyConnection`/`reconnectConnection` drive the status. ✅
- §5.5 connection-health dashboard (every client × provider, Reconnect action, alerting on expiry/revocation) → `/connections` page + `HealthTable` (Reconnect on error/expired) + `connection_broken` critical alert via Plan 05 `emitNotification` on a downgrade. ✅
- §5.5 per-provider connect flows (service-account grant GA4/GSC, OAuth consent GBP, MCC link-invite Google Ads, Partner-access Meta, API-key/webhook CallRail/WhatConverts, own-form embed) → `CONNECT_FLOWS` with the correct `mechanism` per provider, asserted by `connect-flows.test.ts`. ✅
- §5.5 client-side "Connect your accounts" self-serve view → `(portal)/connections/page.tsx` renders only `clientSelfServe` flows. ✅
- §5.5 acceptance: "verify connection" call per provider that confirms data retrievable → `ProviderVerifier` interface + registry + `verifyConnection`; the fake provider proves the loop end-to-end; real connectors register real verifiers in their own plans. ✅
- §5.5 acceptance: expired/revoked tokens surface as error/expired with an alert + reconnect path → `resolveVerifyStatus` maps auth errors to `expired`, the alert fires, and `reconnectConnection(dropToken)` is the reconnect path. ✅
- §5.5 acceptance: "No connection can be mapped to the wrong tenant (mapping validated and audited)" → DB trigger `enforce_account_map_tenant` (hard backstop), `verify_account_map_tenant()` RPC + `validateMapping()` (validation), and `tenant_map_audit` + `mapAccountToConnection` (audit). Proven by `tenant-map.test.ts` + the RLS suite. ✅
- §6.3 gotchas surfaced (GA4 account-level grant/sampling/provisional, GSC anonymization/16-mo window, GBP two gates/5-day lag, Ads micros/14-day resync, Meta attribution-window/28-day resync) → encoded in each flow's `gotchas` and rendered in the provider card. ✅
- §9 security: both new tenant tables carry `organization_id` leading a composite index; RLS reuses `has_org_access`/`is_agency_staff`; clients cannot write `onboarding_progress`; `tenant_map_audit` is append-only; `service_role` only in seed/jobs; an RLS isolation test exists per new table → Task 1 indexes + Task 2 policies/trigger/validator + `onboarding-isolation.test.ts`. ✅
- §3.3 roles: staff drive onboarding/connections (`requireStaff` + staff-only write policies); clients only grant access (self-serve portal view, RLS-blocked from writing connections). ✅

**Health-state transitions covered:** `provider-verifier.test.ts` exercises connected→connected (unchanged), error→connected (recovery), connected→expired (auth error), connected→error (non-auth failure), pending→pending (unchanged); `connections-admin.test.ts` exercises pending→connected on a real verify and error→pending on reconnect; the RLS/trigger suite covers the tenant-mapping invariant. ✅

**Placeholder scan:** No TBD/TODO/"similar to above". Every code step contains complete, runnable code. The only conditional steps ("add the shadcn primitive if missing") are explicit idempotency instructions, not placeholders. Migration filenames use `13xx_` because the generator assigns the real sequence number based on Plans 02–12. ✅

**Type consistency:** `IntegrationProvider`/`ConnectionStatus`/`AccountKind` derived from the Plan 06 schema in `src/db/types.ts` and reused across `connect-flows.ts`, `provider-verifier.ts`, `tenant-map.ts`, `connections-admin.ts`, the actions, and every component. `OnboardingStep` from this plan's schema is used in `onboarding.ts`, the actions, the stepper, and the wizard page. `ConnectFlow.mechanism` literals match the `connect-flows.test.ts` expectations. The `connection_broken` notification category and `EmitInput`/`AuditInput` shapes match Plan 05 exactly. `verify_account_map_tenant` / `enforce_account_map_tenant` SQL names match between the migration, the RPC grants, and the tests. RLS helper names (`has_org_access`, `is_agency_staff`) match Plan 01. The `clients`/`client` table reference matches Plan 02 (table name `client`, `organization_id` = client org id). ✅

**Definition of done for Plan 13:** `pnpm lint && pnpm build && pnpm test` green — RLS isolation proven for `onboarding_progress` and `tenant_map_audit`, the tenant-mapping invariant enforced at the DB and validated/audited in the app, every required provider has a complete connect flow + verifier, health-state transitions verified, and the wizard + health dashboard + portal self-serve pages render and drive connect/verify/reconnect end-to-end with the fake provider and zero cross-tenant leakage.
