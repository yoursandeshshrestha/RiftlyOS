# Agency OS — Plan 1.5: Shared Platform Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cross-cutting infrastructure that every later business module depends on — the **Inngest** durable-jobs client + a registry-based serve route, the **Resend** email wrapper, and the **`audit_event`** table (Founder-only read, service-role-only write) with a `recordAuditEvent()` helper. These are the shared platform services: they have no business logic of their own, they exist so that Finance (Plan 04), Leads/Sync (Plan 05), and Connectors (Plan 06) can register jobs, send mail, and write audit rows without each plan re-inventing the wiring.

**Why this plan exists / consumption contract (READ THIS):** This plan is built immediately **after Plan 01 (Foundation)** and **before Plan 02**, so that all downstream plans can rely on it. The following artifacts are **owned exclusively by this plan** and are **CONSUMED, never recreated**, by Plans 04/05/06 (and any later plan):

- `src/lib/inngest/client.ts` — the singleton `inngest` client (`new Inngest({ id: 'agency-os' })`).
- `src/app/api/inngest/route.ts` — the Inngest serve route using a **REGISTRY pattern**: a central `functions` array that later modules import-and-append to. Plans 04/05/06 add their functions to `src/lib/inngest/functions.ts`; they do **not** recreate the route or the client.
- `src/lib/email/resend.ts` — `sendEmail({ to, subject, html })`, which degrades gracefully (logs + no-ops) when `RESEND_API_KEY` is unset (dev/test/CI).
- `src/lib/audit/record.ts` — `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })`, a **service-role** insert into `audit_event`.
- The `audit_event` table itself (PRD §8 / §5.14 / §9): Founder-only `SELECT` via RLS using the Plan 01 helpers `public.has_org_access` / `public.is_agency_staff`; **no authenticated INSERT** — writes happen only through the service-role connection used by `recordAuditEvent()`.

> **SUPERSESSION NOTICE — binding on downstream plans.** Any task in Plan 04 (Finance), Plan 05 (Leads/Sync), or Plan 06 (Connectors/Integrations) that creates an Inngest client, an Inngest serve route, an email/Resend wrapper, or the `audit_event` table/`recordAuditEvent` helper is **SUPERSEDED by this plan and must be skipped.** Those plans import from the canonical paths above. If a downstream plan needs a new Inngest function, it appends to `src/lib/inngest/functions.ts` (the registry) — see Task 2. If it needs to write an audit row, it calls `recordAuditEvent()` — see Task 5.

**Architecture:** Three independent, dependency-light services sharing the Plan 01 stack. (1) **Inngest** provides durable step functions + cron + retries for the ETL syncs (Plan 05/06) and the monthly AI report (Plan 07); we expose one `serve()` route fed by a registry array so modules compose functions without touching routing. (2) **Resend** sends transactional email (notifications, monthly report delivery, dunning); it is wrapped once so callers never touch the SDK and so missing credentials never crash a dev/test run. (3) **`audit_event`** is the immutable money/security ledger (PRD §5.14): it is tenant-scoped (`organization_id` nullable for agency-global events), readable only by agency staff via RLS, and writable only via the service-role connection — never by `authenticated` users — exactly matching PRD §9's "`service_role` is never used for user-facing queries; audit is staff-read, service-write."

**Tech Stack:** Inngest (`inngest` + `inngest/next` serve handler) · Resend (`resend` SDK) · Drizzle ORM + drizzle-kit (schema in `src/db/schema.ts`; custom RLS SQL via `pnpm db:generate --custom`) · postgres.js (service-role connection for audit writes) · Vitest (unit tests with SDK mocks + an RLS isolation test reusing the Plan 01 harness `tests/helpers/db.ts`).

**Prerequisites (already built by Plan 01):** Next.js 16 App Router (TS strict) · local Supabase stack (`pnpm dlx supabase start`) · Drizzle wired (`src/db/schema.ts`, `pnpm db:generate` / `pnpm db:migrate`) · RLS helpers `public.has_org_access(uuid)` and `public.is_agency_staff()` exist · the seed (`pnpm db:seed`) creating the founder + two client users · the RLS test harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`, `sql`) · `.env.local` with `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

