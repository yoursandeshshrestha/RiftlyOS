# Agency OS — Plan 16: Contracts, Proposals & E-sign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a won deal into a signed agreement and an active client (PRD §5.10). Deliver a tenant-scoped data model for proposal/contract **templates** (with merge fields), **contracts** generated from a deal, a **built-in click-to-sign** e-signature flow with full audit metadata (who / when / IP / user-agent), an immutable **signed PDF** rendered with `@react-pdf/renderer` and stored in Supabase Storage behind expiring signed URLs, and a `signature_event` audit trail. On signature the system **auto-creates/activates the client + retainer subscription and optionally the first invoice**, transactionally and idempotently. The e-sign implementation is built behind an `ESignProvider` seam so a third-party provider (DocuSign/Dropbox Sign) can drop in later as v2; **built-in click-to-sign is the v1 (PRD §5.10: "a built-in click-to-sign with audit metadata … pick during design")**. Every new tenant-scoped table gets an RLS isolation test using the Plan 01 harness, and the signature → client/retainer activation flow is tested end-to-end.

**Architecture:** Three new tables — `contract_template`, `contract`, `signature_event` — all keyed on `organization_id` and protected by RLS that reuses the Plan 01 helpers `public.has_org_access(uuid)` and `public.is_agency_staff()`.

- `contract_template` is **agency-owned** (its `organization_id` = the agency org id) and **staff-only** (read + write via `public.is_agency_staff()`), like `deal`/`deal_stage` in Plan 02. A template stores a markdown/HTML body containing `{{merge_field}}` tokens and a typed list of the merge fields it expects.
- `contract` carries a **dual-tenant** shape that mirrors how Plan 02 handles `client`: its `organization_id` is the **client organization id** (the client-type org the contract will activate), so the eventual client can read their own signed contract in the portal, while writes (generate, send) stay agency-staff-only. The originating deal is referenced by `deal_id` and the activated client by `client_id` (both nullable until set). Rendered merge data is frozen into `merge_data` (jsonb) and the resolved body into `rendered_body` at send time, so the document the client signs is immutable.
- `signature_event` is the append-only audit trail per contract (events: `viewed`, `signed`, `declined`, `voided`) capturing actor, signer name/email, IP, user-agent, and a SHA-256 hash of the exact bytes signed. It is **read** via `public.has_org_access(organization_id)` (staff + the owning client see it) but has **no authenticated insert/update/delete policy** — events are written server-side by a `service_role` connection (the same pattern Plan 05 uses for `audit_event`), so the trail can never be forged or mutated by a user.

The signing surface is a **tokenised public route** `/sign/[token]` (no login required — clients sign from an emailed link), guarded by a single-use, expiring, cryptographically-random `sign_token` on the contract. The route reads/writes only via a server action that runs under `service_role` and validates the token; it never trusts the browser. On a valid click-to-sign the action: (1) renders the immutable signed PDF and uploads it to the `contracts` Storage bucket, (2) appends a `signature_event` of type `signed` with the audit metadata, (3) flips the contract to `signed`, (4) runs **`activateFromContract()`** which — in one DB transaction, idempotent on `contract.activated_at` — creates/reuses the `client` profile (Plan 02), creates/activates the retainer `subscription` (Plan 04), optionally creates the first `invoice` + `line_item` (Plan 04), and writes a `audit_event` (Plan 05). A Resend email (Plan 02) sends the signing link and the countersigned copy.

`@react-pdf/renderer` runs server-side (Node runtime) to produce the bytes; the bytes are hashed before upload so `signature_event.document_hash` proves exactly what was signed (PRD §5.10 acceptance: "A signed contract produces an immutable PDF + audit record"). The dashboard/portal never calls Stripe or external APIs on render — only our stored rows.

**Tech Stack:** Next.js 16 (App Router, TS strict; Server Components + Route/Server Actions, `nodejs` runtime for PDF) · Drizzle ORM + drizzle-kit · postgres.js · Supabase Postgres + Auth + Storage (Plan 01 helpers `public.has_org_access(uuid)`, `public.is_agency_staff()`) · `@react-pdf/renderer` (server-side PDF) · Resend (signing-link + countersigned email, via Plan 02 `sendEmail`) · Node `crypto` (token + document hash) · Tailwind + shadcn/ui · Vitest (RLS isolation + merge-field unit tests + the signature→activation integration test, all via the Plan 01 `tests/helpers/db.ts` harness).

**Depends on:** **Plan 02** (Clients + CRM + shared infra) — the `client` table/profile and its `organization_id` convention, the `deal`/`deal_stage` tables, the Inngest client at `src/lib/inngest/client.ts` (exported `inngest`), the Resend wrapper at `src/lib/email/resend.ts` exporting `sendEmail({ to, subject, html })`, and the `convertWonDeal` action shape in `src/lib/crm/actions.ts`. Also assumed present from the suite (referenced by import path; alias if your build differs): **Plan 04** finance tables `subscriptions`, `invoices`, `lineItems`, `customers` (`src/db/schema.ts`) for retainer/first-invoice activation; **Plan 05** `recordAuditEvent(...)` at `src/lib/audit/record.ts`. Do **not** redefine any of these. From **Plan 01**: `organizations`/`profiles`/`memberships`, `org_type`/`app_role` enums, `public.has_org_access()`/`public.is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`), the Drizzle client `src/db/index.ts`, and `getSession()`/`isStaff()` in `src/lib/auth.ts`.

> **Tenant-column note (matches Plan 02/04):** PRD §8 lists these tables with `client_id`. Per the Plan 01/02 convention, the realised tenant column is `organization_id` (the client-type org for `contract`/`signature_event`; the agency org for `contract_template`), used as the leading column of every composite index. The originating deal and activated client are additionally referenced by `deal_id`/`client_id`.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                              # MODIFY: append contract tables/enums
│  │  └─ types.ts                               # MODIFY: append inferred row types
│  ├─ lib/
│  │  └─ contracts/
│  │     ├─ merge.ts                            # pure: merge-field extract + render (unit-tested)
│  │     ├─ tokens.ts                           # pure-ish: sign-token + document-hash helpers
│  │     ├─ pdf.tsx                             # @react-pdf/renderer document → Buffer
│  │     ├─ storage.ts                          # Supabase Storage upload + signed URL (service-role)
│  │     ├─ esign.ts                            # ESignProvider seam + BuiltInClickToSign v1
│  │     ├─ queries.ts                          # server-only reads (list/detail/by-token)
│  │     ├─ actions.ts                          # staff actions: create template, generate, send
│  │     └─ activate.ts                         # signature → client/retainer/invoice (TX, idempotent)
│  ├─ components/contracts/
│  │  ├─ template-list.tsx                      # staff: templates table
│  │  ├─ contract-list.tsx                      # staff: contracts table
│  │  ├─ generate-contract-form.tsx            # staff: generate from a deal
│  │  └─ sign-pad.tsx                           # public click-to-sign UI (client component)
│  └─ app/
│     ├─ (internal)/contracts/page.tsx          # staff contracts + templates route
│     ├─ (internal)/contracts/actions.ts        # thin route → lib/contracts/actions wrappers
│     └─ sign/[token]/
│        ├─ page.tsx                            # public tokenised signing page (no auth)
│        └─ actions.ts                          # public sign action (service-role, token-guarded)
├─ drizzle/
│  ├─ 00NN_contracts.sql                        # generated (tables/enums)
│  └─ 00NN_contracts_rls.sql                    # custom (RLS + policies + storage bucket + seed template)
├─ scripts/seed-contracts.ts                    # idempotent demo template + draft contract (for tests)
└─ tests/
   ├─ rls/contracts-isolation.test.ts           # KEYSTONE: RLS for every new tenant table
   ├─ contracts/merge.test.ts                    # merge-field extract/render unit tests
   ├─ contracts/tokens.test.ts                   # token + document-hash unit tests
   └─ contracts/activate.test.ts                 # signature → client/retainer/invoice (TX, idempotent)
```

> The migration numbers `00NN` are placeholders: use the next two free numbers in `drizzle/` after the plans already applied in your build (e.g. if Plan 09 ended at `0018`, these become `0019_contracts.sql` and `0020_contracts_rls.sql`). `pnpm db:generate` assigns the generated number; the custom one is named explicitly in its command.

---

## Task 1: Add the PDF dependency and the contracts seed-script entry

**Files:**
- Modify: `package.json` (deps + scripts)

- [ ] **Step 1: Install `@react-pdf/renderer`**

Run:
```bash
pnpm add @react-pdf/renderer
```
Expected: `@react-pdf/renderer` is added to `dependencies`. (Node `crypto` and the Supabase client are already available from Plan 01; Resend/Inngest from Plan 02.)

- [ ] **Step 2: Add the contracts seed script entry to `package.json`**

Add to the `"scripts"` block (alongside the existing `db:seed` / `db:seed:crm`):
```json
{
  "db:seed:contracts": "tsx scripts/seed-contracts.ts"
}
```

- [ ] **Step 3: Verify install**

Run: `pnpm install`
Expected: lockfile resolves cleanly, no peer-dependency errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(contracts): add @react-pdf/renderer + contracts seed script entry"
```

