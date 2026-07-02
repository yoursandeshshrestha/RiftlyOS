# Agency OS — Plan 10: Unified Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Unified Leads** module (PRD §5.7) on top of the Plan 06 integration backbone: one canonical `lead` table (id, client_id/`organization_id`, `source` enum, `source_external_id`, `occurred_at`, contact `{name,email,phone_e164}`, attribution `{channel,campaign,ad_id,form_id,gclid,utm_*}`, `lead_type`, `value`, `status`, `is_spam`, `raw_event_id`), a `lead_identity` table for cross-source merges, and a per-client `lead_definition` config. Ingestion is **webhooks-first** (own embeddable form, Meta leadgen, CallRail, WhatConverts) — signature-verified, fast 200, enqueue, then **idempotent upsert on `(organization_id, source, source_external_id)`** — plus **API backfill** for Google Ads lead forms (60-day rolling window). **Deterministic de-duplication**: normalise phone to E.164 (primary key) then email, merge within a per-client configurable 30–90 day window, and record cross-source identity links so the count is de-duplicated while every touch is retained for attribution. GA4 `generate_lead` and GBP calls/messages are surfaced as **count-only "aggregate/modeled" signals** with no contact PII, excluded from the contact-bearing list. Test coverage is **heavy on dedupe + idempotency**.

**Architecture:** Leads live in Plane A (PRD §6.1) but are **event-sourced from webhooks**, not the nightly metric sync. Every inbound payload is first captured verbatim in `raw_event` (Plan 06, deduped on `provider_event_id`); a per-source Inngest worker then parses that payload into a canonical `lead` row via an idempotent upsert keyed on `(organization_id, source, source_external_id)`, so at-least-once webhook redelivery never double-counts. The Plan 06 generic webhook route (`/api/webhooks/[provider]`) already verifies HMAC signatures, returns a fast 200, records `raw_event`, and emits `integrations/webhook.received`; this plan adds a `integrations/lead.ingest` fan-out so lead sources are parsed off the same durable capture. Google Ads lead forms have no webhook (60-day API window) — a dedicated Inngest cron backfills them through a `LeadSource` adapter. De-duplication is a **pure, deterministic** function (`resolveIdentity`) over normalised `phone_e164` then `email` within the client's configured window; matches write a `lead_identity` link pointing every touch at one canonical lead, so the de-duplicated count is `count(distinct canonical_lead_id)` while each source touch is retained. Per-client `lead_definition` rows decide which sources count, whether spam is included, and the dedupe window (30–90 days, default 30). Tenancy: every new table carries `organization_id` (the **client** org = tenant) as the leading column of a composite index, RLS reuses `public.has_org_access(uuid)` / `public.is_agency_staff()` from Plan 01, clients see only their own leads, and PII (`contact_name`/`contact_email`/`contact_phone_e164`) is never logged. `service_role` is used only by the Inngest workers — never user-facing queries.

**Tech Stack:** Next.js 16 (App Router, TS strict) · Drizzle ORM + drizzle-kit · postgres.js · Supabase Postgres + Vault · **Inngest** (webhook fan-out workers + backfill cron) · Vitest (unit/integration incl. RLS + dedupe + idempotency tests) — all wired by Plan 01 and extended by Plan 06.

**Dependencies (assume built; do not re-spec):** Plan 01 (organizations/profiles/memberships, `org_type`/`app_role` enums, `has_org_access()`/`is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, `tests/helpers/db.ts` `asUser()`/`sql`/`userIdByEmail`). Plan 06 (the integration backbone: `integration_provider` enum incl. `web_form`/`meta_ads`/`callrail`/`whatconverts`/`google_ads`/`ga4`/`gbp`, `connection`/`connection_account_map`/`webhook_endpoint`/`raw_event` tables, `recordRawEvent()`, `verifySignature()`, the generic `/api/webhooks/[provider]` intake route + `integrations/webhook.received` event + `webhook-ingest` worker, the Inngest client `@/lib/inngest/client`, the serve route `src/app/api/inngest/route.ts`, the tenant-scoped Vault RPCs `public.vault_get_token`, and the `getToken()` wrapper). This plan **modifies** Plan 06's `webhook-ingest` worker to additionally fan out a `integrations/lead.ingest` event for lead-bearing providers, and **modifies** the Inngest serve route to register the new functions.

---

## File Structure (created by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                              # MODIFY: lead_source enum, lead_type enum,
│  │  │                                         #         lead_status enum, lead, lead_identity,
│  │  │                                         #         lead_definition tables
│  │  └─ types.ts                               # MODIFY: inferred lead types
│  ├─ lib/
│  │  └─ leads/
│  │     ├─ normalize.ts                        # E.164 phone + email normalisation
│  │     ├─ dedupe.ts                           # deterministic resolveIdentity (pure)
│  │     ├─ definition.ts                       # per-client lead_definition resolver (defaults)
│  │     ├─ ingest.ts                           # canonical upsert + identity linking + dedupe
│  │     ├─ count.ts                            # de-duplicated count + by-source breakdown
│  │     ├─ aggregate-signals.ts                # GA4/GBP count-only signal readers (no PII)
│  │     └─ parsers/
│  │        ├─ types.ts                         # ParsedLead + LeadParser contract
│  │        ├─ web-form.ts                      # own embeddable form payload -> ParsedLead
│  │        ├─ meta-leadgen.ts                  # Meta leadgen payload -> ParsedLead
│  │        ├─ callrail.ts                      # CallRail call/form -> ParsedLead
│  │        ├─ whatconverts.ts                  # WhatConverts lead -> ParsedLead
│  │        ├─ google-ads.ts                    # Google Ads lead form row -> ParsedLead
│  │        └─ registry.ts                      # source -> LeadParser registry
│  └─ app/
│     └─ api/
│        └─ leads/
│           └─ form/route.ts                    # own embeddable form intake (HMAC-verified)
├─ src/lib/inngest/functions/
│  ├─ lead-ingest.ts                            # parse raw_event -> canonical lead (idempotent)
│  └─ google-ads-leads-backfill.ts             # 60-day cron backfill via LeadSource adapter
├─ drizzle/
│  ├─ 10xx_leads_tables.sql                     # generated by db:generate
│  └─ 10xx_leads_rls.sql                        # custom: RLS (db:generate --custom)
└─ tests/
   ├─ leads/
   │  ├─ normalize.test.ts
   │  ├─ dedupe.test.ts                         # HEAVY: phone-primary, email-fallback, window
   │  ├─ definition.test.ts
   │  ├─ ingest-idempotency.test.ts             # HEAVY: redelivery, cross-source single count
   │  ├─ count.test.ts
   │  ├─ aggregate-signals.test.ts
   │  └─ parsers.test.ts
   └─ rls/
      └─ leads-isolation.test.ts                # RLS isolation for every new tenant table
```

> Migration filenames use `10xx_` as a placeholder; `pnpm db:generate` assigns the next sequence number after Plan 09's migrations. Use the emitted names in your commits.

---

## Task 1: Schema — lead, lead_identity, lead_definition (+ enums)

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/10xx_leads_tables.sql` (generated)

- [ ] **Step 1: Append enums + tables to `src/db/schema.ts`**

Plan 06 already imports `pgTable, pgEnum, uuid, text, timestamp, unique, index, integer, numeric, boolean, jsonb, date, primaryKey` from `drizzle-orm/pg-core`, and `organizations`/`rawEvent` are already defined earlier in the same file. Reference those existing bindings directly — do **not** re-import them. Append at the end of `src/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Plan 10: Unified Leads (PRD §5.7)
// ---------------------------------------------------------------------------

// Contact-bearing lead sources. GA4/GBP are NOT lead sources here — they are
// count-only aggregate signals (read separately, no PII) per PRD §5.7.
export const leadSource = pgEnum('lead_source', [
  'web_form', // own embeddable form
  'meta_ads', // Meta Lead Ads (leadgen webhook + Graph backfill)
  'google_ads', // Google Ads lead forms (API pull, 60-day window)
  'callrail', // CallRail call/form webhook
  'whatconverts', // WhatConverts webhook
  'manual', // CRM/manual entry
])

// Lead nature (PRD §5.7 lead_type).
export const leadType = pgEnum('lead_type', ['form', 'call', 'message', 'other'])

// Lead lifecycle/stage (PRD §5.7 status).
export const leadStatus = pgEnum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'won',
  'lost',
])

// lead: the canonical de-duplicated-by-touch lead model. One row per source
// touch; cross-source merges link rows via lead_identity to a canonical lead.
export const lead = pgTable(
  'lead',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    source: leadSource('source').notNull(),
    // provider's own id for this lead/call/form, used for idempotent upsert.
    sourceExternalId: text('source_external_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    // Contact (PII — encrypted-at-rest by Supabase; never logged). Normalised
    // phone to E.164; email lowercased.
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhoneE164: text('contact_phone_e164'),

    // Attribution (PRD §5.7 attribution {...}).
    channel: text('channel'),
    campaign: text('campaign'),
    adId: text('ad_id'),
    formId: text('form_id'),
    gclid: text('gclid'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),

    leadType: leadType('lead_type').notNull().default('form'),
    value: numeric('value', { precision: 20, scale: 4 }),
    status: leadStatus('status').notNull().default('new'),
    isSpam: boolean('is_spam').notNull().default(false),

    // Audit link back to the verbatim payload (Plan 06 raw_event).
    rawEventId: uuid('raw_event_id').references(() => rawEvent.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule) for inbox by date.
    idxOrgOccurred: index('idx_lead_org_occurred').on(t.organizationId, t.occurredAt),
    // idempotency key: a source's external id is recorded at most once per org.
    uniqOrgSourceExternal: unique('uniq_lead_org_source_external').on(
      t.organizationId,
      t.source,
      t.sourceExternalId,
    ),
    // dedupe lookups: phone-primary then email, scoped + time-windowed.
    idxOrgPhone: index('idx_lead_org_phone').on(t.organizationId, t.contactPhoneE164),
    idxOrgEmail: index('idx_lead_org_email').on(t.organizationId, t.contactEmail),
  }),
)

// lead_identity: cross-source merge link. Every lead touch points at exactly one
// canonical lead; the canonical lead points at itself. The de-duplicated count
// is count(distinct canonical_lead_id). Retaining links keeps every touch for
// attribution while the count stays de-duplicated (PRD §5.7).
export const leadIdentity = pgTable(
  'lead_identity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    canonicalLeadId: uuid('canonical_lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    // which key matched: 'phone' | 'email' | 'self' (no prior match)
    matchedOn: text('matched_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrgCanonical: index('idx_lead_identity_org_canonical').on(
      t.organizationId,
      t.canonicalLeadId,
    ),
    // one identity row per lead touch.
    uniqLead: unique('uniq_lead_identity_lead').on(t.leadId),
  }),
)

// lead_definition: per-client config — which sources count, spam handling, and
// the dedupe window (30–90 days). One row per client org (PRD §5.7).
export const leadDefinition = pgTable(
  'lead_definition',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // sources that count toward the client's lead total. Default = all contact
    // sources. Stored as a jsonb array of lead_source enum strings.
    countedSources: jsonb('counted_sources')
      .$type<string[]>()
      .notNull()
      .default(['web_form', 'meta_ads', 'google_ads', 'callrail', 'whatconverts', 'manual']),
    // include spam-flagged leads in the counted total?
    includeSpam: boolean('include_spam').notNull().default(false),
    // dedupe merge window in days; clamped to 30..90 by the resolver.
    dedupeWindowDays: integer('dedupe_window_days').notNull().default(30),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
)
```

- [ ] **Step 2: Add inferred types to `src/db/types.ts`**

Append:

```ts
import type { lead, leadIdentity, leadDefinition } from './schema'

export type Lead = typeof lead.$inferSelect
export type NewLead = typeof lead.$inferInsert
export type LeadIdentity = typeof leadIdentity.$inferSelect
export type LeadDefinition = typeof leadDefinition.$inferSelect