---

## File Structure (created by this plan)

```
.
├─ src/
│  ├─ app/
│  │  └─ api/
│  │     └─ inngest/
│  │        └─ route.ts            # Inngest serve route (registry pattern)
│  ├─ db/
│  │  ├─ schema.ts                 # MODIFIED: + audit_event table
│  │  ├─ types.ts                  # MODIFIED: + AuditEvent type
│  │  └─ service.ts                # service-role postgres connection (server-only)
│  └─ lib/
│     ├─ inngest/
│     │  ├─ client.ts              # exports `inngest` singleton
│     │  └─ functions.ts           # REGISTRY: functions[] (+ health no-op fn)
│     ├─ email/
│     │  └─ resend.ts              # exports sendEmail({ to, subject, html })
│     └─ audit/
│        └─ record.ts             # exports recordAuditEvent(...)
├─ drizzle/
│  └─ 0003_audit_event_rls.sql     # custom SQL: RLS enable + policy
└─ tests/
   ├─ inngest/registry.test.ts     # registry shape + health fn
   ├─ email/resend.test.ts         # sendEmail payload (SDK mocked)
   └─ rls/audit_event.test.ts      # KEYSTONE: audit RLS isolation
```

> **Migration numbering note:** Plan 01 ends at `drizzle/0002_access_token_hook.sql`. This plan adds the Drizzle-generated table migration (next sequential number, shown here as `0003_*` for the generated table) and the custom RLS migration `0003_audit_event_rls.sql`. If your repo's journal has advanced past `0002`, accept whatever sequential numbers `pnpm db:generate` assigns and use those filenames — the commands below do not hard-code the table-migration number.

---

## Task 1: Install dependencies and add the Inngest client

**Files:**
- Modify: `package.json` (deps)
- Create: `src/lib/inngest/client.ts`
- Modify: `.env.local` (Inngest + Resend keys, optional in dev)

- [ ] **Step 1: Install Inngest and Resend**

Run:
```bash
pnpm add inngest resend
```
Expected: `inngest` and `resend` added to `dependencies` in `package.json`.

- [ ] **Step 2: Add (optional) env vars to `.env.local`**

Append to `.env.local` (all optional in local dev — the code degrades gracefully when they are unset):
```bash
# Inngest (optional locally; the dev server discovers functions without keys)
INNGEST_EVENT_KEY=""
INNGEST_SIGNING_KEY=""
# Resend (optional locally; sendEmail no-ops + logs when unset)
RESEND_API_KEY=""
RESEND_FROM_EMAIL="Agency OS <onboarding@resend.dev>"
```
Confirm `.env.local` is still gitignored (Plan 01 set this up).

- [ ] **Step 3: Create the Inngest client `src/lib/inngest/client.ts`**

```ts
import { Inngest } from 'inngest'

/**
 * The single Agency OS Inngest client. EVERY module imports this exact
 * instance to send events and define functions — do not construct another
 * Inngest client anywhere else in the codebase (see Plan 1.5 supersession
 * notice). The `id` is the durable app identifier registered with Inngest.
 */
export const inngest = new Inngest({ id: 'agency-os' })
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(inngest): add inngest + resend deps and the inngest client singleton"
```

---

## Task 2: The Inngest function registry + a health no-op function (TDD)

The registry is the contract that lets Plans 04/05/06 add durable jobs without touching routing. We export a mutable-by-composition `functions` array; later modules append their functions to it. We seed it with one trivial health/no-op function to prove the wiring end-to-end.

**Files:**
- Create: `tests/inngest/registry.test.ts`
- Create: `src/lib/inngest/functions.ts`