---

## Task 2: Extend the schema — contract_template, contract, signature_event

**Files:**
- Modify: `src/db/schema.ts` (append)
- Modify: `src/db/types.ts` (append)
- Create: `drizzle/00NN_contracts.sql` (generated)

Field names follow PRD §8 (`contract`, `contract_template`, `signature_event`). All amounts are integer minor units (pence) per the suite convention.

- [ ] **Step 1: Append the contract tables to `src/db/schema.ts`**

Ensure these imports exist at the top of the file (extend the existing `drizzle-orm/pg-core` import — most are already imported by Plans 02/04):
```ts
import {
  pgTable, pgEnum, uuid, text, timestamp, integer,
  boolean, jsonb, index, unique,
} from 'drizzle-orm/pg-core'
```

Append to the **bottom** of `src/db/schema.ts`:
```ts
// ─────────────────────────────────────────────────────────────────────────────
// Plan 16 — Contracts, Proposals & E-sign
// ─────────────────────────────────────────────────────────────────────────────

export const contractStatus = pgEnum('contract_status', [
  'draft', // generated from a deal, not yet sent
  'sent', // signing link issued; awaiting signature
  'viewed', // signer opened the link
  'signed', // countersigned; immutable PDF stored
  'declined', // signer declined
  'void', // cancelled by staff before signing
])

export const signatureEventType = pgEnum('signature_event_type', [
  'viewed',
  'signed',
  'declined',
  'voided',
])

// contract_template = reusable proposal/contract body with {{merge_field}} tokens.
// Agency-owned (organization_id = agency org), staff-only (like deal_stage in Plan 02).
export const contractTemplates = pgTable(
  'contract_template',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // markdown/HTML with {{client_name}}, {{services}}, {{retainer_amount}}, {{term}}, {{scope}} etc.
    body: text('body').notNull(),
    // declared merge fields the body expects (drives the generate form + validation).
    mergeFields: jsonb('merge_fields').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9).
    idxTemplateOrg: index('idx_contract_template_org').on(t.organizationId, t.id),
  }),
)

// contract = an instance generated from a deal. organization_id is the CLIENT org
// (so the eventual client can read it via has_org_access); writes are staff-only.
export const contracts = pgTable(
  'contract',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => contractTemplates.id, {
      onDelete: 'set null',
    }),
    // originating deal (Plan 02) — soft reference (plain uuid) to avoid a cross-plan
    // hard-FK ordering dependency; the generate action keeps it consistent.
    dealId: uuid('deal_id'),
    // activated client profile (Plan 02), set on signature. Soft reference for the
    // same reason; activate.ts keeps it consistent transactionally.
    clientId: uuid('client_id'),
    title: text('title').notNull(),
    status: contractStatus('status').notNull().default('draft'),
    // frozen at send time so the signed document is immutable.
    mergeData: jsonb('merge_data').$type<Record<string, string>>().notNull().default({}),
    renderedBody: text('rendered_body'),
    // retainer terms the contract activates (minor units; drives subscription + invoice).
    retainerAmount: integer('retainer_amount'), // pence/month; null = no retainer
    currency: text('currency').notNull().default('gbp'),
    // whether activation should also create the first invoice (PRD §5.10 "optionally").
    createFirstInvoice: boolean('create_first_invoice').notNull().default(false),
    // single-use, expiring, random token for the public /sign/[token] route.
    signToken: text('sign_token').unique(),
    signTokenExpiresAt: timestamp('sign_token_expires_at', { withTimezone: true }),
    // signed-document provenance.
    signedPdfPath: text('signed_pdf_path'), // Storage object path (bucket: contracts)
    documentHash: text('document_hash'), // sha256 hex of the exact signed bytes
    signerName: text('signer_name'),
    signerEmail: text('signer_email'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    // idempotency guard for activateFromContract(): once set, never re-activate.
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxContractOrgStatus: index('idx_contract_org_status').on(t.organizationId, t.status),
  }),
)

// signature_event = append-only audit trail per contract. organization_id = client org.
// Read via has_org_access; written ONLY by service-role (no authenticated write policy).
export const signatureEvents = pgTable(
  'signature_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    type: signatureEventType('type').notNull(),
    // authenticated staff actor if the event was staff-initiated (void); null for the
    // public signer (we capture signer name/email + network metadata instead).
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    signerName: text('signer_name'),
    signerEmail: text('signer_email'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    // sha256 of the exact bytes the signer saw/signed (set on 'signed').
    documentHash: text('document_hash'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxSigEventOrg: index('idx_signature_event_org').on(t.organizationId, t.contractId),
    idxSigEventContract: index('idx_signature_event_contract').on(t.contractId, t.createdAt),
  }),
)
```

> Note: `contract.dealId`/`contract.clientId` are intentionally plain `uuid` (no `.references`) soft cross-references — exactly the pattern Plan 02 used for `clients.sourceDealId` — so this plan does not introduce a hard-FK ordering dependency on the deal/client rows being present in the same migration. `contract.signToken` is `unique` so token lookup is an index hit and collisions are impossible.

- [ ] **Step 2: Append inferred types to `src/db/types.ts`**

```ts
import type { contractTemplates, contracts, signatureEvents } from './schema'

export type ContractTemplate = typeof contractTemplates.$inferSelect
export type Contract = typeof contracts.$inferSelect
export type SignatureEvent = typeof signatureEvents.$inferSelect

export type ContractStatus = Contract['status']
export type SignatureEventType = SignatureEvent['type']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a `drizzle/00NN_contracts.sql` is created containing the two enums and three tables with their indexes and the `sign_token` unique constraint.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies cleanly. Verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E 'contract|signature_event'
```
Expected: `contract_template`, `contract`, `signature_event` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): contracts schema (contract_template, contract, signature_event)"
```

---

## Task 3: RLS policies + Storage bucket + seed a default template

**Files:**
- Create: `drizzle/00NN_contracts_rls.sql` (custom SQL migration)

`contract_template` is **agency-staff-only** (full CRUD via `public.is_agency_staff()`). `contract` is **read via `public.has_org_access(organization_id)`** (staff + the owning client org) with **staff-only writes**. `signature_event` is **read via `public.has_org_access(organization_id)`** (staff + owning client see the trail) with **no authenticated write policy** — events are written by the service-role sign action (same pattern Plan 05 uses for `audit_event`). We also create the private `contracts` Storage bucket and seed one default template for the agency org.

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=contracts_rls`
Expected: an empty `drizzle/00NN_contracts_rls.sql` is created and registered in the journal.

- [ ] **Step 2: Fill in `drizzle/00NN_contracts_rls.sql`**

```sql
-- ── Tenant-leading indexes are already created by Drizzle (Task 2). ──

-- Enable RLS on every new table.
alter table public.contract_template enable row level security;
alter table public.contract          enable row level security;
alter table public.signature_event   enable row level security;

-- ── contract_template: agency staff only (PRD §3.3 — staff own templates). ──
create policy contract_template_all on public.contract_template
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── contract: read via org access (staff OR owning client); writes staff-only. ──
create policy contract_select on public.contract
  for select using (public.has_org_access(organization_id));
create policy contract_write on public.contract
  for all using (public.is_agency_staff()) with check (public.is_agency_staff());

-- ── signature_event: read via org access; NO authenticated write (service-role only,
--    so the audit trail cannot be forged or mutated by any user). ──
create policy signature_event_select on public.signature_event
  for select using (public.has_org_access(organization_id));

-- ── Private Storage bucket for signed contract PDFs. ──
-- Created idempotently; access is via service-role + short-lived signed URLs only.
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do nothing;

-- Storage RLS: no anon/authenticated object policies are created, so only service_role
-- (which bypasses RLS) can read/write objects. The app hands out time-limited signed
-- URLs server-side (Task 6). This matches the tenant-isolation rule in PRD §9.

-- ── Seed one default proposal/contract template for the agency org. ──
do $$
declare
  v_agency uuid;
begin
  select id into v_agency from public.organizations where type = 'agency' order by created_at limit 1;
  if v_agency is null then
    return; -- no agency org yet; the contracts seed (Task 4) handles it.
  end if;
  if not exists (select 1 from public.contract_template where organization_id = v_agency) then
    insert into public.contract_template (organization_id, name, body, merge_fields) values (
      v_agency,
      'Standard Retainer Agreement',
      'AGENCY OS — SERVICES AGREEMENT' || E'\n\n' ||
      'This agreement is between Milktree Agency and {{client_name}}.' || E'\n\n' ||
      'Services: {{services}}' || E'\n' ||
      'Monthly retainer: {{retainer_amount}}' || E'\n' ||
      'Term: {{term}}' || E'\n\n' ||
      'Scope of work:' || E'\n' ||
      '{{scope}}' || E'\n\n' ||
      'By signing below, {{client_name}} agrees to the terms above.',
      '["client_name","services","retainer_amount","term","scope"]'::jsonb
    );
  end if;
end $$;
```