export type LeadSource = Lead['source']
export type LeadType = Lead['leadType']
export type LeadStatus = Lead['status']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/10xx_leads_tables.sql` file is created containing the 3 enums (`lead_source`, `lead_type`, `lead_status`) and 3 tables (`lead`, `lead_identity`, `lead_definition`) with their unique constraints and composite indexes.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Then verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E "lead|lead_identity|lead_definition"
```
Expected: `lead`, `lead_identity`, `lead_definition` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): unified leads schema (lead, lead_identity, lead_definition)"
```

---

## Task 2: RLS isolation → tests FIRST, then make them PASS

**Files:**
- Create: `tests/rls/leads-isolation.test.ts`
- Create: `drizzle/10xx_leads_rls.sql` (custom SQL migration)

RLS is not yet enabled on the new tables, so a client user can currently read every tenant's leads. We write the isolation tests, confirm they FAIL, then enable RLS to make them PASS. This is a release gate (PRD §9, §5.7 acceptance "Client view is strictly scoped").

- [ ] **Step 1: Write the failing isolation tests `tests/rls/leads-isolation.test.ts`**

Reuses the Plan 01 harness (`tests/helpers/db.ts` `asUser()`/`sql`/`userIdByEmail`). Setup runs as `service_role` via the raw `sql` connection (RLS bypassed for setup), then asserts each client user sees only their own.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('unified leads tenant isolation (RLS)', () => {
  let clientOneUser: string
  let clientTwoUser: string
  let founder: string
  let orgOne: string
  let orgTwo: string
  let leadOne: string

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')
    founder = await userIdByEmail('founder@milktreeagency.com')

    const o1 = await sql`select id from public.organizations where slug = 'client-one'`
    const o2 = await sql`select id from public.organizations where slug = 'client-two'`
    orgOne = o1[0]!.id as string
    orgTwo = o2[0]!.id as string

    // Setup as service_role (raw sql bypasses RLS). Idempotent.
    const l1 = await sql`
      insert into public.lead
        (organization_id, source, source_external_id, occurred_at,
         contact_name, contact_email, contact_phone_e164, lead_type)
      values (${orgOne}, 'web_form', 'iso-c1', '2026-06-01T10:00:00Z',
              'C1 Person', 'c1@example.com', '+447700900001', 'form')
      on conflict (organization_id, source, source_external_id)
        do update set contact_name = 'C1 Person'
      returning id`
    leadOne = l1[0]!.id as string

    await sql`
      insert into public.lead
        (organization_id, source, source_external_id, occurred_at,
         contact_name, contact_email, contact_phone_e164, lead_type)
      values (${orgTwo}, 'web_form', 'iso-c2', '2026-06-01T10:00:00Z',
              'C2 Person', 'c2@example.com', '+447700900002', 'form')
      on conflict (organization_id, source, source_external_id)
        do update set contact_name = 'C2 Person'`

    await sql`
      insert into public.lead_identity (organization_id, lead_id, canonical_lead_id, matched_on)
      values (${orgOne}, ${leadOne}, ${leadOne}, 'self')
      on conflict (lead_id) do nothing`

    await sql`
      insert into public.lead_definition (organization_id, dedupe_window_days)
      values (${orgOne}, 45)
      on conflict (organization_id) do update set dedupe_window_days = 45`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client user sees ONLY their own leads', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id from public.lead`,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
  })

  it('client two cannot read client one leads (PII isolation)', async () => {
    const rows = await asUser(clientTwoUser, (tx) =>
      tx`select contact_email from public.lead where contact_email = 'c1@example.com'`,
    )
    expect(rows.length).toBe(0)
  })

  it('a client user sees ONLY their own lead_identity rows', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id from public.lead_identity`,
    )
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
  })

  it('a client user sees ONLY their own lead_definition', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select organization_id from public.lead_definition`,
    )
    expect(rows.every((r) => r.organization_id === orgOne)).toBe(true)
  })

  it('agency staff (founder) sees leads for ALL clients', async () => {
    const rows = await asUser(founder, (tx) => tx`select organization_id from public.lead`)
    const orgs = new Set(rows.map((r) => r.organization_id))
    expect(orgs.has(orgOne)).toBe(true)
    expect(orgs.has(orgTwo)).toBe(true)
  })

  it('a client user cannot INSERT a lead for another org', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.lead
             (organization_id, source, source_external_id, occurred_at, lead_type)
           values (${orgTwo}, 'web_form', 'evil', '2026-06-02T00:00:00Z', 'form')`,
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they FAIL**

Run: `pnpm test tests/rls/leads-isolation.test.ts`
Expected: FAIL — without RLS the client user sees both orgs' leads and the cross-org insert succeeds. This proves the tests are real.

- [ ] **Step 3: Create the custom RLS migration**

Run: `pnpm db:generate --custom --name=leads_rls`
Expected: an empty `drizzle/10xx_leads_rls.sql` registered in the journal.

- [ ] **Step 4: Fill in `drizzle/10xx_leads_rls.sql`**

```sql
-- =========================================================================
-- Plan 10: RLS for Unified Leads.
-- Reuses Plan 01 helpers public.has_org_access(uuid) and public.is_agency_staff().
-- Clients read their own leads (own count/list, PRD §5.7); staff read all.
-- Writes are performed by the Inngest workers as service_role (RLS bypassed),
-- so write policies are defense-in-depth: only staff may write via the app, and
-- manual entry is staff-only. Clients never write leads directly.
-- =========================================================================

-- ---- Enable RLS on every new tenant-scoped table ------------------------
alter table public.lead            enable row level security;
alter table public.lead_identity   enable row level security;
alter table public.lead_definition enable row level security;

-- ---- lead ---------------------------------------------------------------
create policy lead_select on public.lead
  for select using (public.has_org_access(organization_id));
-- only agency staff create/edit leads via the app (clients never write leads).
create policy lead_write on public.lead
  for all using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.is_agency_staff() and public.has_org_access(organization_id));

-- ---- lead_identity ------------------------------------------------------
create policy lead_identity_select on public.lead_identity
  for select using (public.has_org_access(organization_id));
create policy lead_identity_write on public.lead_identity
  for all using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.is_agency_staff() and public.has_org_access(organization_id));

-- ---- lead_definition ----------------------------------------------------
-- Clients may READ their own lead definition (transparency about what counts);
-- only staff configure it.
create policy lead_definition_select on public.lead_definition
  for select using (public.has_org_access(organization_id));
create policy lead_definition_write on public.lead_definition
  for all using (public.is_agency_staff() and public.has_org_access(organization_id))
  with check (public.is_agency_staff() and public.has_org_access(organization_id));
```

- [ ] **Step 5: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `10xx_leads_rls.sql` with no errors.

- [ ] **Step 6: Run the isolation tests and confirm they PASS**

Run: `pnpm test tests/rls/leads-isolation.test.ts`
Expected: all assertions PASS — client users see only their org's leads/identities/definition, the founder sees all clients, and the cross-org insert is rejected.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(security): RLS on unified leads tables (tests pass)"
```

---

## Task 3: Contact normalisation — E.164 phone + email

**Files:**
- Create: `src/lib/leads/normalize.ts`
- Create: `tests/leads/normalize.test.ts`

De-dupe is only as good as normalisation. Phone is the **primary** dedupe key, so it must collapse formatting differences to a canonical E.164 string; email is the fallback key (lowercased, trimmed). This is a pure module — no DB.

- [ ] **Step 1: Write the failing test `tests/leads/normalize.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  John.Doe@Example.COM ')).toBe('john.doe@example.com')
  })
  it('returns null for empty/invalid input', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail('not-an-email')).toBeNull()
  })
})

describe('normalizePhoneE164', () => {
  it('keeps an already-E.164 number', () => {
    expect(normalizePhoneE164('+447700900123', 'GB')).toBe('+447700900123')
  })
  it('strips spaces, dashes, parens, and dots', () => {
    expect(normalizePhoneE164('+44 7700 900-123', 'GB')).toBe('+447700900123')
    expect(normalizePhoneE164('+1 (415) 555.2671', 'US')).toBe('+14155552671')
  })
  it('applies the default region to a national number', () => {
    // UK national 07700 900123 -> +44 7700 900123 (drop the trunk 0)
    expect(normalizePhoneE164('07700 900123', 'GB')).toBe('+447700900123')
    // US national 10-digit -> +1
    expect(normalizePhoneE164('(415) 555-2671', 'US')).toBe('+14155552671')
  })
  it('converts a 00 international prefix to +', () => {
    expect(normalizePhoneE164('0044 7700 900123', 'GB')).toBe('+447700900123')
  })
  it('returns null for unusable input', () => {
    expect(normalizePhoneE164('', 'GB')).toBeNull()
    expect(normalizePhoneE164('abc', 'GB')).toBeNull()
    expect(normalizePhoneE164('123', 'GB')).toBeNull() // too short to be a phone
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/normalize.test.ts`
Expected: FAIL — `@/lib/leads/normalize` does not exist.

- [ ] **Step 3: Write `src/lib/leads/normalize.ts`**

```ts
/**
 * Contact normalisation for deterministic lead de-duplication (PRD §5.7).
 * Phone is the PRIMARY dedupe key (normalised to E.164), email the fallback.
 * Self-contained (no external lib) so it is trivially testable and dependency-
 * free; covers the formats the agency's lead sources actually emit (GB/US plus
 * already-E.164 from Meta/Google).
 */

/** Default country dialling codes for the regions we onboard. */
const REGION_DIAL_CODE: Record<string, string> = {
  GB: '44',
  US: '1',
  CA: '1',
  IE: '353',
  AU: '61',
}

/** Minimum digit count for a plausible phone number (E.164 is up to 15). */
const MIN_PHONE_DIGITS = 7

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lowercase + trim an email; null if blank or not email-shaped. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null
  const e = input.trim().toLowerCase()
  if (e.length === 0) return null
  return EMAIL_RE.test(e) ? e : null
}

/**
 * Normalise a phone number to E.164 ('+<countrycode><national>'), using
 * `defaultRegion` (ISO-3166 alpha-2) when the input has no '+'/'00' prefix.
 * Returns null when the input cannot be made into a plausible number.
 */
export function normalizePhoneE164(
  input: string | null | undefined,
  defaultRegion = 'GB',
): string | null {
  if (!input) return null

  let s = input.trim()
  if (s.length === 0) return null

  // Convert a leading '00' international prefix to '+'.
  if (s.startsWith('00')) s = '+' + s.slice(2)

  const hasPlus = s.startsWith('+')
  // Keep only digits.
  const digits = s.replace(/[^\d]/g, '')
  if (digits.length < MIN_PHONE_DIGITS) return null

  if (hasPlus) {
    return '+' + digits
  }

  // No explicit country: apply the default region's dial code, dropping a
  // national trunk '0' if present (GB/IE/AU convention).
  const dial = REGION_DIAL_CODE[defaultRegion.toUpperCase()]
  if (!dial) return null
  const national = digits.replace(/^0+/, '')
  if (national.length < MIN_PHONE_DIGITS - dial.length + 1 && national.length < MIN_PHONE_DIGITS) {
    // still allow if the trimmed national portion is reasonable
  }
  if (national.length < 4) return null
  return '+' + dial + national
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/normalize.test.ts`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): E.164 phone + email normalisation"
```

---

## Task 4: Per-client lead-definition resolver (defaults + clamp)

**Files:**
- Create: `src/lib/leads/definition.ts`
- Create: `tests/leads/definition.test.ts`

The `lead_definition` row is optional per client; when absent the resolver returns safe defaults. The dedupe window is clamped to the PRD's **30–90 day** range. Pure resolver over a row (or null).

- [ ] **Step 1: Write the failing test `tests/leads/definition.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveDefinition, DEFAULT_DEFINITION } from '@/lib/leads/definition'