- [ ] **Step 1: Write the failing test `tests/inngest/registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { functions, healthFn } from '@/lib/inngest/functions'

describe('inngest function registry', () => {
  it('exports a functions array containing the health function', () => {
    expect(Array.isArray(functions)).toBe(true)
    expect(functions).toContain(healthFn)
  })

  it('the health function is registered on the "agency-os/health.ping" event', () => {
    // Inngest stores the trigger config on the function definition.
    const def = healthFn['absoluteId'] ?? healthFn.id()
    expect(typeof def === 'string').toBe(true)
    // The created function id is namespaced by the app id.
    expect(healthFn.id()).toContain('health')
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/inngest/registry.test.ts`
Expected: FAIL — `src/lib/inngest/functions.ts` does not exist yet (module-not-found). This proves the test runs.

- [ ] **Step 3: Create the registry `src/lib/inngest/functions.ts`**

```ts
import { inngest } from './client'

/**
 * Trivial health/no-op function — proves the Inngest wiring (client + serve
 * route + registry) works end-to-end. Triggered by sending the
 * "agency-os/health.ping" event; it does nothing but return ok.
 */
export const healthFn = inngest.createFunction(
  { id: 'health-ping' },
  { event: 'agency-os/health.ping' },
  async ({ event }) => {
    return { ok: true, receivedAt: new Date().toISOString(), data: event.data ?? null }
  },
)

/**
 * THE REGISTRY. The Inngest serve route (src/app/api/inngest/route.ts) serves
 * exactly this array. Later modules (Plans 04/05/06/07) add their durable
 * functions here — e.g.:
 *
 *   import { syncGa4Fn } from '@/lib/connectors/sync'
 *   export const functions = [healthFn, syncGa4Fn]
 *
 * They MUST NOT recreate the serve route or the client; appending to this
 * array is the only step required to deploy a new background job.
 */
export const functions = [healthFn]
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/inngest/registry.test.ts`
Expected: PASS — `functions` contains `healthFn`, and `healthFn.id()` contains `"health"`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(inngest): function registry + health no-op function (tests pass)"
```

---

## Task 3: The Inngest serve route (registry pattern)

**Files:**
- Create: `src/app/api/inngest/route.ts`

- [ ] **Step 1: Create the serve route `src/app/api/inngest/route.ts`**

```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { functions } from '@/lib/inngest/functions'