- [ ] **Step 3: Apply the migration and restart the stack so the bucket registers**

Run:
```bash
pnpm db:migrate
pnpm dlx supabase stop && pnpm dlx supabase start
```
Expected: applies with no errors. Verify the bucket and the seed template:
```bash
psql "$DATABASE_URL" -c "select id, public from storage.buckets where id = 'contracts';"
psql "$DATABASE_URL" -c "select name, merge_fields from public.contract_template order by created_at;"
```
Expected: one private `contracts` bucket; one `Standard Retainer Agreement` template with five merge fields.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(security): RLS for contracts tables + private storage bucket + seed template"
```

---

## Task 4: Contracts demo seed (used by the RLS + activation tests)

**Files:**
- Create: `scripts/seed-contracts.ts`

Builds on the Plan 01 seed (agency org, two client orgs, users) and the Plan 02 deal stages. Adds: ensures the default template exists, and creates one **draft** contract for the `client-two` org wired to retainer terms so the activation test (Task 9) has a fixture. Idempotent like the other seeds.

- [ ] **Step 1: Write `scripts/seed-contracts.ts`**

```ts
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import * as schema from '../src/db/schema'

const db = drizzle(postgres(process.env.DATABASE_URL!, { prepare: false }), { schema })

async function orgIdBySlug(slug: string): Promise<string> {
  const rows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, slug))
  if (!rows[0]) throw new Error(`org not found: ${slug} (run pnpm db:seed first)`)
  return rows[0].id
}