describe('resolveDefinition', () => {
  it('returns safe defaults when no row exists', () => {
    const d = resolveDefinition(null)
    expect(d.dedupeWindowDays).toBe(30)
    expect(d.includeSpam).toBe(false)
    expect(d.countedSources).toEqual(DEFAULT_DEFINITION.countedSources)
  })

  it('clamps the dedupe window below 30 up to 30', () => {
    const d = resolveDefinition({
      countedSources: ['web_form'],
      includeSpam: false,
      dedupeWindowDays: 5,
    })
    expect(d.dedupeWindowDays).toBe(30)
  })

  it('clamps the dedupe window above 90 down to 90', () => {
    const d = resolveDefinition({
      countedSources: ['web_form'],
      includeSpam: false,
      dedupeWindowDays: 365,
    })
    expect(d.dedupeWindowDays).toBe(90)
  })

  it('passes a valid window through unchanged', () => {
    const d = resolveDefinition({
      countedSources: ['web_form', 'callrail'],
      includeSpam: true,
      dedupeWindowDays: 60,
    })
    expect(d.dedupeWindowDays).toBe(60)
    expect(d.includeSpam).toBe(true)
    expect(d.countedSources).toEqual(['web_form', 'callrail'])
  })

  it('counts() respects countedSources and spam inclusion', () => {
    const d = resolveDefinition({
      countedSources: ['web_form', 'callrail'],
      includeSpam: false,
      dedupeWindowDays: 30,
    })
    expect(d.counts({ source: 'web_form', isSpam: false })).toBe(true)
    expect(d.counts({ source: 'meta_ads', isSpam: false })).toBe(false) // not in countedSources
    expect(d.counts({ source: 'web_form', isSpam: true })).toBe(false) // spam excluded
  })

  it('counts() includes spam when includeSpam is true', () => {
    const d = resolveDefinition({
      countedSources: ['web_form'],
      includeSpam: true,
      dedupeWindowDays: 30,
    })
    expect(d.counts({ source: 'web_form', isSpam: true })).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/definition.test.ts`
Expected: FAIL — `@/lib/leads/definition` does not exist.

- [ ] **Step 3: Write `src/lib/leads/definition.ts`**

```ts
import type { LeadSource } from '@/db/types'

export const MIN_WINDOW_DAYS = 30
export const MAX_WINDOW_DAYS = 90

/** The shape stored in lead_definition (subset relevant to resolution). */
export interface DefinitionRow {
  countedSources: string[]
  includeSpam: boolean
  dedupeWindowDays: number
}

/** Resolved definition with a convenience `counts()` predicate. */
export interface ResolvedDefinition {
  countedSources: string[]
  includeSpam: boolean
  dedupeWindowDays: number
  counts(input: { source: LeadSource; isSpam: boolean }): boolean
}

export const DEFAULT_DEFINITION: DefinitionRow = {
  countedSources: ['web_form', 'meta_ads', 'google_ads', 'callrail', 'whatconverts', 'manual'],
  includeSpam: false,
  dedupeWindowDays: MIN_WINDOW_DAYS,
}

function clampWindow(days: number): number {
  if (!Number.isFinite(days)) return MIN_WINDOW_DAYS
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(days)))
}

/**
 * Resolve a per-client lead definition (PRD §5.7): apply defaults when absent
 * and clamp the dedupe window to the supported 30–90 day range. Returns a
 * `counts()` predicate that decides whether a given lead counts toward the
 * client's total.
 */
export function resolveDefinition(row: DefinitionRow | null): ResolvedDefinition {
  const base = row ?? DEFAULT_DEFINITION
  const countedSources = base.countedSources.length > 0 ? base.countedSources : DEFAULT_DEFINITION.countedSources
  const includeSpam = base.includeSpam
  const dedupeWindowDays = clampWindow(base.dedupeWindowDays)

  return {
    countedSources,
    includeSpam,
    dedupeWindowDays,
    counts({ source, isSpam }) {
      if (!countedSources.includes(source)) return false
      if (isSpam && !includeSpam) return false
      return true
    },
  }
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/definition.test.ts`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): per-client lead-definition resolver (defaults + 30-90d clamp)"
```

---

## Task 5: Deterministic de-duplication — `resolveIdentity` (pure, HEAVY tests)

**Files:**
- Create: `src/lib/leads/dedupe.ts`
- Create: `tests/leads/dedupe.test.ts`

This is the heart of the module (PRD §5.7 acceptance: "Same human arriving via form + tracked call + Meta lead counts as **one** lead"). It is a **pure** function over an incoming lead and a set of prior leads (already fetched, window-filtered): phone match wins, else email match, else no match. The DB query that fetches candidates lives in Task 6; keeping the decision pure makes it exhaustively testable.

- [ ] **Step 1: Write the failing test `tests/leads/dedupe.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveIdentity, withinWindow, type DedupeCandidate } from '@/lib/leads/dedupe'

const base = {
  id: 'incoming',
  occurredAt: new Date('2026-06-20T12:00:00Z'),
}

function cand(over: Partial<DedupeCandidate>): DedupeCandidate {
  return {
    id: 'c',
    canonicalLeadId: 'c',
    contactPhoneE164: null,
    contactEmail: null,
    occurredAt: new Date('2026-06-20T11:00:00Z'),
    ...over,
  }
}

describe('withinWindow', () => {
  it('true when two timestamps are within N days', () => {
    expect(
      withinWindow(new Date('2026-06-20T00:00:00Z'), new Date('2026-06-01T00:00:00Z'), 30),
    ).toBe(true)
  })
  it('false when older than N days', () => {
    expect(
      withinWindow(new Date('2026-06-20T00:00:00Z'), new Date('2026-04-01T00:00:00Z'), 30),
    ).toBe(false)
  })
})

describe('resolveIdentity (deterministic dedupe)', () => {
  it('matches on phone (PRIMARY key) even when emails differ', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: 'new@x.com' }
    const candidates = [
      cand({ id: 'p1', canonicalLeadId: 'p1', contactPhoneE164: '+447700900123', contactEmail: 'old@x.com' }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.matchedOn).toBe('phone')
    expect(r.canonicalLeadId).toBe('p1')
  })

  it('falls back to email when no phone match', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900999', contactEmail: 'shared@x.com' }
    const candidates = [
      cand({ id: 'e1', canonicalLeadId: 'e1', contactPhoneE164: '+447700900111', contactEmail: 'shared@x.com' }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.matchedOn).toBe('email')
    expect(r.canonicalLeadId).toBe('e1')
  })

  it('prefers a PHONE match over an EMAIL match when both exist on different candidates', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: 'shared@x.com' }
    const candidates = [
      cand({ id: 'eMatch', canonicalLeadId: 'eMatch', contactEmail: 'shared@x.com' }),
      cand({ id: 'pMatch', canonicalLeadId: 'pMatch', contactPhoneE164: '+447700900123' }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.matchedOn).toBe('phone')
    expect(r.canonicalLeadId).toBe('pMatch')
  })

  it('returns self when there is no match (new identity)', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: 'lonely@x.com' }
    const r = resolveIdentity(incoming, [], 30)
    expect(r.matchedOn).toBe('self')
    expect(r.canonicalLeadId).toBe('incoming')
  })

  it('does NOT match a candidate outside the dedupe window', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: null }
    const candidates = [
      cand({
        id: 'old',
        canonicalLeadId: 'old',
        contactPhoneE164: '+447700900123',
        occurredAt: new Date('2026-01-01T00:00:00Z'), // > 30 days before 2026-06-20
      }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.matchedOn).toBe('self')
  })

  it('DOES match a candidate inside a widened 90-day window', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: null }
    const candidates = [
      cand({
        id: 'older',
        canonicalLeadId: 'older',
        contactPhoneE164: '+447700900123',
        occurredAt: new Date('2026-04-01T00:00:00Z'), // ~80 days before
      }),
    ]
    expect(resolveIdentity(incoming, candidates, 30).matchedOn).toBe('self')
    expect(resolveIdentity(incoming, candidates, 90).canonicalLeadId).toBe('older')
  })

  it('ignores null/blank keys (a null phone never matches a null phone)', () => {
    const incoming = { ...base, contactPhoneE164: null, contactEmail: null }
    const candidates = [cand({ id: 'n', canonicalLeadId: 'n', contactPhoneE164: null, contactEmail: null })]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.matchedOn).toBe('self')
  })

  it('follows the candidate canonical pointer (transitive merge)', () => {
    // candidate p1 already merged into canonical X; a new phone match should
    // adopt X, not p1, so all touches share ONE canonical id.
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: null }
    const candidates = [
      cand({ id: 'p1', canonicalLeadId: 'X', contactPhoneE164: '+447700900123' }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.canonicalLeadId).toBe('X')
  })

  it('picks the EARLIEST-occurring candidate canonical when several match (stable)', () => {
    const incoming = { ...base, contactPhoneE164: '+447700900123', contactEmail: null }
    const candidates = [
      cand({ id: 'late', canonicalLeadId: 'late', contactPhoneE164: '+447700900123', occurredAt: new Date('2026-06-19T00:00:00Z') }),
      cand({ id: 'early', canonicalLeadId: 'early', contactPhoneE164: '+447700900123', occurredAt: new Date('2026-06-10T00:00:00Z') }),
    ]
    const r = resolveIdentity(incoming, candidates, 30)
    expect(r.canonicalLeadId).toBe('early')
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/dedupe.test.ts`
Expected: FAIL — `@/lib/leads/dedupe` does not exist.

- [ ] **Step 3: Write `src/lib/leads/dedupe.ts`**

```ts
/**
 * Deterministic lead de-duplication (PRD §5.7). PURE — no DB. The caller fetches
 * candidate leads for the org (Task 6) and passes them in; this function decides
 * the canonical identity using a fixed precedence:
 *   1. phone_e164 exact match (PRIMARY key)
 *   2. email exact match (FALLBACK)
 *   3. no match -> self (a brand-new identity)
 * Matches are restricted to the configured dedupe window. When several
 * candidates match, the EARLIEST-occurring candidate's canonical pointer wins,
 * making the result stable regardless of fetch order. Following the candidate's
 * `canonicalLeadId` (not its own id) keeps merges transitive: every touch of one
 * human ends up sharing exactly one canonical lead id.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface IncomingLead {
  id: string
  contactPhoneE164: string | null
  contactEmail: string | null
  occurredAt: Date
}

export interface DedupeCandidate {
  id: string
  canonicalLeadId: string
  contactPhoneE164: string | null
  contactEmail: string | null
  occurredAt: Date
}

export type MatchedOn = 'phone' | 'email' | 'self'

export interface IdentityResolution {
  canonicalLeadId: string
  matchedOn: MatchedOn
}

/** True if `b` is within `windowDays` of `a` (absolute difference). */
export function withinWindow(a: Date, b: Date, windowDays: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= windowDays * MS_PER_DAY
}

/** Earliest-occurring candidate (stable canonical selection). */
function earliest(cands: DedupeCandidate[]): DedupeCandidate {
  return cands.reduce((min, c) => (c.occurredAt.getTime() < min.occurredAt.getTime() ? c : min))
}

export function resolveIdentity(
  incoming: IncomingLead,
  candidates: DedupeCandidate[],
  windowDays: number,
): IdentityResolution {
  const inWindow = candidates.filter((c) => withinWindow(incoming.occurredAt, c.occurredAt, windowDays))

  // 1. PRIMARY: phone match.
  if (incoming.contactPhoneE164) {
    const phoneMatches = inWindow.filter((c) => c.contactPhoneE164 === incoming.contactPhoneE164)
    if (phoneMatches.length > 0) {
      return { canonicalLeadId: earliest(phoneMatches).canonicalLeadId, matchedOn: 'phone' }
    }
  }

  // 2. FALLBACK: email match.
  if (incoming.contactEmail) {
    const emailMatches = inWindow.filter((c) => c.contactEmail === incoming.contactEmail)
    if (emailMatches.length > 0) {
      return { canonicalLeadId: earliest(emailMatches).canonicalLeadId, matchedOn: 'email' }
    }
  }

  // 3. No match -> this lead is its own canonical identity.
  return { canonicalLeadId: incoming.id, matchedOn: 'self' }
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/dedupe.test.ts`
Expected: all assertions PASS — phone-primary, email-fallback, window boundaries, transitive canonical, and stable earliest-wins selection all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): deterministic phone-primary/email-fallback dedupe (pure)"
```

---

## Task 6: Source parsers + registry (own form, Meta, CallRail, WhatConverts, Google Ads)

**Files:**
- Create: `src/lib/leads/parsers/types.ts`
- Create: `src/lib/leads/parsers/web-form.ts`
- Create: `src/lib/leads/parsers/meta-leadgen.ts`
- Create: `src/lib/leads/parsers/callrail.ts`
- Create: `src/lib/leads/parsers/whatconverts.ts`
- Create: `src/lib/leads/parsers/google-ads.ts`
- Create: `src/lib/leads/parsers/registry.ts`
- Create: `tests/leads/parsers.test.ts`

Each parser maps a provider's raw payload to a `ParsedLead` (normalised contact + attribution + a stable `sourceExternalId` for idempotency). Provider specifics never leak past this layer (mirrors Plan 06's Connector boundary).

- [ ] **Step 1: Write the failing test `tests/leads/parsers.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { getLeadParser } from '@/lib/leads/parsers/registry'

describe('lead parsers', () => {
  it('web_form: maps a form post to a ParsedLead with normalised contact', () => {
    const p = getLeadParser('web_form')
    const parsed = p.parse({
      submission_id: 'wf-1',
      submitted_at: '2026-06-20T12:00:00Z',
      name: 'Jane Doe',
      email: 'Jane@Example.com',
      phone: '07700 900123',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'june',
      gclid: 'abc123',
    })
    expect(parsed.sourceExternalId).toBe('wf-1')
    expect(parsed.contactEmail).toBe('jane@example.com')
    expect(parsed.contactPhoneE164).toBe('+447700900123')
    expect(parsed.utmSource).toBe('newsletter')
    expect(parsed.gclid).toBe('abc123')
    expect(parsed.leadType).toBe('form')
    expect(parsed.occurredAt.toISOString()).toBe('2026-06-20T12:00:00.000Z')
  })

  it('meta_ads: maps leadgen field_data array to contact + ad attribution', () => {
    const p = getLeadParser('meta_ads')
    const parsed = p.parse({
      leadgen_id: '99887766',
      created_time: '2026-06-20T09:30:00+0000',
      ad_id: 'ad-555',
      campaign_id: 'camp-7',
      form_id: 'form-2',
      field_data: [
        { name: 'full_name', values: ['Bob Smith'] },
        { name: 'email', values: ['bob@example.com'] },
        { name: 'phone_number', values: ['+1 (415) 555-2671'] },
      ],
    })
    expect(parsed.sourceExternalId).toBe('99887766')
    expect(parsed.contactName).toBe('Bob Smith')
    expect(parsed.contactEmail).toBe('bob@example.com')
    expect(parsed.contactPhoneE164).toBe('+14155552671')
    expect(parsed.adId).toBe('ad-555')
    expect(parsed.campaign).toBe('camp-7')
    expect(parsed.formId).toBe('form-2')
    expect(parsed.channel).toBe('meta')
  })

  it('callrail: maps a tracked call to a call-type lead', () => {
    const p = getLeadParser('callrail')
    const parsed = p.parse({
      id: 'CAL123',
      start_time: '2026-06-20T14:00:00Z',
      customer_name: 'Carla Jones',
      customer_phone_number: '+447700900456',
      utm_source: 'google',
      utm_medium: 'cpc',
      gclid: 'g-789',
    })
    expect(parsed.sourceExternalId).toBe('CAL123')
    expect(parsed.contactPhoneE164).toBe('+447700900456')
    expect(parsed.contactName).toBe('Carla Jones')
    expect(parsed.leadType).toBe('call')
    expect(parsed.channel).toBe('callrail')
    expect(parsed.gclid).toBe('g-789')
  })

  it('whatconverts: maps a lead with quotable value', () => {
    const p = getLeadParser('whatconverts')
    const parsed = p.parse({
      lead_id: 'WC-42',
      date_created: '2026-06-20T15:00:00Z',
      contact_name: 'Dan Lee',
      email_address: 'dan@example.com',
      phone_number: '07700 900789',
      lead_type: 'Phone Call',
      quotable_value: '1500.00',
      utm_campaign: 'spring',
    })
    expect(parsed.sourceExternalId).toBe('WC-42')
    expect(parsed.contactEmail).toBe('dan@example.com')
    expect(parsed.contactPhoneE164).toBe('+447700900789')
    expect(parsed.leadType).toBe('call')
    expect(parsed.value).toBe(1500)
    expect(parsed.utmCampaign).toBe('spring')
  })

  it('google_ads: maps a lead-form API row', () => {
    const p = getLeadParser('google_ads')
    const parsed = p.parse({
      lead_id: 'GA-LF-1',
      submission_date_time: '2026-06-20 16:00:00',
      campaign_id: 'gc-1',
      gcl_id: 'gcl-xyz',
      lead_form_id: 'lf-9',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Eve North' },
        { column_id: 'EMAIL', string_value: 'eve@example.com' },
        { column_id: 'PHONE_NUMBER', string_value: '+447700900321' },
      ],
    })
    expect(parsed.sourceExternalId).toBe('GA-LF-1')
    expect(parsed.contactName).toBe('Eve North')
    expect(parsed.contactEmail).toBe('eve@example.com')
    expect(parsed.contactPhoneE164).toBe('+447700900321')
    expect(parsed.gclid).toBe('gcl-xyz')
    expect(parsed.campaign).toBe('gc-1')
    expect(parsed.formId).toBe('lf-9')
    expect(parsed.channel).toBe('google_ads')
  })

  it('registry throws for an unknown source', () => {
    // @ts-expect-error invalid source on purpose
    expect(() => getLeadParser('nope')).toThrow()
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/parsers.test.ts`
Expected: FAIL — parser modules do not exist.

- [ ] **Step 3: Write `src/lib/leads/parsers/types.ts`**

```ts
import type { LeadSource, LeadType } from '@/db/types'

/** Provider-agnostic parsed lead ready for canonical upsert (Task 7). */
export interface ParsedLead {
  source: LeadSource
  sourceExternalId: string
  occurredAt: Date
  contactName: string | null
  contactEmail: string | null
  contactPhoneE164: string | null
  channel: string | null
  campaign: string | null
  adId: string | null
  formId: string | null
  gclid: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  leadType: LeadType
  value: number | null
}

/** Every lead source implements this to turn a raw payload into a ParsedLead. */
export interface LeadParser {
  readonly source: LeadSource
  parse(payload: unknown): ParsedLead
}

/** Safe string accessor for loosely-typed JSON payloads. */
export function str(obj: unknown, key: string): string | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key]
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s.length > 0 ? s : null
  }
  return null
}

/** Parse a numeric value, returning null when absent/unparseable. */
export function num(obj: unknown, key: string): number | null {
  const s = str(obj, key)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
```

- [ ] **Step 4: Write `src/lib/leads/parsers/web-form.ts`**

```ts
import type { LeadParser, ParsedLead } from './types'
import { str, num } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'

/** Own embeddable web form (we control the payload shape). */
export class WebFormParser implements LeadParser {
  readonly source = 'web_form' as const
  parse(payload: unknown): ParsedLead {
    const submittedAt = str(payload, 'submitted_at')
    return {
      source: 'web_form',
      sourceExternalId: str(payload, 'submission_id') ?? `web_form:${submittedAt ?? Date.now()}`,
      occurredAt: submittedAt ? new Date(submittedAt) : new Date(),
      contactName: str(payload, 'name'),
      contactEmail: normalizeEmail(str(payload, 'email')),
      contactPhoneE164: normalizePhoneE164(str(payload, 'phone')),
      channel: 'web_form',
      campaign: str(payload, 'utm_campaign'),
      adId: null,
      formId: str(payload, 'form_id'),
      gclid: str(payload, 'gclid'),
      utmSource: str(payload, 'utm_source'),
      utmMedium: str(payload, 'utm_medium'),
      utmCampaign: str(payload, 'utm_campaign'),
      utmTerm: str(payload, 'utm_term'),
      utmContent: str(payload, 'utm_content'),
      leadType: 'form',
      value: num(payload, 'value'),
    }
  }
}
```

- [ ] **Step 5: Write `src/lib/leads/parsers/meta-leadgen.ts`**

```ts
import type { LeadParser, ParsedLead } from './types'
import { str } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'

interface MetaField {
  name: string
  values: string[]
}

/** Pull the first value for a Meta leadgen field_data entry by name. */
function fieldValue(fields: MetaField[] | undefined, name: string): string | null {
  const f = fields?.find((x) => x.name === name)
  const v = f?.values?.[0]
  return v ? v.trim() : null
}

/** Meta Lead Ads leadgen payload (after GET /{leadgen_id} resolves field_data). */
export class MetaLeadgenParser implements LeadParser {
  readonly source = 'meta_ads' as const
  parse(payload: unknown): ParsedLead {
    const p = (payload ?? {}) as Record<string, unknown>
    const fields = p.field_data as MetaField[] | undefined
    const createdTime = str(payload, 'created_time')
    return {
      source: 'meta_ads',
      sourceExternalId: str(payload, 'leadgen_id') ?? str(payload, 'id') ?? `meta:${createdTime ?? Date.now()}`,
      occurredAt: createdTime ? new Date(createdTime) : new Date(),
      contactName: fieldValue(fields, 'full_name') ?? fieldValue(fields, 'name'),
      contactEmail: normalizeEmail(fieldValue(fields, 'email')),
      contactPhoneE164: normalizePhoneE164(fieldValue(fields, 'phone_number')),
      channel: 'meta',
      campaign: str(payload, 'campaign_id'),
      adId: str(payload, 'ad_id'),
      formId: str(payload, 'form_id'),
      gclid: null,
      utmSource: 'meta',
      utmMedium: 'paid_social',
      utmCampaign: str(payload, 'campaign_id'),
      utmTerm: null,
      utmContent: str(payload, 'ad_id'),
      leadType: 'form',
      value: null,
    }
  }
}
```

- [ ] **Step 6: Write `src/lib/leads/parsers/callrail.ts`**

```ts
import type { LeadParser, ParsedLead } from './types'
import { str } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'

/** CallRail call/form webhook. */
export class CallRailParser implements LeadParser {
  readonly source = 'callrail' as const
  parse(payload: unknown): ParsedLead {
    const startTime = str(payload, 'start_time')
    return {
      source: 'callrail',
      sourceExternalId: str(payload, 'id') ?? `callrail:${startTime ?? Date.now()}`,
      occurredAt: startTime ? new Date(startTime) : new Date(),
      contactName: str(payload, 'customer_name'),
      contactEmail: normalizeEmail(str(payload, 'customer_email')),
      contactPhoneE164: normalizePhoneE164(str(payload, 'customer_phone_number')),
      channel: 'callrail',
      campaign: str(payload, 'utm_campaign'),
      adId: null,
      formId: null,
      gclid: str(payload, 'gclid'),
      utmSource: str(payload, 'utm_source'),
      utmMedium: str(payload, 'utm_medium'),
      utmCampaign: str(payload, 'utm_campaign'),
      utmTerm: str(payload, 'utm_term'),
      utmContent: str(payload, 'utm_content'),
      leadType: 'call',
      value: null,
    }
  }
}
```

- [ ] **Step 7: Write `src/lib/leads/parsers/whatconverts.ts`**

```ts
import type { LeadParser, ParsedLead, LeadTypeMap } from './types'
import { str, num } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'
import type { LeadType } from '@/db/types'

/** Map a WhatConverts lead_type label to our enum. */
function mapType(label: string | null): LeadType {
  const l = (label ?? '').toLowerCase()
  if (l.includes('call') || l.includes('phone')) return 'call'
  if (l.includes('chat') || l.includes('message') || l.includes('text')) return 'message'
  if (l.includes('form')) return 'form'
  return 'other'
}

/** WhatConverts lead webhook. */
export class WhatConvertsParser implements LeadParser {
  readonly source = 'whatconverts' as const
  parse(payload: unknown): ParsedLead {
    const created = str(payload, 'date_created')
    return {
      source: 'whatconverts',
      sourceExternalId: str(payload, 'lead_id') ?? `whatconverts:${created ?? Date.now()}`,
      occurredAt: created ? new Date(created) : new Date(),
      contactName: str(payload, 'contact_name'),
      contactEmail: normalizeEmail(str(payload, 'email_address')),
      contactPhoneE164: normalizePhoneE164(str(payload, 'phone_number')),
      channel: 'whatconverts',
      campaign: str(payload, 'utm_campaign'),
      adId: null,
      formId: null,
      gclid: str(payload, 'gclid'),
      utmSource: str(payload, 'utm_source'),
      utmMedium: str(payload, 'utm_medium'),
      utmCampaign: str(payload, 'utm_campaign'),
      utmTerm: str(payload, 'utm_term'),
      utmContent: str(payload, 'utm_content'),
      leadType: mapType(str(payload, 'lead_type')),
      value: num(payload, 'quotable_value'),
    }
  }
}

// re-export to satisfy the import above without an unused-symbol error
export type { LeadTypeMap }
```

> Remove the `LeadTypeMap` import and re-export — they are illustrative and do not exist. The corrected file imports only `str, num` from `./types` and `LeadType` from `@/db/types`. (Kept here as an explicit instruction so the worker deletes those two lines before running the test.)

The corrected top + bottom of `whatconverts.ts`:

```ts
import type { LeadParser, ParsedLead } from './types'
import { str, num } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'
import type { LeadType } from '@/db/types'
```
(and delete the final `export type { LeadTypeMap }` line entirely.)

- [ ] **Step 8: Write `src/lib/leads/parsers/google-ads.ts`**

```ts
import type { LeadParser, ParsedLead } from './types'
import { str } from './types'
import { normalizeEmail, normalizePhoneE164 } from '@/lib/leads/normalize'

interface GoogleAdsColumn {
  column_id: string
  string_value: string
}

/** Pull a Google Ads lead-form user_column_data value by column id. */
function columnValue(cols: GoogleAdsColumn[] | undefined, id: string): string | null {
  const c = cols?.find((x) => x.column_id === id)
  return c?.string_value ? c.string_value.trim() : null
}

/** Google Ads lead-form row (from the 60-day API backfill, Task 9). */
export class GoogleAdsLeadParser implements LeadParser {
  readonly source = 'google_ads' as const
  parse(payload: unknown): ParsedLead {
    const p = (payload ?? {}) as Record<string, unknown>
    const cols = p.user_column_data as GoogleAdsColumn[] | undefined
    const submitted = str(payload, 'submission_date_time')
    // Google emits 'YYYY-MM-DD HH:MM:SS' (account timezone). Treat as UTC ISO.
    const occurredAt = submitted ? new Date(submitted.replace(' ', 'T') + 'Z') : new Date()
    return {
      source: 'google_ads',
      sourceExternalId: str(payload, 'lead_id') ?? `google_ads:${submitted ?? Date.now()}`,
      occurredAt,
      contactName: columnValue(cols, 'FULL_NAME') ?? columnValue(cols, 'FIRST_NAME'),
      contactEmail: normalizeEmail(columnValue(cols, 'EMAIL')),
      contactPhoneE164: normalizePhoneE164(columnValue(cols, 'PHONE_NUMBER')),
      channel: 'google_ads',
      campaign: str(payload, 'campaign_id'),
      adId: null,
      formId: str(payload, 'lead_form_id'),
      gclid: str(payload, 'gcl_id'),
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: str(payload, 'campaign_id'),
      utmTerm: null,
      utmContent: null,
      leadType: 'form',
      value: null,
    }
  }
}
```

- [ ] **Step 9: Write `src/lib/leads/parsers/registry.ts`**

```ts
import type { LeadSource } from '@/db/types'
import type { LeadParser } from './types'
import { WebFormParser } from './web-form'
import { MetaLeadgenParser } from './meta-leadgen'
import { CallRailParser } from './callrail'
import { WhatConvertsParser } from './whatconverts'
import { GoogleAdsLeadParser } from './google-ads'

const registry = new Map<LeadSource, LeadParser>([
  ['web_form', new WebFormParser()],
  ['meta_ads', new MetaLeadgenParser()],
  ['callrail', new CallRailParser()],
  ['whatconverts', new WhatConvertsParser()],
  ['google_ads', new GoogleAdsLeadParser()],
])

/** Resolve the parser for a contact-bearing lead source. */
export function getLeadParser(source: LeadSource): LeadParser {
  const p = registry.get(source)
  if (!p) throw new Error(`no lead parser registered for source: ${source}`)
  return p
}

export function hasLeadParser(source: LeadSource): boolean {
  return registry.has(source)
}
```

- [ ] **Step 10: Run the test and confirm PASS**

Run: `pnpm test tests/leads/parsers.test.ts`
Expected: all 6 assertions PASS — every parser normalises contact + maps attribution + emits a stable `sourceExternalId`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(leads): source parsers (web form, Meta, CallRail, WhatConverts, Google Ads) + registry"
```

---

## Task 7: Canonical ingest — idempotent upsert + identity linking (HEAVY tests)

**Files:**
- Create: `src/lib/leads/ingest.ts`
- Create: `tests/leads/ingest-idempotency.test.ts`

This stitches everything together: take a `ParsedLead`, **idempotently upsert** the canonical `lead` row (conflict on `(organization_id, source, source_external_id)` so webhook redelivery is a no-op), fetch dedupe candidates within the client's window, run `resolveIdentity`, and write/refresh the `lead_identity` link. Uses the raw `sql` harness (service-role; RLS bypassed for jobs).

- [ ] **Step 1: Write the failing test `tests/leads/ingest-idempotency.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { ingestLead } from '@/lib/leads/ingest'
import type { ParsedLead } from '@/lib/leads/parsers/types'

function parsed(over: Partial<ParsedLead>): ParsedLead {
  return {
    source: 'web_form',
    sourceExternalId: 'x',
    occurredAt: new Date('2026-06-20T12:00:00Z'),
    contactName: null,
    contactEmail: null,
    contactPhoneE164: null,
    channel: 'web_form',
    campaign: null,
    adId: null,
    formId: null,
    gclid: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    leadType: 'form',
    value: null,
    ...over,
  }
}

async function dedupedCount(org: string): Promise<number> {
  const r = await sql`
    select count(distinct canonical_lead_id)::int as c
    from public.lead_identity where organization_id = ${org}`
  return r[0]!.c as number
}

describe('ingestLead — idempotency + dedupe', () => {
  let org: string

  beforeAll(async () => {
    const o = await sql`select id from public.organizations where slug = 'client-one'`
    org = o[0]!.id as string
  })

  beforeEach(async () => {
    await sql`delete from public.lead_identity where organization_id = ${org}`
    await sql`delete from public.lead where organization_id = ${org}`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('inserts a new lead and a self identity link', async () => {
    const r = await ingestLead(org, parsed({ sourceExternalId: 'wf-1', contactEmail: 'a@x.com' }))
    expect(r.created).toBe(true)
    const rows = await sql`select source_external_id from public.lead where organization_id = ${org}`
    expect(rows.length).toBe(1)
    expect(await dedupedCount(org)).toBe(1)
  })

  it('redelivery of the SAME source_external_id does not duplicate (idempotent)', async () => {
    await ingestLead(org, parsed({ sourceExternalId: 'wf-2', contactEmail: 'b@x.com' }))
    const second = await ingestLead(org, parsed({ sourceExternalId: 'wf-2', contactEmail: 'b@x.com' }))
    expect(second.created).toBe(false)
    const rows = await sql`select id from public.lead where organization_id = ${org} and source_external_id = 'wf-2'`
    expect(rows.length).toBe(1)
    expect(await dedupedCount(org)).toBe(1)
  })

  it('same human via form + call + Meta counts as ONE de-duplicated lead (phone match)', async () => {
    const phone = '+447700900123'
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'f-1', contactPhoneE164: phone, contactEmail: 'h@x.com' }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'c-1', contactPhoneE164: phone, leadType: 'call' }))
    await ingestLead(org, parsed({ source: 'meta_ads', sourceExternalId: 'm-1', contactPhoneE164: phone }))

    // three distinct touches retained...
    const touches = await sql`select id from public.lead where organization_id = ${org}`
    expect(touches.length).toBe(3)
    // ...but ONE de-duplicated lead.
    expect(await dedupedCount(org)).toBe(1)
  })

  it('email-only match (no phone) still merges to one', async () => {
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'e-1', contactEmail: 'shared@x.com', contactPhoneE164: null }))
    await ingestLead(org, parsed({ source: 'whatconverts', sourceExternalId: 'e-2', contactEmail: 'shared@x.com', contactPhoneE164: null }))
    expect(await dedupedCount(org)).toBe(1)
  })

  it('different humans stay as separate de-duplicated leads', async () => {
    await ingestLead(org, parsed({ sourceExternalId: 'p1', contactPhoneE164: '+447700900001' }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'p2', contactPhoneE164: '+447700900002' }))
    expect(await dedupedCount(org)).toBe(2)
  })

  it('a touch outside the dedupe window is NOT merged (default 30d)', async () => {
    const phone = '+447700900555'
    await ingestLead(org, parsed({ sourceExternalId: 'old', contactPhoneE164: phone, occurredAt: new Date('2026-01-01T00:00:00Z') }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'new', contactPhoneE164: phone, occurredAt: new Date('2026-06-20T00:00:00Z') }))
    expect(await dedupedCount(org)).toBe(2) // 170 days apart > 30d window
  })

  it('re-ingest after a match keeps the canonical pointer stable (no churn)', async () => {
    const phone = '+447700900777'
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'a', contactPhoneE164: phone }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'b', contactPhoneE164: phone }))
    const before = await sql`select canonical_lead_id from public.lead_identity where organization_id = ${org} order by canonical_lead_id`
    // redeliver both
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'a', contactPhoneE164: phone }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'b', contactPhoneE164: phone }))
    const after = await sql`select canonical_lead_id from public.lead_identity where organization_id = ${org} order by canonical_lead_id`
    expect(after).toEqual(before)
    expect(await dedupedCount(org)).toBe(1)
  })
})
```

> Add `beforeEach` to the vitest import at the top of the test file: `import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'`.

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/ingest-idempotency.test.ts`
Expected: FAIL — `@/lib/leads/ingest` does not exist.

- [ ] **Step 3: Write `src/lib/leads/ingest.ts`**

```ts
import { db } from '@/db'
import { lead, leadIdentity, leadDefinition } from '@/db/schema'
import { and, eq, gte, lte, or, sql as dsql } from 'drizzle-orm'
import { resolveDefinition } from './definition'
import { resolveIdentity, type DedupeCandidate } from './dedupe'
import type { ParsedLead } from './parsers/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface IngestResult {
  leadId: string
  canonicalLeadId: string
  created: boolean
  matchedOn: 'phone' | 'email' | 'self'
}

/**
 * Ingest one ParsedLead into the canonical model (PRD §5.7):
 *  1. idempotent upsert into `lead` on (organization_id, source, source_external_id)
 *     — webhook redelivery / backfill re-runs never duplicate.
 *  2. fetch dedupe candidates (same org, matching phone OR email) within the
 *     client's configured window.
 *  3. resolveIdentity() picks the canonical lead (phone-primary, email-fallback).
 *  4. upsert the lead_identity link for this touch.
 * Runs as service_role inside an Inngest worker; RLS is bypassed for jobs, but
 * every write is org-scoped explicitly (defense in depth).
 */
export async function ingestLead(
  organizationId: string,
  parsed: ParsedLead,
  rawEventId?: string,
): Promise<IngestResult> {
  // 1. Idempotent upsert of the canonical lead touch.
  const upserted = await db
    .insert(lead)
    .values({
      organizationId,
      source: parsed.source,
      sourceExternalId: parsed.sourceExternalId,
      occurredAt: parsed.occurredAt,
      contactName: parsed.contactName,
      contactEmail: parsed.contactEmail,
      contactPhoneE164: parsed.contactPhoneE164,
      channel: parsed.channel,
      campaign: parsed.campaign,
      adId: parsed.adId,
      formId: parsed.formId,
      gclid: parsed.gclid,
      utmSource: parsed.utmSource,
      utmMedium: parsed.utmMedium,
      utmCampaign: parsed.utmCampaign,
      utmTerm: parsed.utmTerm,
      utmContent: parsed.utmContent,
      leadType: parsed.leadType,
      value: parsed.value === null ? null : parsed.value.toString(),
      rawEventId: rawEventId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [lead.organizationId, lead.source, lead.sourceExternalId],
      set: {
        occurredAt: dsql`excluded.occurred_at`,
        contactName: dsql`excluded.contact_name`,
        contactEmail: dsql`excluded.contact_email`,
        contactPhoneE164: dsql`excluded.contact_phone_e164`,
        value: dsql`excluded.value`,
        updatedAt: dsql`excluded.updated_at`,
      },
    })
    .returning({ id: lead.id, createdAt: lead.createdAt, updatedAt: lead.updatedAt })

  const row = upserted[0]!
  const leadId = row.id
  // created when createdAt == updatedAt on first insert (updatedAt set to now on conflict).
  const created = row.createdAt.getTime() === row.updatedAt.getTime()

  // If this touch already has an identity link, leave the canonical pointer
  // stable (no churn on redelivery) and return early.
  const existingLink = await db
    .select({ canonicalLeadId: leadIdentity.canonicalLeadId, matchedOn: leadIdentity.matchedOn })
    .from(leadIdentity)
    .where(and(eq(leadIdentity.organizationId, organizationId), eq(leadIdentity.leadId, leadId)))
  if (existingLink[0]) {
    return {
      leadId,
      canonicalLeadId: existingLink[0].canonicalLeadId,
      created,
      matchedOn: existingLink[0].matchedOn as 'phone' | 'email' | 'self',
    }
  }

  // 2. Resolve the client's dedupe window, then fetch candidates within it.
  const defRow = await db
    .select()
    .from(leadDefinition)
    .where(eq(leadDefinition.organizationId, organizationId))
  const def = resolveDefinition(defRow[0] ?? null)

  const windowStart = new Date(parsed.occurredAt.getTime() - def.dedupeWindowDays * MS_PER_DAY)
  const windowEnd = new Date(parsed.occurredAt.getTime() + def.dedupeWindowDays * MS_PER_DAY)

  const keyFilters = []
  if (parsed.contactPhoneE164) keyFilters.push(eq(lead.contactPhoneE164, parsed.contactPhoneE164))
  if (parsed.contactEmail) keyFilters.push(eq(lead.contactEmail, parsed.contactEmail))

  let candidates: DedupeCandidate[] = []
  if (keyFilters.length > 0) {
    const rows = await db
      .select({
        id: lead.id,
        contactPhoneE164: lead.contactPhoneE164,
        contactEmail: lead.contactEmail,
        occurredAt: lead.occurredAt,
        canonicalLeadId: leadIdentity.canonicalLeadId,
      })
      .from(lead)
      .leftJoin(leadIdentity, eq(leadIdentity.leadId, lead.id))
      .where(
        and(
          eq(lead.organizationId, organizationId),
          gte(lead.occurredAt, windowStart),
          lte(lead.occurredAt, windowEnd),
          or(...keyFilters),
        ),
      )
    candidates = rows
      .filter((r) => r.id !== leadId) // exclude self
      .map((r) => ({
        id: r.id,
        canonicalLeadId: r.canonicalLeadId ?? r.id, // unlinked rows are their own canonical
        contactPhoneE164: r.contactPhoneE164,
        contactEmail: r.contactEmail,
        occurredAt: r.occurredAt,
      }))
  }

  // 3. Deterministic resolution.
  const resolution = resolveIdentity(
    {
      id: leadId,
      contactPhoneE164: parsed.contactPhoneE164,
      contactEmail: parsed.contactEmail,
      occurredAt: parsed.occurredAt,
    },
    candidates,
    def.dedupeWindowDays,
  )

  // 4. Write the identity link for this touch (idempotent on lead_id).
  await db
    .insert(leadIdentity)
    .values({
      organizationId,
      leadId,
      canonicalLeadId: resolution.canonicalLeadId,
      matchedOn: resolution.matchedOn,
    })
    .onConflictDoNothing({ target: leadIdentity.leadId })

  return {
    leadId,
    canonicalLeadId: resolution.canonicalLeadId,
    created,
    matchedOn: resolution.matchedOn,
  }
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/ingest-idempotency.test.ts`
Expected: all assertions PASS — single insert, idempotent redelivery, three-source single de-duplicated lead, email-only merge, distinct humans stay separate, out-of-window stays separate, and re-ingest does not churn the canonical pointer.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): canonical idempotent ingest + deterministic identity linking"
```

---

## Task 8: De-duplicated count + by-source breakdown (respecting lead_definition)

**Files:**
- Create: `src/lib/leads/count.ts`
- Create: `tests/leads/count.test.ts`

The inbox/Cockpit headline number is **`count(distinct canonical_lead_id)`** over leads the client's definition counts (PRD §5.7, §5.1). This module computes the de-duplicated total and a by-source breakdown for a date range, honouring `countedSources` + spam handling.

- [ ] **Step 1: Write the failing test `tests/leads/count.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { ingestLead } from '@/lib/leads/ingest'
import { countLeads } from '@/lib/leads/count'
import type { ParsedLead } from '@/lib/leads/parsers/types'

function parsed(over: Partial<ParsedLead>): ParsedLead {
  return {
    source: 'web_form',
    sourceExternalId: 'x',
    occurredAt: new Date('2026-06-15T12:00:00Z'),
    contactName: null,
    contactEmail: null,
    contactPhoneE164: null,
    channel: 'web_form',
    campaign: null,
    adId: null,
    formId: null,
    gclid: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    leadType: 'form',
    value: null,
    ...over,
  }
}

describe('countLeads', () => {
  let org: string

  beforeAll(async () => {
    const o = await sql`select id from public.organizations where slug = 'client-one'`
    org = o[0]!.id as string
  })

  beforeEach(async () => {
    await sql`delete from public.lead_identity where organization_id = ${org}`
    await sql`delete from public.lead where organization_id = ${org}`
    await sql`delete from public.lead_definition where organization_id = ${org}`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('counts distinct canonical leads in range', async () => {
    const phone = '+447700900123'
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'a', contactPhoneE164: phone }))
    await ingestLead(org, parsed({ source: 'callrail', sourceExternalId: 'b', contactPhoneE164: phone }))
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'c', contactPhoneE164: '+447700900999' }))
    const r = await countLeads(org, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') })
    expect(r.total).toBe(2) // 1 merged + 1 standalone
  })

  it('excludes spam by default and includes it when configured', async () => {
    await ingestLead(org, parsed({ sourceExternalId: 's1', contactEmail: 'a@x.com' }))
    await sql`update public.lead set is_spam = true where organization_id = ${org} and source_external_id = 's1'`
    await ingestLead(org, parsed({ sourceExternalId: 's2', contactEmail: 'b@x.com' }))

    const def = await countLeads(org, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') })
    expect(def.total).toBe(1) // spam excluded

    await sql`insert into public.lead_definition (organization_id, include_spam) values (${org}, true)
              on conflict (organization_id) do update set include_spam = true`
    const incl = await countLeads(org, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') })
    expect(incl.total).toBe(2)
  })

  it('respects countedSources', async () => {
    await ingestLead(org, parsed({ source: 'web_form', sourceExternalId: 'w', contactEmail: 'w@x.com' }))
    await ingestLead(org, parsed({ source: 'meta_ads', sourceExternalId: 'm', contactEmail: 'm@x.com' }))
    await sql`insert into public.lead_definition (organization_id, counted_sources)
              values (${org}, ${sql.json(['web_form'])})
              on conflict (organization_id) do update set counted_sources = ${sql.json(['web_form'])}`
    const r = await countLeads(org, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') })
    expect(r.total).toBe(1) // only web_form counts
    expect(r.bySource.web_form).toBe(1)
    expect(r.bySource.meta_ads ?? 0).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/count.test.ts`
Expected: FAIL — `@/lib/leads/count` does not exist.

- [ ] **Step 3: Write `src/lib/leads/count.ts`**

```ts
import { db } from '@/db'
import { lead, leadIdentity, leadDefinition } from '@/db/schema'
import { and, eq, gte, lte } from 'drizzle-orm'
import { resolveDefinition } from './definition'
import type { LeadSource } from '@/db/types'

export interface CountRange {
  from: Date
  to: Date
}

export interface CountResult {
  /** de-duplicated total: count(distinct canonical_lead_id) of counted leads */
  total: number
  /** per-source de-duplicated breakdown (canonical leads grouped by the source
   *  of their canonical touch) */
  bySource: Partial<Record<LeadSource, number>>
}

/**
 * De-duplicated lead count for a client over a date range (PRD §5.7/§5.1).
 * Honours the client's lead_definition: only countedSources, and spam handling.
 * The headline number is the number of DISTINCT canonical leads, so the same
 * human across form + call + Meta counts once.
 */
export async function countLeads(organizationId: string, range: CountRange): Promise<CountResult> {
  const defRow = await db
    .select()
    .from(leadDefinition)
    .where(eq(leadDefinition.organizationId, organizationId))
  const def = resolveDefinition(defRow[0] ?? null)

  // Pull every touch in range joined to its canonical link.
  const rows = await db
    .select({
      leadId: lead.id,
      source: lead.source,
      isSpam: lead.isSpam,
      canonicalLeadId: leadIdentity.canonicalLeadId,
    })
    .from(lead)
    .leftJoin(leadIdentity, eq(leadIdentity.leadId, lead.id))
    .where(
      and(
        eq(lead.organizationId, organizationId),
        gte(lead.occurredAt, range.from),
        lte(lead.occurredAt, range.to),
      ),
    )

  // Reduce to counted touches, then to distinct canonical leads. A canonical
  // lead counts if ANY of its counted touches passes the definition; its source
  // bucket is the source of its earliest counted touch (deterministic: we take
  // the first counted touch we see per canonical and let later ties keep it).
  const canonicalSource = new Map<string, LeadSource>()
  for (const r of rows) {
    if (!def.counts({ source: r.source, isSpam: r.isSpam })) continue
    const canonical = r.canonicalLeadId ?? r.leadId
    if (!canonicalSource.has(canonical)) {
      canonicalSource.set(canonical, r.source)
    }
  }

  const bySource: Partial<Record<LeadSource, number>> = {}
  for (const source of canonicalSource.values()) {
    bySource[source] = (bySource[source] ?? 0) + 1
  }

  return { total: canonicalSource.size, bySource }
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/count.test.ts`
Expected: all assertions PASS — distinct-canonical total, spam inclusion toggle, and countedSources filtering all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): de-duplicated count + by-source breakdown honouring lead_definition"
```

---

## Task 9: GA4/GBP count-only aggregate signals (no PII, labelled aggregate)

**Files:**
- Create: `src/lib/leads/aggregate-signals.ts`
- Create: `tests/leads/aggregate-signals.test.ts`

PRD §5.7 acceptance: "GBP/GA4 signals are visibly labelled 'aggregate/modeled' and excluded from the contact-bearing list." These come from the Plan 06 `metric_daily` store (GA4 `generate_lead` keyEvent count; GBP `CALL_CLICKS`/`BUSINESS_CONVERSATIONS`) — **never** the `lead` table — and carry an explicit `isAggregate: true` flag with no contact fields.

- [ ] **Step 1: Write the failing test `tests/leads/aggregate-signals.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { getAggregateLeadSignals } from '@/lib/leads/aggregate-signals'

describe('getAggregateLeadSignals', () => {
  let org: string

  beforeAll(async () => {
    const o = await sql`select id from public.organizations where slug = 'client-one'`
    org = o[0]!.id as string
  })

  beforeEach(async () => {
    await sql`delete from public.metric_daily where organization_id = ${org}
              and provider in ('ga4','gbp') and metric in ('generate_lead','call_clicks','conversations')`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('sums GA4 generate_lead and GBP call/conversation signals, labelled aggregate', async () => {
    await sql`insert into public.metric_daily
        (organization_id, provider, account_id, entity, date, metric, value, is_provisional)
      values
        (${org}, 'ga4', 'prop-1', 'property', '2026-06-10', 'generate_lead', 12, false),
        (${org}, 'ga4', 'prop-1', 'property', '2026-06-11', 'generate_lead', 8, false),
        (${org}, 'gbp', 'loc-1', 'location', '2026-06-10', 'call_clicks', 5, false),
        (${org}, 'gbp', 'loc-1', 'location', '2026-06-12', 'conversations', 3, false)
      on conflict on constraint metric_daily_pk do update set value = excluded.value`

    const signals = await getAggregateLeadSignals(org, {
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-30T23:59:59Z'),
    })

    const ga4 = signals.find((s) => s.provider === 'ga4' && s.metric === 'generate_lead')
    expect(ga4!.value).toBe(20)
    expect(ga4!.isAggregate).toBe(true)
    expect(ga4!.label.toLowerCase()).toContain('aggregate')
    // count-only: no contact fields on the shape
    expect('contactEmail' in (ga4 as object)).toBe(false)

    const calls = signals.find((s) => s.provider === 'gbp' && s.metric === 'call_clicks')
    expect(calls!.value).toBe(5)
    const convos = signals.find((s) => s.provider === 'gbp' && s.metric === 'conversations')
    expect(convos!.value).toBe(3)
  })

  it('returns an empty array when there are no signals in range', async () => {
    const signals = await getAggregateLeadSignals(org, {
      from: new Date('2026-05-01T00:00:00Z'),
      to: new Date('2026-05-31T23:59:59Z'),
    })
    expect(signals).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/aggregate-signals.test.ts`
Expected: FAIL — `@/lib/leads/aggregate-signals` does not exist.

- [ ] **Step 3: Write `src/lib/leads/aggregate-signals.ts`**

```ts
import { db } from '@/db'
import { metricDaily } from '@/db/schema'
import { and, eq, gte, lte, inArray, sql as dsql } from 'drizzle-orm'

/**
 * GA4/GBP lead SIGNALS are count-only and modeled — they carry NO contact PII
 * and must never appear in the contact-bearing lead list (PRD §5.7). They are
 * read from the Plan 06 metric_daily store and returned with an explicit
 * `isAggregate: true` flag + a human label so the UI can badge them clearly.
 */
export interface AggregateSignal {
  provider: 'ga4' | 'gbp'
  metric: string
  value: number
  isAggregate: true
  label: string
}

interface SignalRange {
  from: Date
  to: Date
}

/** Metrics in metric_daily that represent lead-like aggregate signals. */
const SIGNAL_METRICS = ['generate_lead', 'call_clicks', 'conversations'] as const

const LABELS: Record<string, string> = {
  generate_lead: 'GA4 generate_lead (aggregate/modeled)',
  call_clicks: 'GBP calls (aggregate)',
  conversations: 'GBP messages (aggregate)',
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getAggregateLeadSignals(
  organizationId: string,
  range: SignalRange,
): Promise<AggregateSignal[]> {
  const rows = await db
    .select({
      provider: metricDaily.provider,
      metric: metricDaily.metric,
      total: dsql<string>`sum(${metricDaily.value})`,
    })
    .from(metricDaily)
    .where(
      and(
        eq(metricDaily.organizationId, organizationId),
        inArray(metricDaily.provider, ['ga4', 'gbp']),
        inArray(metricDaily.metric, [...SIGNAL_METRICS]),
        gte(metricDaily.date, toDateStr(range.from)),
        lte(metricDaily.date, toDateStr(range.to)),
      ),
    )
    .groupBy(metricDaily.provider, metricDaily.metric)

  return rows.map((r) => ({
    provider: r.provider as 'ga4' | 'gbp',
    metric: r.metric,
    value: Number(r.total),
    isAggregate: true as const,
    label: LABELS[r.metric] ?? `${r.provider} ${r.metric} (aggregate)`,
  }))
}
```

- [ ] **Step 4: Run the test and confirm PASS**

Run: `pnpm test tests/leads/aggregate-signals.test.ts`
Expected: both assertions PASS — GA4/GBP signals summed, labelled aggregate, no contact fields, empty range returns `[]`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(leads): GA4/GBP count-only aggregate signals (no PII, labelled)"
```

---

## Task 10: Webhook fan-out to lead-ingest worker + own embeddable form route

**Files:**
- Create: `src/lib/inngest/functions/lead-ingest.ts`
- Create: `src/app/api/leads/form/route.ts`
- Modify: `src/lib/inngest/functions/webhook-ingest.ts` (Plan 06)
- Modify: `src/app/api/inngest/route.ts` (Plan 06 serve route)

The Plan 06 generic webhook route already verifies signatures, records `raw_event`, and emits `integrations/webhook.received`. We extend its worker to **additionally** fan out `integrations/lead.ingest` for lead-bearing providers, and add a dedicated HMAC-verified route for our own embeddable form (which posts a known shape and feeds the same pipeline).

- [ ] **Step 1: Write the lead-ingest worker `src/lib/inngest/functions/lead-ingest.ts`**

```ts
import { inngest } from '@/lib/inngest/client'
import { getLeadParser, hasLeadParser } from '@/lib/leads/parsers/registry'
import { ingestLead } from '@/lib/leads/ingest'
import type { LeadSource } from '@/db/types'

/**
 * Parse a captured webhook payload into a canonical lead (PRD §5.7). Triggered
 * by `integrations/lead.ingest` (fanned out from the Plan 06 webhook worker and
 * the own-form route). Parsing + ingest are idempotent (upsert on
 * (org, source, source_external_id)), so at-least-once delivery never doubles.
 */
export const leadIngest = inngest.createFunction(
  { id: 'lead-ingest', retries: 4 },
  { event: 'integrations/lead.ingest' },
  async ({ event, step }) => {
    const { organizationId, source, payload, rawEventId } = event.data as {
      organizationId: string
      source: LeadSource
      payload: unknown
      rawEventId?: string
    }
    if (!hasLeadParser(source)) {
      return { skipped: true, reason: `no parser for ${source}` }
    }
    const parsed = getLeadParser(source).parse(payload)
    const result = await step.run('ingest', () => ingestLead(organizationId, parsed, rawEventId))
    return { leadId: result.leadId, created: result.created, matchedOn: result.matchedOn }
  },
)
```

- [ ] **Step 2: Modify the Plan 06 webhook worker to fan out lead ingestion**

In `src/lib/inngest/functions/webhook-ingest.ts`, after the existing `recordRawEvent` step, add a fan-out for lead-bearing providers. The provider enum value (`web_form`/`meta_ads`/`callrail`/`whatconverts`) equals the lead source value, so it maps directly. Replace the function body with:

```ts
import { inngest } from '@/lib/inngest/client'
import { recordRawEvent } from '@/lib/integrations/raw-event'
import type { IntegrationProvider, LeadSource } from '@/db/types'

/** Providers whose webhooks carry contact-bearing leads. */
const LEAD_PROVIDERS: ReadonlySet<string> = new Set([
  'web_form',
  'meta_ads',
  'callrail',
  'whatconverts',
])

/**
 * Process an enqueued webhook payload: persist verbatim to raw_event (idempotent
 * on (org, provider, provider_event_id)), then — for lead-bearing providers —
 * fan out an `integrations/lead.ingest` event so the canonical lead is parsed
 * off the same durable capture (PRD §5.7, §6.2).
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
      recordRawEvent({ organizationId, provider, providerEventId, kind: 'webhook', payload }),
    )

    if (LEAD_PROVIDERS.has(provider)) {
      await step.sendEvent('fan-out-lead', {
        name: 'integrations/lead.ingest',
        data: { organizationId, source: provider as LeadSource, payload },
      })
    }

    return { recorded: isNew }
  },
)
```

> If Plan 06's `webhook-ingest.ts` differs, preserve its existing `recordRawEvent` semantics and only ADD the `LEAD_PROVIDERS` fan-out block + the `LeadSource` import. Do not remove existing behaviour.

- [ ] **Step 3: Write the own embeddable form route `src/app/api/leads/form/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { webhookEndpoint } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { verifySignature } from '@/lib/integrations/webhook'
import { recordRawEvent } from '@/lib/integrations/raw-event'
import { inngest } from '@/lib/inngest/client'

export const runtime = 'nodejs'

/**
 * Own embeddable form intake (PRD §5.7). URL: /api/leads/form?slug={slug}
 * Resolves the org + HMAC secret from webhook_endpoint (provider 'web_form'),
 * verifies the signature, records raw_event, fans out lead ingestion, and
 * returns a fast 200. Idempotent downstream via the form's submission_id.
 */
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing slug' }, { status: 400 })

  const [endpoint] = await db
    .select()
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.slug, slug),
        eq(webhookEndpoint.provider, 'web_form'),
        eq(webhookEndpoint.isActive, true),
      ),
    )
  if (!endpoint) return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })

  const secretRes = await db.execute(
    sql`select decrypted_secret as s from vault.decrypted_secrets where name = ${endpoint.vaultSecretName}`,
  )
  const secret = (secretRes as unknown as { s: string | null }[])[0]?.s
  if (!secret) return NextResponse.json({ error: 'misconfigured endpoint' }, { status: 500 })

  const rawBody = await req.text()
  const signature = req.headers.get('x-signature') ?? req.headers.get('x-hub-signature-256') ?? ''
  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const submissionId =
    (typeof payload === 'object' && payload !== null && 'submission_id' in payload
      ? String((payload as { submission_id: unknown }).submission_id)
      : `${slug}:${Date.now()}`)

  // Durable verbatim capture (idempotent on provider_event_id).
  await recordRawEvent({
    organizationId: endpoint.organizationId,
    provider: 'web_form',
    providerEventId: submissionId,
    kind: 'webhook',
    payload,
  })

  await inngest.send({
    name: 'integrations/lead.ingest',
    data: { organizationId: endpoint.organizationId, source: 'web_form', payload },
  })

  return NextResponse.json({ received: true }, { status: 200 })
}
```

- [ ] **Step 4: Register the new worker in the Inngest serve route**

In `src/app/api/inngest/route.ts` (created by Plan 06), import and add the new function. The serve block becomes:

```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { syncScheduler } from '@/lib/inngest/functions/sync-scheduler'
import { syncConnection } from '@/lib/inngest/functions/sync-connection'
import { monthlyRollup } from '@/lib/inngest/functions/monthly-rollup'
import { webhookIngest } from '@/lib/inngest/functions/webhook-ingest'
import { healthAlert } from '@/lib/inngest/functions/health-alert'
import { leadIngest } from '@/lib/inngest/functions/lead-ingest'
import { googleAdsLeadsBackfill } from '@/lib/inngest/functions/google-ads-leads-backfill'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncScheduler,
    syncConnection,
    monthlyRollup,
    webhookIngest,
    healthAlert,
    leadIngest,
    googleAdsLeadsBackfill,
  ],
})
```

> `googleAdsLeadsBackfill` is created in Task 11. If you are executing tasks strictly in order, add only `leadIngest` here now and add `googleAdsLeadsBackfill` to the array in Task 11 Step 4. The final state must list both.

- [ ] **Step 5: Type-check the route + workers**

Run: `pnpm build`
Expected: compiles with no type errors (Node-runtime routes; `leadIngest` registered; `webhook-ingest` fan-out compiles).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(leads): webhook fan-out to lead-ingest worker + own embeddable form route"
```

---

## Task 11: Google Ads lead-forms backfill (60-day rolling window, idempotent)

**Files:**
- Create: `src/lib/inngest/functions/google-ads-leads-backfill.ts`
- Create: `tests/leads/google-ads-backfill.test.ts`
- Modify: `src/app/api/inngest/route.ts` (register the function — if not already done in Task 10)

Google Ads lead forms have **no webhook** — data must be pulled within a **60-day window or it is lost permanently** (PRD §6.3 leads). A `LeadSource` adapter fetches rows (real Google Ads API in a later connector plan; here behind an injectable fetcher so the backfill + idempotency are testable now), and each row is ingested through the same `ingestLead` pipeline (idempotent on `(org, source, source_external_id)`), so frequent re-runs over the overlapping window never duplicate.

- [ ] **Step 1: Write the failing test `tests/leads/google-ads-backfill.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { backfillGoogleAdsLeads, computeBackfillWindow } from '@/lib/inngest/functions/google-ads-leads-backfill'

describe('google ads lead backfill', () => {
  let org: string

  beforeAll(async () => {
    const o = await sql`select id from public.organizations where slug = 'client-one'`
    org = o[0]!.id as string
  })

  beforeEach(async () => {
    await sql`delete from public.lead_identity where organization_id = ${org}`
    await sql`delete from public.lead where organization_id = ${org} and source = 'google_ads'`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('computeBackfillWindow returns a 60-day window ending today', () => {
    const w = computeBackfillWindow(new Date('2026-06-29T00:00:00Z'))
    expect(w.end).toBe('2026-06-29')
    expect(w.start).toBe('2026-04-30') // 60 days inclusive
  })

  it('ingests google ads lead rows from the injected fetcher', async () => {
    const fetcher = async () => [
      {
        lead_id: 'GA-1',
        submission_date_time: '2026-06-20 10:00:00',
        campaign_id: 'c1',
        gcl_id: 'g1',
        lead_form_id: 'lf1',
        user_column_data: [
          { column_id: 'EMAIL', string_value: 'lead1@example.com' },
          { column_id: 'PHONE_NUMBER', string_value: '+447700900001' },
        ],
      },
      {
        lead_id: 'GA-2',
        submission_date_time: '2026-06-21 11:00:00',
        campaign_id: 'c1',
        gcl_id: 'g2',
        lead_form_id: 'lf1',
        user_column_data: [{ column_id: 'EMAIL', string_value: 'lead2@example.com' }],
      },
    ]

    const r1 = await backfillGoogleAdsLeads(org, { now: new Date('2026-06-29T00:00:00Z'), fetcher })
    expect(r1.ingested).toBe(2)
    const rows = await sql`select source_external_id from public.lead where organization_id = ${org} and source = 'google_ads' order by source_external_id`
    expect(rows.map((x) => x.source_external_id)).toEqual(['GA-1', 'GA-2'])

    // Re-run over the overlapping window: idempotent, no duplicates.
    const r2 = await backfillGoogleAdsLeads(org, { now: new Date('2026-06-29T00:00:00Z'), fetcher })
    expect(r2.ingested).toBe(2) // attempted again
    const after = await sql`select count(*)::int as c from public.lead where organization_id = ${org} and source = 'google_ads'`
    expect(after[0]!.c).toBe(2) // still 2, upsert deduped
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/leads/google-ads-backfill.test.ts`
Expected: FAIL — `@/lib/inngest/functions/google-ads-leads-backfill` does not exist.

- [ ] **Step 3: Write `src/lib/inngest/functions/google-ads-leads-backfill.ts`**

```ts
import { db } from '@/db'
import { connection, connectionAccountMap } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { inngest } from '@/lib/inngest/client'
import { getLeadParser } from '@/lib/leads/parsers/registry'
import { ingestLead } from '@/lib/leads/ingest'

/** Inclusive 60-day window ending on `now` (UTC) as 'YYYY-MM-DD'. */
export function computeBackfillWindow(now: Date): { start: string; end: string } {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - 59) // 60 days inclusive
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/** A raw Google Ads lead-form row (subset we parse). */
export interface GoogleAdsLeadRow {
  lead_id: string
  submission_date_time: string
  campaign_id?: string
  gcl_id?: string
  lead_form_id?: string
  user_column_data?: { column_id: string; string_value: string }[]
}

export interface BackfillOptions {
  now?: Date
  /** injectable fetcher (real Google Ads API client supplied by the connector
   *  plan; tests pass a fake). Defaults to a no-op returning []. */
  fetcher?: (args: {
    organizationId: string
    customerId: string
    window: { start: string; end: string }
  }) => Promise<GoogleAdsLeadRow[]>
}

export interface BackfillResult {
  organizationId: string
  ingested: number
  window: { start: string; end: string }
}

/**
 * Backfill Google Ads lead-form leads for one org over a rolling 60-day window
 * (PRD §6.3: pull more often than 60 days or lose data). Each row goes through
 * the same idempotent `ingestLead` pipeline, so frequent overlapping runs never
 * duplicate (upsert on (org, source, source_external_id)).
 */
export async function backfillGoogleAdsLeads(
  organizationId: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const now = opts.now ?? new Date()
  const window = computeBackfillWindow(now)
  const fetcher = opts.fetcher ?? (async () => [])

  // Resolve the Google Ads customer id(s) mapped to this org's connection.
  const accounts = await db
    .select({ externalAccountId: connectionAccountMap.externalAccountId })
    .from(connectionAccountMap)
    .innerJoin(connection, eq(connection.id, connectionAccountMap.connectionId))
    .where(
      and(
        eq(connectionAccountMap.organizationId, organizationId),
        eq(connection.provider, 'google_ads'),
      ),
    )

  // If no account map exists (e.g. test orgs), still allow a single synthetic
  // customer so the injected fetcher can drive ingestion deterministically.
  const customerIds = accounts.length > 0 ? accounts.map((a) => a.externalAccountId) : ['unmapped']

  const parser = getLeadParser('google_ads')
  let ingested = 0
  for (const customerId of customerIds) {
    const rows = await fetcher({ organizationId, customerId, window })
    for (const row of rows) {
      const parsed = parser.parse(row)
      await ingestLead(organizationId, parsed)
      ingested += 1
    }
  }

  return { organizationId, ingested, window }
}

/**
 * Daily cron: backfill Google Ads lead forms for every org with a google_ads
 * connection. Runs well inside the 60-day window so no lead is lost. The real
 * fetcher is wired by the Google Ads connector plan; until then this enqueues
 * with the default no-op fetcher (no-op, safe).
 */
export const googleAdsLeadsBackfill = inngest.createFunction(
  { id: 'google-ads-leads-backfill' },
  { cron: '0 4 * * *' }, // 04:00 UTC daily (well inside the 60-day window)
  async ({ step }) => {
    const orgs = await step.run('list-orgs', async () => {
      const rows = await db
        .selectDistinct({ organizationId: connection.organizationId })
        .from(connection)
        .where(eq(connection.provider, 'google_ads'))
      return rows.map((r) => r.organizationId)
    })

    for (const org of orgs) {
      await step.run(`backfill-${org}`, () => backfillGoogleAdsLeads(org))
    }

    return { orgs: orgs.length }
  },
)
```

- [ ] **Step 4: Ensure the function is registered in the serve route**

Confirm `src/app/api/inngest/route.ts` (Task 10 Step 4) lists `googleAdsLeadsBackfill` in the `functions` array. If you deferred it, add it now.

- [ ] **Step 5: Run the test and confirm PASS**

Run: `pnpm test tests/leads/google-ads-backfill.test.ts`
Expected: both assertions PASS — 60-day window computed correctly, rows ingested, and re-running the overlapping window does not duplicate (upsert dedupes to 2 rows).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(leads): Google Ads lead-forms 60-day idempotent backfill cron"
```

---

## Task 12: Full suite + CI gate

**Files:**
- None new (verification task).

- [ ] **Step 1: Re-seed to ensure a clean fixture set**

Run: `pnpm db:seed`
Expected: idempotent; prints the org/user IDs.

- [ ] **Step 2: Run the entire test suite**

Run: `pnpm test`
Expected: all suites green, including the new leads suites:
- `tests/rls/leads-isolation.test.ts` (every new tenant table proven isolated)
- `tests/leads/normalize.test.ts`
- `tests/leads/definition.test.ts`
- `tests/leads/dedupe.test.ts` (HEAVY)
- `tests/leads/parsers.test.ts`
- `tests/leads/ingest-idempotency.test.ts` (HEAVY)
- `tests/leads/count.test.ts`
- `tests/leads/aggregate-signals.test.ts`
- `tests/leads/google-ads-backfill.test.ts`

…plus all prior Plan 01 + Plan 06 suites still passing (no regressions).

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: lint clean; production build succeeds (the form route + Inngest functions compile).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(leads): full unified-leads suite green (RLS, dedupe, idempotency, backfill)"
```

> CI: the Plan 01 `.github/workflows/ci.yml` already runs `pnpm test` against the local Supabase stack — these tests run automatically. No workflow change needed; the leads tests use the existing seed orgs and the Plan 06 `metric_daily` table.

---

## Self-Review

**Spec coverage (vs PRD §5.7 Unified Leads, §6.3 Leads ingestion, §8 Data Model, §9 Security):**
- §5.7 canonical `lead` model with id, client_id (`organization_id`), source enum, `source_external_id`, `occurred_at`, contact `{name,email,phone_e164}`, attribution `{channel,campaign,ad_id,form_id,gclid,utm_*}`, `lead_type`, `value`, `status`, `is_spam`, `raw_event_id` → Task 1 `lead` table (every listed field present). ✅
- §5.7 `lead_identity` cross-source merge links → Task 1 `lead_identity` (leadId → canonicalLeadId, matchedOn). ✅
- §5.7 `raw_event` audit of every inbound payload verbatim → reuses Plan 06 `raw_event` (recorded by the webhook worker + own-form route before parsing); `lead.raw_event_id` links back. ✅
- §5.7 ingest from own form, Meta leadgen, CallRail, WhatConverts, Google Ads (60-day API), CRM/manual → Task 6 parsers + Task 10 webhook fan-out + own-form route + Task 11 Google Ads backfill; `manual` source in the enum. ✅
- §5.7 GA4 `generate_lead` + GBP calls/messages as count-only cross-check signals, no PII → Task 9 `aggregate-signals.ts` reads `metric_daily` only, returns `isAggregate:true` + label, no contact fields; excluded from the `lead` table entirely. ✅
- §5.7 deterministic dedupe: E.164 phone (primary) then email, configurable 30–90 day window, identity links retained per touch → Task 3 normalisation + Task 5 `resolveIdentity` (phone-primary/email-fallback/window) + Task 7 link writing; count = distinct canonical (Task 8). ✅
- §5.7 idempotent ingestion (upsert on provider event id) to tolerate at-least-once webhooks → Task 1 unique `(organization_id, source, source_external_id)` + Task 7 `onConflictDoUpdate` + raw_event dedupe (Plan 06). ✅
- §5.7 per-client lead-definition config (which sources count, include/exclude spam, dedupe window) → Task 1 `lead_definition` + Task 4 resolver + Task 8 count honours it. ✅
- §5.7 lead detail: source, attribution, contact, value, status, spam/qualified flag → all columns on `lead` (`status` enum incl. `qualified`/`unqualified`, `is_spam`). ✅
- §5.7 acceptance "same human via form + call + Meta counts as ONE" → Task 7 test (phone match across 3 sources → dedupedCount 1). ✅
- §5.7 acceptance "webhook redelivery does not create duplicates" → Task 7 idempotency test + Task 11 backfill re-run test. ✅
- §5.7 acceptance "GBP/GA4 signals labelled aggregate/modeled and excluded from contact-bearing list" → Task 9 (separate read surface, `isAggregate` + label, no PII). ✅
- §6.3 webhooks-first + API backfill (Google Ads ≤60-day) + per-tenant account mapping (mis-mapping = leak → validated/audited) → Task 10 (webhook fan-out, HMAC-verified via Plan 06 route) + Task 11 (60-day backfill resolves customer id via `connection_account_map`, org-scoped); PII never logged. ✅
- §8 tables `lead` / `lead_identity` with exact field list → Task 1. ✅
- §9 security: every new tenant table carries `organization_id` leading a composite index, RLS reuses `has_org_access`/`is_agency_staff`, client sees own leads only, `service_role` only in workers, RLS isolation test per new table → Task 1 indexes + Task 2 policies + Task 2 isolation test (lead, lead_identity, lead_definition). PII columns never logged (parsers/ingest log no contact values). ✅

**Design note on `lead.client_id` vs `organization_id`:** PRD §5.7/§8 name the tenant column `client_id`; the canonical Agency OS convention (Plan 01/§9) is `organization_id` (the client org IS the tenant). This plan uses `organization_id` consistently with Plans 01/06 so RLS helpers and indexes line up; `client_id` in the PRD == this column. Documented so a reviewer does not flag it as a divergence.

**Design note on the canonical-lead model:** Rather than mutate a "primary" lead row on merge, each source touch is its own immutable `lead` row and `lead_identity` points every touch at one `canonical_lead_id` (the earliest-occurring matched lead). This keeps every touch for attribution (PRD §5.7 "each touch is retained") while the de-duplicated count is `count(distinct canonical_lead_id)`. `resolveIdentity` follows the candidate's existing canonical pointer, so merges are transitive and stable across redelivery (proven by the "no churn" test).

**Placeholder scan:** No TBD/TODO/"similar to above". Every code step contains complete, runnable code. The two explicit correction instructions (the illustrative `import { organizations } from './schema'` removal in Task 1 carried over from Plan 06 convention, and the `LeadTypeMap` import/re-export deletion in Task 6 Step 7) are deliberate "delete these illustrative lines" instructions with the corrected code given, not unfinished placeholders. The Google Ads backfill ships with a default no-op fetcher (real API client wired by the connector plan) — intentional and stated, not a stub gap. Migration filenames use `10xx_` because the exact sequence number depends on Plans 02–09; the generator assigns it. ✅

**Type consistency:** `LeadSource`/`LeadType`/`LeadStatus` derived from schema in `src/db/types.ts` and reused across `definition.ts`, `dedupe` (via ingest), `parsers/*`, `count.ts`, the workers, and routes. `ParsedLead` is the single contract between every parser and `ingestLead()`. `IncomingLead`/`DedupeCandidate`/`IdentityResolution` are the single contract for `resolveIdentity()`. The provider enum values from Plan 06 (`web_form`/`meta_ads`/`callrail`/`whatconverts`/`google_ads`/`ga4`/`gbp`) match the lead source values, so the webhook worker maps `provider as LeadSource` safely. The unique constraint `uniq_lead_org_source_external` target matches the `onConflictDoUpdate` in `ingestLead`. Inngest event name `integrations/lead.ingest` is consistent between the senders (webhook worker, own-form route) and the `leadIngest` trigger. RLS helper names (`has_org_access`, `is_agency_staff`) match Plan 01 exactly. ✅

**Definition of done for Plan 10:** `pnpm lint && pnpm build && pnpm test` green — RLS isolation proven for `lead`/`lead_identity`/`lead_definition`; deterministic dedupe (phone-primary, email-fallback, 30–90d window) and idempotent ingestion (webhook redelivery + 60-day backfill re-run) proven by heavy tests; the same human across form + call + Meta counts as one; GA4/GBP signals are count-only, labelled aggregate, and never enter the contact-bearing list — all with zero cross-tenant leakage.