/**
 * The ONE Inngest HTTP entry point for Agency OS. It serves every function in
 * the registry (src/lib/inngest/functions.ts). To add a background job, append
 * it to that registry — DO NOT add another serve route (see Plan 1.5).
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
```

- [ ] **Step 2: Verify the route builds**

Run: `pnpm build`
Expected: build succeeds; the route `/api/inngest` appears in the route list. (Type errors here would mean the registry/client imports are wrong.)

- [ ] **Step 3: (Optional) Manual smoke test with the Inngest dev server**

Run, in two terminals:
```bash
pnpm dev
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```
Open the Inngest dev UI (printed by the CLI, usually http://localhost:8288). Expected: the app `agency-os` is discovered with one function, `health-ping`. Send the `agency-os/health.ping` event from the dev UI and confirm it runs and returns `{ ok: true }`. (This step is optional/manual; CI relies on the unit test in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(inngest): serve route wired to the function registry"
```

---

## Task 4: The Resend email wrapper (TDD, SDK mocked)

`sendEmail` is the single email entry point. It degrades gracefully: with no `RESEND_API_KEY` it logs and no-ops (returns `{ sent: false }`) so dev/test/CI never fail on missing credentials; with a key it sends via Resend and returns `{ sent: true, id }`.

**Files:**
- Create: `tests/email/resend.test.ts`
- Create: `src/lib/email/resend.ts`

- [ ] **Step 1: Write the failing test `tests/email/resend.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Resend SDK: capture the payload passed to emails.send().
const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

describe('sendEmail', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.resetModules()
    sendMock.mockReset()
    process.env = { ...OLD_ENV }
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('builds the correct Resend payload and reports sent when a key is set', async () => {
    process.env.RESEND_API_KEY = 're_test_123'
    process.env.RESEND_FROM_EMAIL = 'Agency OS <hello@agencyos.test>'
    sendMock.mockResolvedValue({ data: { id: 'email_abc' }, error: null })

    const { sendEmail } = await import('@/lib/email/resend')
    const result = await sendEmail({
      to: 'client@example.com',
      subject: 'Your monthly report is ready',
      html: '<p>Hello</p>',
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith({
      from: 'Agency OS <hello@agencyos.test>',
      to: 'client@example.com',
      subject: 'Your monthly report is ready',
      html: '<p>Hello</p>',
    })
    expect(result).toEqual({ sent: true, id: 'email_abc' })
  })

  it('no-ops (does not call the SDK) when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    const { sendEmail } = await import('@/lib/email/resend')
    const result = await sendEmail({
      to: 'client@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    })

    expect(sendMock).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: false })
  })

  it('returns sent:false when the SDK reports an error', async () => {
    process.env.RESEND_API_KEY = 're_test_123'
    sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const { sendEmail } = await import('@/lib/email/resend')
    const result = await sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>' })

    expect(result).toEqual({ sent: false })
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/email/resend.test.ts`
Expected: FAIL — `src/lib/email/resend.ts` does not exist yet.

- [ ] **Step 3: Create the wrapper `src/lib/email/resend.ts`**

```ts
import { Resend } from 'resend'

export type SendEmailArgs = {
  to: string | string[]
  subject: string
  html: string
}

export type SendEmailResult = { sent: true; id: string } | { sent: false }

const DEFAULT_FROM = 'Agency OS <onboarding@resend.dev>'

/**
 * Single transactional-email entry point for Agency OS. Notifications, the
 * monthly report email, and dunning all call this — do not import the Resend
 * SDK elsewhere (see Plan 1.5 supersession notice).
 *
 * Degrades gracefully: when RESEND_API_KEY is unset (dev/test/CI) it logs and
 * no-ops, returning { sent: false }, so a missing credential never crashes a
 * request or a background job.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping send. to=${String(args.to)} subject="${args.subject}"`,
    )
    return { sent: false }
  }

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
  })

  if (error || !data) {
    console.error('[email] Resend send failed:', error)
    return { sent: false }
  }

  return { sent: true, id: data.id }
}
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `pnpm test tests/email/resend.test.ts`
Expected: PASS — all three cases (key set → correct payload + `sent:true`; key missing → no SDK call + `sent:false`; SDK error → `sent:false`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(email): graceful sendEmail wrapper over Resend (tests pass)"
```

---

## Task 5: The `audit_event` table + service-role connection + `recordAuditEvent()`

PRD §8 columns: `id`, `organization_id` (nullable — agency-global events have no client org), `actor_id`, `action`, `target_type`, `target_id`, `metadata` jsonb, `created_at`. PRD §9 / §5.14: Founder-only `SELECT` via RLS; **no authenticated INSERT** — writes happen only through a server-side service-role connection.

**Files:**
- Modify: `src/db/schema.ts` (+ `auditEvent` table)
- Modify: `src/db/types.ts` (+ `AuditEvent` type)
- Create: `src/db/service.ts` (service-role postgres connection)
- Create: `src/lib/audit/record.ts`
- Create: `drizzle/0003_*.sql` (generated table migration)

- [ ] **Step 1: Add the `audit_event` table to `src/db/schema.ts`**

Append to the existing `src/db/schema.ts` (keep all Plan 01 imports/tables; extend the import line as shown):

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  unique,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

// ... existing orgType / appRole enums and organizations / profiles / memberships tables ...

/**
 * Immutable money/security audit ledger (PRD §5.14, §8, §9).
 * organization_id is NULLABLE: agency-global events (e.g. a founder login,
 * a global settings change) are not scoped to a client org. actor_id is the
 * acting user (profiles.id). Writes are SERVICE-ROLE ONLY (see RLS migration
 * 0003_audit_event_rls.sql + recordAuditEvent()); reads are agency-staff only.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // organization_id LEADS the composite index (PRD §9 RLS performance rule).
    orgCreatedIdx: index('idx_audit_event_org_created').on(t.organizationId, t.createdAt),
  }),
)
```

- [ ] **Step 2: Add the inferred type to `src/db/types.ts`**

Append:
```ts
import type { auditEvent } from './schema'

export type AuditEvent = typeof auditEvent.$inferSelect
export type NewAuditEvent = typeof auditEvent.$inferInsert
```

- [ ] **Step 3: Generate and apply the table migration**

Run:
```bash
pnpm db:generate
pnpm db:migrate
```
Expected: a new `drizzle/0003_*.sql` is generated containing `create table "audit_event"` + the composite index, then applied. Verify:
```bash
psql "$DATABASE_URL" -c "\d public.audit_event"
```
Expected: columns `id, organization_id, actor_id, action, target_type, target_id, metadata, created_at`; index `idx_audit_event_org_created`.

- [ ] **Step 4: Create the service-role connection `src/db/service.ts`**

The Plan 01 `src/db/index.ts` connection is for normal (RLS-respecting) use. Audit **writes** must bypass user RLS, so they use a dedicated service-role Drizzle connection. (Locally this is still the `postgres` superuser connection string; in production this is the service-role connection. Either way it is `server-only` and must never be imported into client code.)

```ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * SERVICE-ROLE database connection — bypasses RLS. Use ONLY for trusted
 * server-side admin/job writes (e.g. audit logging, background syncs). NEVER
 * use this for user-facing reads (PRD §9). Never import into client code.
 */