async function main() {
  const agency = await orgIdBySlug('milktree')
  const clientTwoOrg = await orgIdBySlug('client-two')

  // Ensure the default template exists (the RLS migration seeds it, but be safe
  // for environments seeded before that migration ran).
  let template = (
    await db
      .select()
      .from(schema.contractTemplates)
      .where(eq(schema.contractTemplates.organizationId, agency))
  )[0]
  if (!template) {
    ;[template] = await db
      .insert(schema.contractTemplates)
      .values({
        organizationId: agency,
        name: 'Standard Retainer Agreement',
        body: 'Agreement with {{client_name}} for {{services}} at {{retainer_amount}}.',
        mergeFields: ['client_name', 'services', 'retainer_amount', 'term', 'scope'],
      })
      .returning()
  }

  // A draft contract for client-two (the activation-test fixture).
  const existing = await db
    .select()
    .from(schema.contracts)
    .where(
      and(
        eq(schema.contracts.organizationId, clientTwoOrg),
        eq(schema.contracts.title, 'Client Two — Retainer'),
      ),
    )
  if (!existing[0]) {
    await db.insert(schema.contracts).values({
      organizationId: clientTwoOrg,
      templateId: template!.id,
      title: 'Client Two — Retainer',
      status: 'draft',
      mergeData: {
        client_name: 'Client Two Ltd',
        services: 'SEO, Google Ads',
        retainer_amount: '£2,500.00',
        term: '12 months',
        scope: 'Monthly SEO + paid search management.',
      },
      retainerAmount: 250000, // £2,500.00 / month in pence
      currency: 'gbp',
      createFirstInvoice: true,
    })
  }

  console.log('contracts seed complete')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Run the seeds in order**

Run:
```bash
pnpm db:seed
pnpm db:seed:contracts
```
Expected: both succeed; re-running `pnpm db:seed:contracts` prints "contracts seed complete" with no duplicate rows (idempotent).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): idempotent contracts demo seed (template + draft contract)"
```

---

## Task 5: KEYSTONE — RLS isolation tests for every new tenant table (watch them PASS)

**Files:**
- Create: `tests/rls/contracts-isolation.test.ts`

Policies are already applied (Task 3) and rows seeded (Task 4), so these prove isolation holds. Assertions: a **client-two user** sees their own `contract` and its `signature_event`s, but **zero** `contract_template`s (templates are staff-only); a **client-one user** sees **none** of client-two's contracts; a client user **cannot insert/update** a contract; a **founder** sees all templates and contracts.

- [ ] **Step 1: Write `tests/rls/contracts-isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('contracts tenant isolation (RLS)', () => {
  let founder: string
  let clientOneUser: string
  let clientTwoUser: string
  let clientTwoOrg: string
  let contractId: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')

    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    clientTwoOrg = o2!.id as string
    const [c] = await sql`select id from public.contract where organization_id = ${clientTwoOrg} limit 1`
    contractId = c!.id as string

    // Seed one signature_event (service-role bypasses RLS) so read scoping is testable.
    await sql`
      insert into public.signature_event (organization_id, contract_id, type, signer_name, ip_address)
      values (${clientTwoOrg}, ${contractId}, 'viewed', 'Client Two Signer', '203.0.113.7')
      on conflict do nothing
    `
  })

  afterAll(async () => {
    await sql.end()
  })

  it('the contract-owning client user sees ONLY their own contract', async () => {
    const rows = await asUser(clientTwoUser, (tx) => tx`select title from public.contract order by title`)
    expect(rows.map((r) => r.title)).toEqual(['Client Two — Retainer'])
  })

  it('a different client user sees ZERO of those contracts', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select id from public.contract`)
    const leaked = rows.some((r) => r.id === contractId)
    expect(leaked).toBe(false)
  })

  it('a client user sees ZERO contract templates (staff-only)', async () => {
    const rows = await asUser(clientTwoUser, (tx) => tx`select id from public.contract_template`)
    expect(rows.length).toBe(0)
  })

  it('the contract owner can READ its signature_event trail', async () => {
    const rows = await asUser(
      clientTwoUser,
      (tx) => tx`select type from public.signature_event where contract_id = ${contractId}`,
    )
    expect(rows.some((r) => r.type === 'viewed')).toBe(true)
  })

  it('NO authenticated user can INSERT a signature_event (service-role only)', async () => {
    await expect(
      asUser(
        clientTwoUser,
        (tx) => tx`
          insert into public.signature_event (organization_id, contract_id, type)
          values (${clientTwoOrg}, ${contractId}, 'signed')
        `,
      ),
    ).rejects.toThrow()
  })

  it('a client user CANNOT update a contract (write policy blocks it)', async () => {
    await expect(
      asUser(
        clientTwoUser,
        (tx) => tx`update public.contract set status = 'void' where id = ${contractId}`,
      ),
    ).rejects.toThrow()
  })

  it('the founder sees all templates and contracts', async () => {
    const templates = await asUser(founder, (tx) => tx`select name from public.contract_template`)
    expect(templates.some((t) => t.name === 'Standard Retainer Agreement')).toBe(true)

    const contracts = await asUser(founder, (tx) => tx`select title from public.contract`)
    expect(contracts.some((c) => c.title === 'Client Two — Retainer')).toBe(true)
  })
})
```

> RLS `UPDATE`/`INSERT` with no matching policy returns **zero affected rows** rather than raising in some Postgres paths. To make the negative assertions robust, the policies in Task 3 grant clients **no** write policy on `contract`/`signature_event` at all — so these statements are denied. If a `rejects.toThrow()` assertion does not fire because the statement affected 0 rows silently, change that assertion to read the row back and assert it is unchanged / absent. The seeded data + staff-only write policy guarantee the negative result either way.

- [ ] **Step 2: Run the tests and confirm they PASS**

Run: `pnpm test tests/rls/contracts-isolation.test.ts`
Expected: all assertions PASS (policies from Task 3 enforce isolation; the seed from Task 4 + the inline `signature_event` provide the rows).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(rls): contracts tenant-isolation tests (pass)"
```

---

## Task 6: Merge-field engine + token/hash helpers (pure logic, strict TDD)

**Files:**
- Create: `tests/contracts/merge.test.ts`
- Create: `src/lib/contracts/merge.ts`
- Create: `tests/contracts/tokens.test.ts`
- Create: `src/lib/contracts/tokens.ts`

The merge engine extracts `{{token}}` fields from a template body and renders a body by substituting a data map; rendering is what freezes the immutable document. The token helpers mint the single-use sign token and hash the exact signed bytes. We TDD all of these as pure functions.

- [ ] **Step 1: Write the failing test `tests/contracts/merge.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { extractMergeFields, renderMergeBody, missingMergeFields } from '@/lib/contracts/merge'

describe('extractMergeFields', () => {
  it('finds unique {{field}} tokens in declaration order', () => {
    const body = 'Hi {{client_name}}, your {{services}} retainer is {{retainer_amount}}. — {{client_name}}'
    expect(extractMergeFields(body)).toEqual(['client_name', 'services', 'retainer_amount'])
  })

  it('tolerates inner whitespace and ignores non-token braces', () => {
    expect(extractMergeFields('{{ term }} and { not_a_token } and {{scope}}')).toEqual(['term', 'scope'])
  })

  it('returns [] when there are no tokens', () => {
    expect(extractMergeFields('no tokens here')).toEqual([])
  })
})

describe('renderMergeBody', () => {
  it('substitutes every token with its data value', () => {
    const body = 'Hi {{client_name}}, retainer {{retainer_amount}}.'
    const out = renderMergeBody(body, { client_name: 'Acme Ltd', retainer_amount: '£2,500.00' })
    expect(out).toBe('Hi Acme Ltd, retainer £2,500.00.')
  })

  it('replaces ALL occurrences of a repeated token', () => {
    const out = renderMergeBody('{{x}}-{{x}}', { x: 'A' })
    expect(out).toBe('A-A')
  })

  it('leaves an unknown token as an empty string (never leaks the raw token)', () => {
    expect(renderMergeBody('a {{missing}} b', {})).toBe('a  b')
  })
})

describe('missingMergeFields', () => {
  it('returns required fields absent or blank in the data map', () => {
    const body = '{{a}} {{b}} {{c}}'
    expect(missingMergeFields(body, { a: 'x', b: '' })).toEqual(['b', 'c'])
  })

  it('returns [] when every field is present and non-blank', () => {
    expect(missingMergeFields('{{a}}', { a: 'x' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/contracts/merge.test.ts`
Expected: FAIL — `@/lib/contracts/merge` does not exist yet (module-not-found).

- [ ] **Step 3: Implement `src/lib/contracts/merge.ts`**

```ts
// Merge-field engine for contract templates. A token is {{ field_name }}.
// Pure + deterministic so the rendered body (the immutable signed document) is
// reproducible and unit-testable.

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Unique merge-field names in first-seen order. */
export function extractMergeFields(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of body.matchAll(TOKEN_RE)) {
    const name = m[1]!
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** Replace every {{field}} with data[field]; unknown/blank tokens become ''. */
export function renderMergeBody(body: string, data: Record<string, string>): string {
  return body.replace(TOKEN_RE, (_full, name: string) => data[name] ?? '')
}

/** Required fields (from the body) that are missing or blank in `data`. */
export function missingMergeFields(body: string, data: Record<string, string>): string[] {
  return extractMergeFields(body).filter((f) => {
    const v = data[f]
    return v === undefined || v.trim() === ''
  })
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/contracts/merge.test.ts`
Expected: all merge tests PASS.

- [ ] **Step 5: Write the failing test `tests/contracts/tokens.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { generateSignToken, hashDocument, isTokenExpired } from '@/lib/contracts/tokens'

describe('generateSignToken', () => {
  it('returns a long, url-safe, unique token each call', () => {
    const a = generateSignToken()
    const b = generateSignToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
  })
})

describe('hashDocument', () => {
  it('is a stable 64-char hex sha256 of the bytes', () => {
    const buf = Buffer.from('the exact signed bytes')
    const h1 = hashDocument(buf)
    const h2 = hashDocument(Buffer.from('the exact signed bytes'))
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes if a single byte changes', () => {
    expect(hashDocument(Buffer.from('a'))).not.toBe(hashDocument(Buffer.from('b')))
  })
})

describe('isTokenExpired', () => {
  it('is false for a future expiry, true for a past one, true for null', () => {
    expect(isTokenExpired(new Date(Date.now() + 60_000))).toBe(false)
    expect(isTokenExpired(new Date(Date.now() - 60_000))).toBe(true)
    expect(isTokenExpired(null)).toBe(true)
  })
})
```

- [ ] **Step 6: Run it and confirm it FAILS**

Run: `pnpm test tests/contracts/tokens.test.ts`
Expected: FAIL — `@/lib/contracts/tokens` does not exist yet.

- [ ] **Step 7: Implement `src/lib/contracts/tokens.ts`**

```ts
import { randomBytes, createHash } from 'node:crypto'

/** Cryptographically-random, url-safe single-use signing token (32 bytes → base64url). */
export function generateSignToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hex digest of the exact signed bytes (document provenance). */
export function hashDocument(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A token with no expiry, or an expiry in the past, is treated as expired. */
export function isTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() <= Date.now()
}
```

- [ ] **Step 8: Run it and confirm it PASSES**

Run: `pnpm test tests/contracts/tokens.test.ts`
Expected: all token tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(contracts): merge-field engine + sign-token/document-hash helpers (tested)"
```

---

## Task 7: PDF renderer, Storage helper, and the e-sign provider seam

**Files:**
- Create: `src/lib/contracts/pdf.tsx`
- Create: `src/lib/contracts/storage.ts`
- Create: `src/lib/contracts/esign.ts`

`pdf.tsx` turns a contract's rendered body + signer metadata into PDF bytes with `@react-pdf/renderer`. `storage.ts` uploads those bytes to the private `contracts` bucket and mints expiring signed URLs (service-role; never browser). `esign.ts` defines the `ESignProvider` interface and the v1 `BuiltInClickToSign` implementation — the seam that lets a third-party provider drop in later.

- [ ] **Step 1: PDF renderer `src/lib/contracts/pdf.tsx`**

```tsx
import 'server-only'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, lineHeight: 1.5, fontFamily: 'Helvetica' },
  title: { fontSize: 16, marginBottom: 16, fontFamily: 'Helvetica-Bold' },
  body: { whiteSpace: 'pre-wrap' as const, marginBottom: 24 },
  sig: { marginTop: 24, borderTop: '1pt solid #000', paddingTop: 8 },
  meta: { fontSize: 9, color: '#555', marginTop: 4 },
})

export type ContractPdfData = {
  title: string
  renderedBody: string
  signerName: string
  signerEmail: string
  signedAt: Date
  ipAddress: string
}

export function ContractPdf({ data }: { data: ContractPdfData }) {
  // Split on newlines so @react-pdf preserves paragraph breaks.
  const lines = data.renderedBody.split('\n')
  return (
    <Document title={data.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.body}>
          {lines.map((line, i) => (
            <Text key={i}>{line.length ? line : ' '}</Text>
          ))}
        </View>
        <View style={styles.sig}>
          <Text>Signed by: {data.signerName} ({data.signerEmail})</Text>
          <Text style={styles.meta}>Signed at: {data.signedAt.toISOString()}</Text>
          <Text style={styles.meta}>Signer IP: {data.ipAddress}</Text>
          <Text style={styles.meta}>
            This document was executed electronically via Agency OS click-to-sign.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

/** Render the signed contract to PDF bytes (Node runtime only). */
export async function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  return renderToBuffer(<ContractPdf data={data} />)
}
```

- [ ] **Step 2: Storage helper `src/lib/contracts/storage.ts`**

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client: bypasses Storage RLS so only the server can
// write/read contract PDFs. Never expose this to the browser (PRD §9).
const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const BUCKET = 'contracts'

/** Upload signed PDF bytes; returns the object path stored on the contract. */
export async function uploadSignedPdf(
  organizationId: string,
  contractId: string,
  bytes: Buffer,
): Promise<string> {
  // Tenant-prefixed path keeps objects organised per client org.
  const path = `${organizationId}/${contractId}.pdf`
  const { error } = await storage.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw error
  return path
}

/** Mint a short-lived signed URL for a stored signed PDF (default 1h). */
export async function signedPdfUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await storage.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error || !data) throw error ?? new Error('failed to create signed URL')
  return data.signedUrl
}
```

- [ ] **Step 3: E-sign provider seam `src/lib/contracts/esign.ts`**

```ts
import 'server-only'
import { generateSignToken } from '@/lib/contracts/tokens'

/**
 * Provider-agnostic e-sign seam. v1 is the built-in click-to-sign that mints a
 * tokenised link we email; the audit trail + immutable PDF are produced by our
 * own flow (Tasks 6–9). A future provider (DocuSign/Dropbox Sign) implements the
 * same interface: `prepare()` returns the URL the signer is sent to, and the
 * provider's webhook drives the `signed` transition instead of our /sign route.
 */
export type PreparedSignature = {
  /** Opaque token persisted on the contract (built-in) or provider envelope id. */
  token: string
  /** Absolute URL the signer visits to sign. */
  signUrl: string
  /** When the link stops working. */
  expiresAt: Date
}

export interface ESignProvider {
  readonly id: string
  prepare(input: { contractId: string; appUrl: string; ttlMs?: number }): PreparedSignature
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14 // 14 days

export const BuiltInClickToSign: ESignProvider = {
  id: 'builtin',
  prepare({ contractId: _contractId, appUrl, ttlMs }) {
    const token = generateSignToken()
    return {
      token,
      signUrl: `${appUrl.replace(/\/$/, '')}/sign/${token}`,
      expiresAt: new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)),
    }
  },
}

/** Active provider (swap here, or read from config, when integrating a vendor). */
export function getESignProvider(): ESignProvider {
  return BuiltInClickToSign
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no type errors in the three new modules. (If `@react-pdf/renderer` JSX needs the React import, it is already imported in `pdf.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(contracts): PDF renderer, storage helper, e-sign provider seam (built-in click-to-sign)"
```

---

## Task 8: Server queries + staff actions (create template, generate from deal, send)

**Files:**
- Create: `src/lib/contracts/queries.ts`
- Create: `src/lib/contracts/actions.ts`

Queries are `server-only` reads used by the route Server Components, running under the user's RLS context via the Plan 01 Drizzle client. Actions are the staff write paths: create a template, generate a contract from a deal (freezing merge data), and send it for signature (minting the token via the provider seam + emailing the link). `getContractByToken` is the only read that runs under service-role (the public signing route is unauthenticated).

- [ ] **Step 1: Write `src/lib/contracts/queries.ts`**

```ts
import 'server-only'
import { and, asc, desc, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { db } from '@/db'
import { contracts, contractTemplates, signatureEvents } from '@/db/schema'
import * as schema from '@/db/schema'
import type { Contract, ContractTemplate, SignatureEvent } from '@/db/types'

export async function listTemplates(orgId: string): Promise<ContractTemplate[]> {
  return db
    .select()
    .from(contractTemplates)
    .where(eq(contractTemplates.organizationId, orgId))
    .orderBy(asc(contractTemplates.name))
}

export async function listContracts(clientOrgId: string): Promise<Contract[]> {
  return db
    .select()
    .from(contracts)
    .where(eq(contracts.organizationId, clientOrgId))
    .orderBy(desc(contracts.createdAt))
}

export type ContractDetail = { contract: Contract; events: SignatureEvent[] }

export async function getContractDetail(
  clientOrgId: string,
  contractId: string,
): Promise<ContractDetail | null> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.organizationId, clientOrgId), eq(contracts.id, contractId)))
  if (!contract) return null
  const events = await db
    .select()
    .from(signatureEvents)
    .where(eq(signatureEvents.contractId, contractId))
    .orderBy(asc(signatureEvents.createdAt))
  return { contract, events }
}

// Service-role read for the unauthenticated /sign/[token] route. Bypasses RLS by
// design (there is no session); the token itself is the authorization.
const tokenClient = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const tokenDb = drizzle(tokenClient, { schema })

export async function getContractByToken(token: string): Promise<Contract | null> {
  const [row] = await tokenDb.select().from(contracts).where(eq(contracts.signToken, token))
  return row ?? null
}
```

- [ ] **Step 2: Write `src/lib/contracts/actions.ts`**

```ts
'use server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { contracts, contractTemplates } from '@/db/schema'
import { extractMergeFields, renderMergeBody, missingMergeFields } from '@/lib/contracts/merge'
import { getESignProvider } from '@/lib/contracts/esign'
import { sendEmail } from '@/lib/email/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function createTemplate(input: {
  orgId: string
  name: string
  body: string
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(contractTemplates)
    .values({
      organizationId: input.orgId,
      name: input.name,
      body: input.body,
      mergeFields: extractMergeFields(input.body),
    })
    .returning({ id: contractTemplates.id })
  return { id: row!.id }
}

/**
 * Generate a draft contract from a template for a target client org, freezing the
 * merge data. Optionally wires the originating deal + retainer terms.
 */
export async function generateContract(input: {
  agencyOrgId: string
  clientOrganizationId: string
  templateId: string
  title: string
  mergeData: Record<string, string>
  dealId?: string
  retainerAmount?: number | null
  currency?: string
  createFirstInvoice?: boolean
}): Promise<{ id: string }> {
  const [template] = await db
    .select()
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.organizationId, input.agencyOrgId),
        eq(contractTemplates.id, input.templateId),
      ),
    )
  if (!template) throw new Error('template not found')

  const missing = missingMergeFields(template.body, input.mergeData)
  if (missing.length) throw new Error(`missing merge fields: ${missing.join(', ')}`)

  const renderedBody = renderMergeBody(template.body, input.mergeData)

  const [row] = await db
    .insert(contracts)
    .values({
      organizationId: input.clientOrganizationId,
      templateId: template.id,
      dealId: input.dealId ?? null,
      title: input.title,
      status: 'draft',
      mergeData: input.mergeData,
      renderedBody,
      retainerAmount: input.retainerAmount ?? null,
      currency: input.currency ?? 'gbp',
      createFirstInvoice: input.createFirstInvoice ?? false,
    })
    .returning({ id: contracts.id })
  return { id: row!.id }
}

/**
 * Send a draft contract for signature: mint the token via the provider seam,
 * persist it + expiry, flip status to 'sent', and email the signing link.
 */
export async function sendForSignature(input: {
  clientOrganizationId: string
  contractId: string
  signerName: string
  signerEmail: string
}): Promise<{ signUrl: string }> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, input.clientOrganizationId),
        eq(contracts.id, input.contractId),
      ),
    )
  if (!contract) throw new Error('contract not found')
  if (!contract.renderedBody) throw new Error('contract has no rendered body to sign')

  const provider = getESignProvider()
  const prepared = provider.prepare({ contractId: contract.id, appUrl: APP_URL })

  await db
    .update(contracts)
    .set({
      status: 'sent',
      signToken: prepared.token,
      signTokenExpiresAt: prepared.expiresAt,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contract.id))

  await sendEmail({
    to: input.signerEmail,
    subject: `Please sign: ${contract.title}`,
    html:
      `<p>Hello ${input.signerName},</p>` +
      `<p>Please review and sign your agreement:</p>` +
      `<p><a href="${prepared.signUrl}">Review &amp; sign “${contract.title}”</a></p>` +
      `<p>This link expires on ${prepared.expiresAt.toUTCString()}.</p>`,
  })

  return { signUrl: prepared.signUrl }
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no type errors. (`sendEmail` is the Plan 02 Resend wrapper at `@/lib/email/resend`; alias if your build differs.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contracts): server queries + staff actions (create template, generate, send for signature)"
```

---

## Task 9: Signature → client/retainer/invoice activation (TX, idempotent) — strict TDD

**Files:**
- Create: `tests/contracts/activate.test.ts`
- Create: `src/lib/contracts/activate.ts`

This is the riskiest action and the heart of PRD §5.10 ("on signature, auto-create/activate the client + retainer and optionally the first invoice"). `activateFromContract()` runs in **one transaction**, is **idempotent on `contract.activated_at`**, and: (1) creates/reuses the `client` profile (Plan 02) for the contract's org, (2) creates the retainer `subscription` row set `active` (Plan 04) when `retainerAmount` is present, (3) optionally creates the first `invoice` + `line_item` (Plan 04) when `createFirstInvoice` is true, (4) links `contract.clientId`, and (5) stamps `activated_at`. We test it directly against the DB (admin/service-role connection — this mirrors how Plan 02 tested `convertWonDeal`).

- [ ] **Step 1: Write the failing test `tests/contracts/activate.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { activateFromContract } from '@/lib/contracts/activate'

describe('activateFromContract', () => {
  let clientTwoOrg: string
  let contractId: string

  beforeAll(async () => {
    const [o2] = await sql`select id from public.organizations where slug = 'client-two'`
    clientTwoOrg = o2!.id as string

    // Clean slate for client-two activation artefacts.
    await sql`delete from public.line_items where organization_id = ${clientTwoOrg}`
    await sql`delete from public.invoices where organization_id = ${clientTwoOrg}`
    await sql`delete from public.subscriptions where organization_id = ${clientTwoOrg}`
    await sql`delete from public.client where organization_id = ${clientTwoOrg}`

    // A fresh signed-but-not-activated contract with retainer + first-invoice on.
    const [c] = await sql`
      insert into public.contract
        (organization_id, title, status, merge_data, rendered_body, retainer_amount,
         currency, create_first_invoice, signer_name, signer_email, signed_at, document_hash)
      values
        (${clientTwoOrg}, 'Client Two — Activation', 'signed', '{}'::jsonb,
         'Body', 250000, 'gbp', true, 'Jane Client', 'jane@clienttwo.com', now(), 'deadbeef')
      returning id`
    contractId = c!.id as string
  })

  afterAll(async () => {
    await sql.end()
  })

  it('creates exactly one client, one active subscription, and one invoice; links + stamps the contract', async () => {
    const r1 = await activateFromContract({ contractId })
    expect(r1.activated).toBe(true)
    expect(r1.clientId).toBeTruthy()

    const clients = await sql`select id from public.client where organization_id = ${clientTwoOrg}`
    expect(clients.length).toBe(1)

    const subs = await sql`select amount, status from public.subscriptions where organization_id = ${clientTwoOrg}`
    expect(subs.length).toBe(1)
    expect(subs[0]!.amount).toBe(250000)
    expect(subs[0]!.status).toBe('active')

    const invoices = await sql`select total, type from public.invoices where organization_id = ${clientTwoOrg}`
    expect(invoices.length).toBe(1)
    expect(invoices[0]!.type).toBe('retainer')
    expect(invoices[0]!.total).toBe(250000)

    const [contract] = await sql`select client_id, activated_at from public.contract where id = ${contractId}`
    expect(contract!.client_id).toBe(r1.clientId)
    expect(contract!.activated_at).not.toBeNull()
  })

  it('is idempotent — activating again creates no second client/subscription/invoice', async () => {
    const r2 = await activateFromContract({ contractId })
    expect(r2.activated).toBe(false)

    const clients = await sql`select id from public.client where organization_id = ${clientTwoOrg}`
    const subs = await sql`select id from public.subscriptions where organization_id = ${clientTwoOrg}`
    const invoices = await sql`select id from public.invoices where organization_id = ${clientTwoOrg}`
    expect(clients.length).toBe(1)
    expect(subs.length).toBe(1)
    expect(invoices.length).toBe(1)
  })

  it('skips the invoice when create_first_invoice is false but still activates the retainer', async () => {
    const [o2] = await sql`select id from public.organizations where slug = 'client-one'`
    const orgOne = o2!.id as string
    await sql`delete from public.invoices where organization_id = ${orgOne}`
    await sql`delete from public.subscriptions where organization_id = ${orgOne}`
    await sql`delete from public.client where organization_id = ${orgOne}`
    const [c] = await sql`
      insert into public.contract
        (organization_id, title, status, merge_data, rendered_body, retainer_amount,
         currency, create_first_invoice, signed_at)
      values
        (${orgOne}, 'Client One — No Invoice', 'signed', '{}'::jsonb, 'Body', 100000,
         'gbp', false, now())
      returning id`
    const res = await activateFromContract({ contractId: c!.id as string })
    expect(res.activated).toBe(true)
    const subs = await sql`select id from public.subscriptions where organization_id = ${orgOne}`
    const invoices = await sql`select id from public.invoices where organization_id = ${orgOne}`
    expect(subs.length).toBe(1)
    expect(invoices.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/contracts/activate.test.ts`
Expected: FAIL — `@/lib/contracts/activate` does not exist yet (module-not-found).

- [ ] **Step 3: Implement `src/lib/contracts/activate.ts`**

```ts
import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { contracts, clients, subscriptions, invoices, lineItems } from '@/db/schema'

export type ActivateResult = { activated: boolean; clientId: string }

/**
 * On signature, create/activate the client + retainer subscription and optionally
 * the first invoice — atomically and idempotently.
 *
 * Idempotent on contract.activatedAt: once stamped, re-calls return activated:false
 * and create nothing new (PRD §5.10 acceptance: signature seeds the retainer; no
 * double entry).
 */
export async function activateFromContract(input: { contractId: string }): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const [contract] = await tx.select().from(contracts).where(eq(contracts.id, input.contractId))
    if (!contract) throw new Error('contract not found')
    if (contract.status !== 'signed') throw new Error('contract is not signed')

    // Idempotency guard — never re-activate.
    if (contract.activatedAt) {
      return { activated: false, clientId: contract.clientId ?? '' }
    }

    const orgId = contract.organizationId

    // 1) Create or reuse the client profile for this client org (Plan 02 `client`).
    const [existingClient] = await tx
      .select()
      .from(clients)
      .where(eq(clients.organizationId, orgId))
    let clientId: string
    if (existingClient) {
      clientId = existingClient.id
    } else {
      const [row] = await tx
        .insert(clients)
        .values({
          organizationId: orgId,
          name: contract.signerName ?? contract.title,
          services: [],
          health: 'good',
          sourceDealId: contract.dealId ?? null,
        })
        .returning({ id: clients.id })
      clientId = row!.id
    }

    // 2) Activate the retainer subscription (Plan 04) when terms are present.
    let subscriptionId: string | null = null
    if (contract.retainerAmount && contract.retainerAmount > 0) {
      const [sub] = await tx
        .insert(subscriptions)
        .values({
          organizationId: orgId,
          provider: 'stripe',
          amount: contract.retainerAmount,
          currency: contract.currency,
          interval: 'month',
          status: 'active',
          currentPeriodStart: new Date(),
        })
        .returning({ id: subscriptions.id })
      subscriptionId = sub!.id
    }

    // 3) Optionally create the first invoice + line item (Plan 04).
    if (contract.createFirstInvoice && contract.retainerAmount && contract.retainerAmount > 0) {
      const [inv] = await tx
        .insert(invoices)
        .values({
          organizationId: orgId,
          type: 'retainer',
          status: 'draft',
          provider: 'stripe',
          subscriptionId,
          currency: contract.currency,
          subtotal: contract.retainerAmount,
          taxTotal: 0,
          total: contract.retainerAmount,
        })
        .returning({ id: invoices.id })
      await tx.insert(lineItems).values({
        organizationId: orgId,
        invoiceId: inv!.id,
        description: `${contract.title} — first month retainer`,
        quantity: 1,
        unitAmount: contract.retainerAmount,
        taxAmount: 0,
      })
    }

    // 4) Link + stamp the contract.
    await tx
      .update(contracts)
      .set({ clientId, activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(contracts.id, contract.id))

    return { activated: true, clientId }
  })
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/contracts/activate.test.ts`
Expected: all three tests PASS (one client/subscription/invoice on first activation; idempotent on re-run; invoice skipped when the flag is false).

> If the test errors with `relation "public.subscriptions" does not exist` or similar, Plan 04 (finance) has not been applied in your build — run its migrations first; this plan references those tables by name per the dependency note. If your finance plan named the table `subscription` (singular), adjust the import and the SQL in the test to match your build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(contracts): signature → client/retainer/invoice activation (TX, idempotent) + impl"
```

---

## Task 10: The public click-to-sign action (service-role, token-guarded) — the e-sign flow

**Files:**
- Create: `src/app/sign/[token]/actions.ts`

This is the v1 e-sign execution path. The action runs under **service-role** (the signer is unauthenticated; the token is the authorization). It validates the token + expiry, renders the immutable PDF, hashes the exact bytes, uploads to Storage, appends the `signature_event` audit rows, flips the contract to `signed`, calls `activateFromContract()`, writes a Plan 05 `audit_event`, and emails the countersigned copy. Because it touches the audit trail and money-relevant activation, it is the single source of truth for "who/when/IP signed".

- [ ] **Step 1: Write `src/app/sign/[token]/actions.ts`**

```ts
'use server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { contracts, signatureEvents } from '@/db/schema'
import { isTokenExpired, hashDocument } from '@/lib/contracts/tokens'
import { renderContractPdf } from '@/lib/contracts/pdf'
import { uploadSignedPdf, signedPdfUrl } from '@/lib/contracts/storage'
import { activateFromContract } from '@/lib/contracts/activate'
import { recordAuditEvent } from '@/lib/audit/record'
import { sendEmail } from '@/lib/email/resend'

// Service-role connection: the signer has no session; the token authorizes the write.
const signClient = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const signDb = drizzle(signClient, { schema })

export type SignInput = {
  token: string
  signerName: string
  signerEmail: string
  ipAddress: string
  userAgent: string
}

export type SignResult =
  | { ok: true; pdfUrl: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_signed' | 'voided' }

/** Record that the signing page was opened (audit: 'viewed'). Best-effort. */
export async function recordView(input: {
  token: string
  ipAddress: string
  userAgent: string
}): Promise<void> {
  const [contract] = await signDb.select().from(contracts).where(eq(contracts.signToken, input.token))
  if (!contract || contract.status === 'signed' || contract.status === 'void') return
  await signDb.insert(signatureEvents).values({
    organizationId: contract.organizationId,
    contractId: contract.id,
    type: 'viewed',
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  })
  if (contract.status === 'sent') {
    await signDb.update(contracts).set({ status: 'viewed' }).where(eq(contracts.id, contract.id))
  }
}

/** Execute the click-to-sign: PDF + hash + storage + audit + activate. */
export async function signContract(input: SignInput): Promise<SignResult> {
  const [contract] = await signDb.select().from(contracts).where(eq(contracts.signToken, input.token))
  if (!contract) return { ok: false, reason: 'not_found' }
  if (contract.status === 'void') return { ok: false, reason: 'voided' }
  if (contract.status === 'signed') return { ok: false, reason: 'already_signed' }
  if (isTokenExpired(contract.signTokenExpiresAt)) return { ok: false, reason: 'expired' }
  if (!contract.renderedBody) return { ok: false, reason: 'not_found' }

  const signedAt = new Date()

  // 1) Render the immutable PDF and hash the exact bytes.
  const bytes = await renderContractPdf({
    title: contract.title,
    renderedBody: contract.renderedBody,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    signedAt,
    ipAddress: input.ipAddress,
  })
  const documentHash = hashDocument(bytes)
  const path = await uploadSignedPdf(contract.organizationId, contract.id, bytes)

  // 2) Flip the contract to signed + freeze provenance.
  await signDb
    .update(contracts)
    .set({
      status: 'signed',
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      signedAt,
      signedPdfPath: path,
      documentHash,
      // burn the token so the link cannot be reused.
      signToken: null,
      updatedAt: signedAt,
    })
    .where(eq(contracts.id, contract.id))

  // 3) Append the immutable 'signed' audit event (who/when/IP/UA/hash).
  await signDb.insert(signatureEvents).values({
    organizationId: contract.organizationId,
    contractId: contract.id,
    type: 'signed',
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    documentHash,
  })

  // 4) Activate client + retainer (+ optional first invoice), idempotently.
  await activateFromContract({ contractId: contract.id })

  // 5) Money/security audit row (Plan 05) + countersigned copy email.
  await recordAuditEvent({
    organizationId: contract.organizationId,
    action: 'contract.signed',
    targetType: 'contract',
    targetId: contract.id,
    after: { signerEmail: input.signerEmail, documentHash },
    ipAddress: input.ipAddress,
  })

  const pdfUrl = await signedPdfUrl(path)
  await sendEmail({
    to: input.signerEmail,
    subject: `Signed: ${contract.title}`,
    html:
      `<p>Thank you, ${input.signerName}. Your agreement is signed.</p>` +
      `<p><a href="${pdfUrl}">Download your signed copy</a> (link expires in 1 hour).</p>`,
  })

  return { ok: true, pdfUrl }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no type errors. (`recordAuditEvent` is the Plan 05 helper at `@/lib/audit/record`; `sendEmail` the Plan 02 wrapper — alias if your build differs.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(contracts): public click-to-sign action (PDF + hash + storage + audit + activate)"
```

---

## Task 11: The public signing page + the staff contracts UI

**Files:**
- Create: `src/app/sign/[token]/page.tsx`
- Create: `src/components/contracts/sign-pad.tsx`
- Create: `src/app/(internal)/contracts/page.tsx`
- Create: `src/app/(internal)/contracts/actions.ts`
- Create: `src/components/contracts/template-list.tsx`
- Create: `src/components/contracts/contract-list.tsx`
- Create: `src/components/contracts/generate-contract-form.tsx`

The public page resolves the token, shows the rendered body, and renders the click-to-sign component. The staff page lists templates + contracts and exposes "generate from deal". The page sets the **`nodejs` runtime** and **`force-dynamic`** (PDF + tenant data must never be statically cached, PRD §9).

- [ ] **Step 1: Public signing page `src/app/sign/[token]/page.tsx`**

```tsx
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getContractByToken } from '@/lib/contracts/queries'
import { isTokenExpired } from '@/lib/contracts/tokens'
import { recordView, signContract } from './actions'
import { SignPad } from '@/components/contracts/sign-pad'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientIp(h: Headers): string {
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim()
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const contract = await getContractByToken(token)
  if (!contract || !contract.renderedBody) notFound()

  const h = await headers()
  const ip = clientIp(h)
  const ua = h.get('user-agent') ?? 'unknown'

  if (contract.status === 'signed') {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">{contract.title}</h1>
        <p className="mt-4 text-green-700">This agreement has already been signed.</p>
      </main>
    )
  }
  if (contract.status === 'void') notFound()
  const expired = isTokenExpired(contract.signTokenExpiresAt)

  // Best-effort view audit (no-op if already signed/void).
  if (!expired) await recordView({ token, ipAddress: ip, userAgent: ua })

  // Bind the signer metadata server-side; the client only sends the typed name.
  async function onSign(signerName: string, signerEmail: string) {
    'use server'
    return signContract({ token, signerName, signerEmail, ipAddress: ip, userAgent: ua })
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">{contract.title}</h1>
      {expired ? (
        <p className="mt-4 text-red-600">This signing link has expired. Please request a new one.</p>
      ) : (
        <>
          <article className="mt-6 whitespace-pre-wrap rounded border p-4 text-sm">
            {contract.renderedBody}
          </article>
          <SignPad
            defaultName={contract.signerName ?? ''}
            defaultEmail={contract.signerEmail ?? ''}
            onSign={onSign}
          />
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Click-to-sign component `src/components/contracts/sign-pad.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import type { SignResult } from '@/app/sign/[token]/actions'

export function SignPad({
  defaultName,
  defaultEmail,
  onSign,
}: {
  defaultName: string
  defaultEmail: string
  onSign: (signerName: string, signerEmail: string) => Promise<SignResult>
}) {
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [agreed, setAgreed] = useState(false)
  const [done, setDone] = useState<{ pdfUrl: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await onSign(name.trim(), email.trim())
      if (res.ok) setDone({ pdfUrl: res.pdfUrl })
      else setError(`Could not sign: ${res.reason.replace('_', ' ')}.`)
    })
  }

  if (done) {
    return (
      <div className="mt-6 rounded border border-green-300 bg-green-50 p-4">
        <p className="font-medium text-green-800">Signed. Thank you.</p>
        <a className="text-sm underline" href={done.pdfUrl}>
          Download your signed copy
        </a>
      </div>
    )
  }

  const canSign = agreed && name.trim().length > 1 && /.+@.+/.test(email)
  return (
    <div className="mt-6 flex flex-col gap-3">
      <input
        className="rounded border p-2"
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I have read and agree to this agreement, and consent to sign electronically.
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button disabled={!canSign || pending} onClick={submit}>
        {pending ? 'Signing…' : 'Click to sign'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Staff route actions `src/app/(internal)/contracts/actions.ts`** (thin wrappers that resolve the session + scope, then delegate to `lib/contracts/actions`)

```ts
'use server'
import { getSession, isStaff } from '@/lib/auth'
import {
  createTemplate as createTemplateLib,
  generateContract as generateContractLib,
  sendForSignature as sendForSignatureLib,
} from '@/lib/contracts/actions'

async function requireStaffOrg(): Promise<string> {
  const session = await getSession()
  if (!session || !isStaff(session.role) || !session.orgId) throw new Error('forbidden')
  return session.orgId
}

export async function createTemplate(input: { name: string; body: string }) {
  const orgId = await requireStaffOrg()
  return createTemplateLib({ orgId, ...input })
}

export async function generateContract(input: {
  clientOrganizationId: string
  templateId: string
  title: string
  mergeData: Record<string, string>
  dealId?: string
  retainerAmount?: number | null
  currency?: string
  createFirstInvoice?: boolean
}) {
  const agencyOrgId = await requireStaffOrg()
  return generateContractLib({ agencyOrgId, ...input })
}

export async function sendForSignature(input: {
  clientOrganizationId: string
  contractId: string
  signerName: string
  signerEmail: string
}) {
  await requireStaffOrg()
  return sendForSignatureLib(input)
}
```

- [ ] **Step 4: Templates table `src/components/contracts/template-list.tsx`**

```tsx
import type { ContractTemplate } from '@/db/types'

export function TemplateList({ templates }: { templates: ContractTemplate[] }) {
  if (!templates.length) return <p className="text-sm text-muted-foreground">No templates yet.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2">Template</th>
          <th>Merge fields</th>
          <th>Active</th>
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr key={t.id} className="border-b">
            <td className="py-2 font-medium">{t.name}</td>
            <td className="text-muted-foreground">{t.mergeFields.join(', ')}</td>
            <td>{t.isActive ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 5: Contracts table `src/components/contracts/contract-list.tsx`**

```tsx
import type { Contract } from '@/db/types'

function gbp(pence: number | null): string {
  if (pence == null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

export function ContractList({ contracts }: { contracts: Contract[] }) {
  if (!contracts.length) return <p className="text-sm text-muted-foreground">No contracts yet.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2">Contract</th>
          <th>Status</th>
          <th>Retainer</th>
          <th>Signed</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => (
          <tr key={c.id} className="border-b">
            <td className="py-2 font-medium">{c.title}</td>
            <td>{c.status}</td>
            <td>{gbp(c.retainerAmount)}</td>
            <td>{c.signedAt ? new Date(c.signedAt).toLocaleDateString('en-GB') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 6: Generate-from-deal form `src/components/contracts/generate-contract-form.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import type { ContractTemplate } from '@/db/types'
import { generateContract } from '@/app/(internal)/contracts/actions'

export function GenerateContractForm({
  templates,
  clientOrganizationId,
}: {
  templates: ContractTemplate[]
  clientOrganizationId: string
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [retainer, setRetainer] = useState('') // pounds, converted to pence
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const pence = retainer ? Math.round(Number(retainer) * 100) : null
        const res = await generateContract({
          clientOrganizationId,
          templateId,
          title: title || 'Services Agreement',
          mergeData: {
            client_name: clientName,
            services: '',
            retainer_amount: pence ? `£${(pence / 100).toFixed(2)}` : '',
            term: '12 months',
            scope: '',
          },
          retainerAmount: pence,
          createFirstInvoice: true,
        })
        setCreatedId(res.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <select className="rounded border p-2" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input className="rounded border p-2" placeholder="Contract title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="rounded border p-2" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
      <input className="rounded border p-2" placeholder="Retainer (£/month)" value={retainer} onChange={(e) => setRetainer(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {createdId && <p className="text-sm text-green-700">Draft created: {createdId}</p>}
      <Button disabled={pending || !templateId} onClick={submit}>
        {pending ? 'Generating…' : 'Generate draft contract'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 7: Staff page `src/app/(internal)/contracts/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { listTemplates, listContracts } from '@/lib/contracts/queries'
import { TemplateList } from '@/components/contracts/template-list'
import { ContractList } from '@/components/contracts/contract-list'

export const dynamic = 'force-dynamic'

export default async function ContractsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role) || !session.orgId) redirect('/overview')

  const templates = await listTemplates(session.orgId)
  // Staff see contracts across all client orgs via RLS (is_agency_staff); we list
  // the agency-staff view by scanning each client org's contracts through the
  // RLS-scoped query is out of scope for the shell — show templates + a count hint.
  const contracts = await listContracts(session.orgId)

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-3 text-lg font-semibold">Contract Templates</h1>
        <TemplateList templates={templates} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Contracts</h2>
        <ContractList contracts={contracts} />
      </section>
    </div>
  )
}
```

> The internal nav label "Contracts" is already present in the Plan 01 internal shell sidebar; this route fills it. The staff cross-client contract list (every client org) and the per-deal "generate" entry point are wired in the Clients/Pipeline detail hubs (Plan 02) by passing a client org id into `GenerateContractForm`; the standalone page above shows templates + the agency-scoped contract list and is the minimal shell — extend with a client picker as the Clients hub matures.

- [ ] **Step 8: Manual smoke test**

Run: `pnpm dev` (and the Inngest dev server if your Resend wrapper enqueues via Inngest: `pnpm dlx inngest-cli dev`).
Then:
1. Sign in as `founder@milktreeagency.com` → visit `/contracts` → see the seeded "Standard Retainer Agreement" template.
2. From a client hub (or by calling `sendForSignature` against the seeded `Client Two — Retainer` contract via a quick script), obtain the `/sign/<token>` URL.
3. Open `/sign/<token>` in a logged-out browser → the rendered body shows; tick consent, enter a name/email, click "Click to sign".
4. Confirm: the page shows a "Download your signed copy" link; `select status, signed_pdf_path, document_hash from public.contract where id = …` shows `signed` + a path + a 64-char hash; `select type, ip_address from public.signature_event where contract_id = …` shows a `viewed` then a `signed` row with the IP; `select status from public.subscriptions where organization_id = <client-two org>` shows `active`.

Expected: all behave as described. (If Storage upload fails locally, confirm `pnpm dlx supabase start` recreated the `contracts` bucket from the Task 3 migration.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(contracts): public signing page + staff contracts UI (templates, list, generate)"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole contracts test set + the cross-suite RLS gate**

Run:
```bash
pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:contracts
pnpm tsc --noEmit
pnpm test tests/contracts tests/rls/contracts-isolation.test.ts
```
Expected: type-check clean; merge, token, activation, and RLS-isolation tests all PASS.

- [ ] **Step 2: Run the entire suite to confirm no regressions in earlier plans**

Run: `pnpm lint && pnpm test`
Expected: lint clean; every test (Plan 01–05 RLS/auth + this plan) passes.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(contracts): full-suite verification green"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.10 Contracts/Proposals/E-sign and §8 Data Model):**
- Proposal/contract templates with merge fields (client, services, retainer £, term, scope) → `contract_template` (Task 2) + merge engine (Task 6) + seeded "Standard Retainer Agreement" with exactly those five fields (Task 3). ✅
- Generate from a deal → `generateContract()` freezes merge data + `rendered_body`, links `dealId` (Task 8). ✅
- Send for e-signature → `sendForSignature()` mints a token via the provider seam + emails the link (Task 8). ✅
- On signature, auto-create/activate the client + retainer and optionally the first invoice → `activateFromContract()` in one transaction, idempotent on `activated_at`, creating `client` (Plan 02) + `subscription` set `active` (Plan 04) + optional `invoice`+`line_item` (Plan 04) (Task 9), invoked by the sign action (Task 10). ✅
- Store signed PDF + audit trail (who/when/IP) → `@react-pdf/renderer` bytes → SHA-256 hash → private `contracts` bucket → `signed_pdf_path`/`document_hash` on the contract + `signature_event` rows capturing signer name/email, IP, user-agent, and hash (Tasks 7, 10). ✅
- E-sign approach picked + provider seam → built-in click-to-sign is v1 (`BuiltInClickToSign`) behind `ESignProvider`/`getESignProvider()` so a vendor drops in later (Task 7). ✅
- Acceptance "A signed contract produces an immutable PDF + audit record" → the rendered body is frozen at send, the PDF bytes are hashed and stored, the token is burned on signing, and `signature_event` is append-only (no authenticated write policy) → tested in `contracts-isolation.test.ts` (signed-status immutability + service-role-only insert) (Tasks 5, 10). ✅
- Acceptance "Signature transitions the deal/client to active and seeds the retainer" → `activate.test.ts` asserts one client, one `active` subscription, one retainer invoice, contract linked + stamped; idempotent re-run (Task 9). ✅
- §8 entities `contract`, `contract_template`, `signature_event` realised with canonical names; tenant column is `organization_id` per the Plan 01/02 convention (noted in the header). ✅

**Security / shared-conventions compliance:**
- Every tenant table carries `organization_id` as the leading column of a composite index (`idx_contract_template_org`, `idx_contract_org_status`, `idx_signature_event_org`/`_contract`). ✅
- RLS enabled on all three; policies REUSE `public.has_org_access()` / `public.is_agency_staff()` only; templates staff-only; contracts read-via-org-access + staff-write; `signature_event` read-via-org-access + no authenticated write (service-role only, like Plan 05 `audit_event`). ✅
- An RLS isolation test exists for every new tenant table (Task 5, KEYSTONE), using the Plan 01 `asUser()`/`userIdByEmail()` harness. ✅
- `service_role` is used only by server-side jobs/actions (the sign action, the token read, Storage), never user-facing reads (staff/portal use anon + RLS via `src/db`). ✅
- Storage bucket is private; downloads use short-lived signed URLs (1h default). Tenant data routes are `force-dynamic` + `nodejs` runtime (no static caching of tenant data, PRD §9). ✅
- Public `/sign/[token]` is authorized solely by a cryptographically-random, expiring, single-use token (burned on sign); signer IP/UA are captured server-side from request headers, never trusted from the client. ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. The migration numbers `00NN` are an explicit "use the next free number" instruction (drizzle assigns generated numbers), not a code placeholder. The dependency aliasing notes (Plan 04 `subscriptions` vs `subscription`; Plan 02/05 import paths) are integration instructions for cross-plan consistency, matching how Plan 04 itself documents its Plan 02/05 references. ✅

**Type consistency:** `ContractTemplate`/`Contract`/`SignatureEvent` inferred in `src/db/types.ts` and used across queries/actions/components; enum values `contract_status` (`draft|sent|viewed|signed|declined|void`) and `signature_event_type` (`viewed|signed|declined|voided`) consistent across schema, RLS reads, the sign action, and tests; merge-engine signatures (`extractMergeFields`/`renderMergeBody`/`missingMergeFields`) consistent between `merge.ts` and `actions.ts`/tests; token helpers (`generateSignToken`/`hashDocument`/`isTokenExpired`) consistent between `tokens.ts`, `esign.ts`, and the sign action; `activateFromContract`/`signContract`/`SignResult` names consistent between `activate.ts`, the sign action, the page, and `sign-pad.tsx`; finance table imports (`subscriptions`/`invoices`/`lineItems`) and Plan 02/05 helpers (`sendEmail`/`recordAuditEvent`) referenced by their canonical suite paths. ✅

**Definition of done for Plan 16:** `pnpm lint && pnpm tsc --noEmit && pnpm test` green (contracts RLS isolation + merge/token unit tests + signature→activation integration test pass), and the Task 11 manual smoke test executes a click-to-sign that stores an immutable hashed PDF, writes the `viewed`+`signed` audit trail, and activates the client + retainer (+ first invoice).