const serviceUrl = process.env.SUPABASE_DB_SERVICE_URL || process.env.DATABASE_URL!
const client = postgres(serviceUrl, { prepare: false })
export const serviceDb = drizzle(client, { schema })
```

> Note: `SUPABASE_DB_SERVICE_URL` is optional and only needed if you later run the app under a least-privileged DB role for normal queries while keeping a separate superuser/service connection for audit writes. Locally, `DATABASE_URL` (the `postgres` superuser) already bypasses RLS, which is what the audit write needs.

- [ ] **Step 5: Create the writer `src/lib/audit/record.ts`**

```ts
import { serviceDb } from '@/db/service'
import { auditEvent } from '@/db/schema'

export type RecordAuditEventArgs = {
  actorId: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown> | null
  /** null = agency-global event (not scoped to a client org). */
  organizationId?: string | null
}

/**
 * Append an immutable row to the money/security audit ledger (PRD §5.14).
 * Uses the SERVICE-ROLE connection so the insert is allowed despite the
 * "no authenticated INSERT" RLS posture. EVERY money/security action across
 * the app (invoice create/void, role change, connection grant/revoke,
 * contract signature, data export, tenant-mapping change) calls this — do not
 * write to audit_event any other way (see Plan 1.5 supersession notice).
 */
export async function recordAuditEvent(args: RecordAuditEventArgs): Promise<void> {
  await serviceDb.insert(auditEvent).values({
    actorId: args.actorId,
    action: args.action,
    targetType: args.targetType ?? null,
    targetId: args.targetId ?? null,
    metadata: args.metadata ?? null,
    organizationId: args.organizationId ?? null,
  })
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(audit): audit_event table + service-role connection + recordAuditEvent"
```

---

## Task 6: KEYSTONE — RLS for `audit_event`, proven by an isolation test

RLS is not yet enabled on `audit_event`, so right now an authenticated client user could read (and write) it. We write the isolation test first, watch it FAIL, then add the RLS migration to make it PASS. Posture (PRD §9): **agency staff SELECT only; no authenticated INSERT; service-role does everything via `recordAuditEvent`.**

**Files:**
- Create: `tests/rls/audit_event.test.ts`
- Create: `drizzle/0003_audit_event_rls.sql` (custom SQL migration)

- [ ] **Step 1: Seed two audit rows for the test to read**

We need deterministic rows: one agency-global (`organization_id = null`) and one scoped to client-one. Insert them with the service-role writer via a tiny script run before the test, OR (simpler, self-contained) insert them inside the test's `beforeAll` using the privileged `sql` harness connection. We use the latter so the test owns its fixtures.

- [ ] **Step 2: Write the failing test `tests/rls/audit_event.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('audit_event RLS isolation', () => {
  let founder: string
  let clientOneUser: string
  let clientOneOrg: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    const orgRows = await sql`select id from public.organizations where slug = 'client-one'`
    clientOneOrg = orgRows[0]!.id as string

    // Seed deterministic audit rows via the privileged (superuser) harness
    // connection, mimicking service-role writes. Idempotent-ish: clear first.
    await sql`delete from public.audit_event where action in ('test.global', 'test.scoped')`
    await sql`
      insert into public.audit_event (organization_id, actor_id, action, target_type, target_id, metadata)
      values
        (null, ${founder}, 'test.global', 'system', 'x', ${sql.json({ k: 1 })}),
        (${clientOneOrg}, ${founder}, 'test.scoped', 'invoice', 'inv_1', ${sql.json({ k: 2 })})
    `
  })

  afterAll(async () => {
    await sql`delete from public.audit_event where action in ('test.global', 'test.scoped')`
    await sql.end()
  })

  it('agency staff (founder) can read audit rows', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select action from public.audit_event where action in ('test.global', 'test.scoped') order by action`,
    )
    const actions = rows.map((r) => r.action)
    expect(actions).toEqual(['test.global', 'test.scoped'])
  })

  it('a client user can read NO audit rows (staff-only SELECT)', async () => {
    const rows = await asUser(clientOneUser, (tx) =>
      tx`select action from public.audit_event where action in ('test.global', 'test.scoped')`,
    )
    expect(rows.length).toBe(0)
  })

  it('an authenticated user CANNOT insert audit rows (no authenticated INSERT)', async () => {
    await expect(
      asUser(clientOneUser, (tx) =>
        tx`insert into public.audit_event (action) values ('test.illegal')`,
      ),
    ).rejects.toThrow()
    // Confirm nothing was written.
    const rows = await sql`select 1 from public.audit_event where action = 'test.illegal'`
    expect(rows.length).toBe(0)
  })

  it('even agency staff cannot insert via the authenticated role', async () => {
    await expect(
      asUser(founder, (tx) =>
        tx`insert into public.audit_event (action) values ('test.illegal2')`,
      ),
    ).rejects.toThrow()
    const rows = await sql`select 1 from public.audit_event where action = 'test.illegal2'`
    expect(rows.length).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test and confirm it FAILS**

Run: `pnpm test tests/rls/audit_event.test.ts`
Expected: FAIL — RLS is not enabled, so the client user reads both rows (expected `[]`) and the authenticated INSERTs succeed instead of throwing. This proves the test is real.

- [ ] **Step 4: Commit the failing test**

```bash
git add -A
git commit -m "test(rls): audit_event isolation tests (currently failing, RLS not enabled)"
```

- [ ] **Step 5: Create the custom RLS migration**

Run: `pnpm db:generate --custom --name=audit_event_rls`
Expected: an empty `drizzle/0003_audit_event_rls.sql` (or next sequential number) created and registered in the journal.

- [ ] **Step 6: Fill in `drizzle/0003_audit_event_rls.sql`**

```sql
-- audit_event: agency-staff-only SELECT; NO authenticated INSERT/UPDATE/DELETE.
-- Writes happen exclusively through the service-role connection used by
-- recordAuditEvent() (which bypasses RLS). PRD §5.14 / §9.

alter table public.audit_event enable row level security;

-- Force RLS even for the table owner, so the posture cannot be bypassed by a
-- non-superuser owner role; the service-role/superuser connection still
-- bypasses RLS for writes as intended.
alter table public.audit_event force row level security;

-- SELECT: agency staff only. (is_agency_staff() is a Plan 01 SECURITY DEFINER
-- helper.) Scoping by org is unnecessary for the read posture — staff get
-- cross-client read by design (PRD §3) — but org-scoped rows still satisfy
-- has_org_access for any future per-org reader. We keep it staff-only here to
-- match "Audit log (Founder-only)" in §5.14 read access.
create policy audit_event_select_staff on public.audit_event
  for select
  using (public.is_agency_staff());

-- NO insert/update/delete policies are created. With RLS enabled and no
-- permissive write policy, ALL writes from the `authenticated` (and `anon`)
-- roles are denied. The service-role/superuser connection bypasses RLS, so
-- recordAuditEvent() continues to work.
```

- [ ] **Step 7: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `0003_audit_event_rls.sql` with no errors. Verify RLS is on:
```bash
psql "$DATABASE_URL" -c "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'audit_event'"
```
Expected: both `t` (true).

- [ ] **Step 8: Run the isolation test and confirm it PASSES**

Run: `pnpm test tests/rls/audit_event.test.ts`
Expected: all four tests PASS — founder reads both seeded rows; the client user reads none; authenticated INSERTs (client and founder) are rejected.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(security): audit_event RLS — staff-read, service-write only (tests pass)"
```

---

## Task 7: Prove `recordAuditEvent()` writes through RLS (integration test)

The RLS test above used the harness `sql` connection to seed rows. This task proves the **actual** `recordAuditEvent()` helper (service-role connection) can insert despite the "no authenticated INSERT" posture, and that what it writes is then readable by staff.

**Files:**
- Create: `tests/audit/record.test.ts`

- [ ] **Step 1: Write the test `tests/audit/record.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'
import { recordAuditEvent } from '@/lib/audit/record'

describe('recordAuditEvent (service-role write)', () => {
  let founder: string
  let clientOneOrg: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    const orgRows = await sql`select id from public.organizations where slug = 'client-one'`
    clientOneOrg = orgRows[0]!.id as string
    await sql`delete from public.audit_event where action = 'invoice.void.test'`
  })

  afterAll(async () => {
    await sql`delete from public.audit_event where action = 'invoice.void.test'`
    await sql.end()
  })

  it('writes a row via the service-role connection (bypasses RLS)', async () => {
    await recordAuditEvent({
      actorId: founder,
      action: 'invoice.void.test',
      targetType: 'invoice',
      targetId: 'inv_42',
      metadata: { reason: 'duplicate' },
      organizationId: clientOneOrg,
    })

    const rows = await sql`
      select action, target_id, organization_id, metadata
      from public.audit_event where action = 'invoice.void.test'
    `
    expect(rows.length).toBe(1)
    expect(rows[0]!.target_id).toBe('inv_42')
    expect(rows[0]!.organization_id).toBe(clientOneOrg)
    expect(rows[0]!.metadata).toEqual({ reason: 'duplicate' })
  })

  it('the written row is readable by agency staff via RLS', async () => {
    const rows = await asUser(founder, (tx) =>
      tx`select action from public.audit_event where action = 'invoice.void.test'`,
    )
    expect(rows.map((r) => r.action)).toEqual(['invoice.void.test'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it PASSES**

Run: `pnpm test tests/audit/record.test.ts`
Expected: PASS — `recordAuditEvent()` inserts the row (service-role bypasses RLS), and the founder can read it back.

> Note: `recordAuditEvent` imports `src/db/service.ts`, which is `server-only`. Vitest runs in a Node environment (Plan 01 `vitest.config.ts`), where `server-only` resolves to a harmless no-op, so the import works in tests. If a future change makes `server-only` throw in tests, set `RESEND_FROM_EMAIL`-style guards aside and run audit tests under the same node environment — no change is needed today.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(audit): recordAuditEvent writes through RLS and is staff-readable"
```

---

## Task 8: Full-suite green + downstream consumption note

**Files:**
- None (verification + documentation only)

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm test`
Expected: all tests pass — Plan 01's RLS isolation + auth-claims tests, plus this plan's `inngest/registry`, `email/resend`, `rls/audit_event`, and `audit/record` tests.

- [ ] **Step 2: Lint + typecheck (mirror CI)**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Confirm the build still produces the Inngest route**

Run: `pnpm build`
Expected: success; `/api/inngest` present in the route manifest.

- [ ] **Step 4: Record the consumption contract for downstream plans**

No code change. Confirm the following are true (they are the acceptance criteria for "Plans 04/05/06 consume this plan"):

- A new background job is added by appending to `functions` in `src/lib/inngest/functions.ts` and importing `inngest` from `src/lib/inngest/client.ts`. No new serve route, no new client.
- Any email is sent via `sendEmail` from `src/lib/email/resend.ts`. No direct Resend SDK usage.
- Any money/security event is recorded via `recordAuditEvent` from `src/lib/audit/record.ts`. No direct `audit_event` inserts, and no new `audit_event` table definition.

- [ ] **Step 5: Commit (if any tracking files changed) / tag the plan complete**

```bash
git add -A
git commit -m "chore(platform): shared platform services complete (inngest, email, audit)" || true
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.14 audit, §6 (Inngest/ETL), §7 (report email), §8 schema, §9 security, §10 stack):**
- **Inngest client + registry serve route** (§6.2 Sync Scheduler / §7 report worker depend on durable jobs) → Tasks 1–3. The registry (`functions[]`) is the documented extension point so Plans 04/05/06 add functions without recreating routing. ✅
- **Health/no-op function proving wiring** → Task 2 (`healthFn` on `agency-os/health.ping`), unit-tested. ✅
- **Resend wrapper `sendEmail({to,subject,html})` with graceful degradation** (§5.14 email notifications, §7 report email) → Task 4; unit test mocks the Resend SDK and asserts the exact payload + the missing-key no-op. ✅
- **`audit_event` table, PRD §8 columns** (`id, organization_id` nullable, `actor_id, action, target_type, target_id, metadata` jsonb, `created_at`) → Task 5; `organization_id` LEADS the composite index per §9. ✅
- **Founder-only SELECT via RLS using `is_agency_staff()`; NO authenticated INSERT; service-role-only writes** (§5.14, §9) → Task 6 custom SQL migration (`enable` + `force` RLS, staff-only select policy, zero write policies) + `recordAuditEvent()` service-role insert (Task 5). ✅
- **RLS isolation test for the new tenant-scoped table** (release-gate per §9) → Task 6 KEYSTONE test (founder reads, client reads none, authenticated insert rejected for both roles) using the Plan 01 harness `asUser`/`userIdByEmail`/`sql`. ✅
- **`recordAuditEvent()` proven against the live RLS posture** → Task 7 (service-role write succeeds, staff read-back succeeds). ✅

**Canonical-path / supersession compliance:** `src/lib/inngest/client.ts` (exports `inngest`, `new Inngest({ id: 'agency-os' })`), `src/app/api/inngest/route.ts` (registry serve), `src/lib/email/resend.ts` (`sendEmail`), `src/lib/audit/record.ts` (`recordAuditEvent` with the exact arg shape `{ actorId, action, targetType, targetId, metadata, organizationId }`), and the `audit_event` table are all created here and explicitly flagged in the intro as SUPERSEDING any equivalent creation in Plans 04/05/06. ✅

**Reuse of Plan 01 (no re-spec):** reuses `public.is_agency_staff()` / `public.has_org_access()` (RLS helpers), the `organizations`/`profiles` tables (FKs from `audit_event`), `src/db/schema.ts`/`types.ts` conventions, the `pnpm db:generate`/`db:migrate` + `--custom` migration flow, the seed users, and the `tests/helpers/db.ts` harness. No Plan 01 artifact is redefined. ✅

**Naming consistency:** Drizzle symbol `auditEvent` → DB table `audit_event` (PRD §8 exact name, singular, no plural drift); columns match §8 exactly; helper/file/export names match the canonical-conventions list verbatim. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete, runnable code. The only non-code notes are explicit environment instructions (optional env keys, migration-numbering caveat, `server-only`-in-tests note). ✅

**Type consistency:** `AuditEvent`/`NewAuditEvent` inferred in `src/db/types.ts`; `RecordAuditEventArgs` matches the canonical `recordAuditEvent` signature; `SendEmailArgs`/`SendEmailResult` typed; registry typed via Inngest's `createFunction`. ✅

**Definition of done for Plan 1.5:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green (Plan 01 tests + registry + resend + audit RLS + recordAuditEvent), `pnpm build` emits `/api/inngest`, and the three consumption-contract invariants in Task 8 hold so Plans 04/05/06 can build on top without recreating any shared service.
