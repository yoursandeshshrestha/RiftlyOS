# Agency OS — Plan 05: Client Portal, Notifications, Audit Log & Skills Library Implementation Plan

> ### Reconciliation notice (read `2026-06-28-00-conventions-and-build-order.md` first)
> Cross-cutting infra is owned by **Plan 1.5 - Shared Platform Services**, built before this plan. In this plan, SKIP anything that recreates it and consume the canonical modules instead:
> - **Inngest client + serve route:** do NOT run Task 1's `new Inngest(...)` / route creation. Import `inngest` from `@/lib/inngest/client` and register this plan's notification-email function by appending it to the central registry in `src/app/api/inngest/route.ts`.
> - **`audit_event` table, its RLS policy, its isolation test, and `recordAuditEvent()` (`src/lib/audit/record.ts`):** already delivered by Plan 1.5. In Task 2 create ONLY `notification`, `notification_pref`, and `skill_doc`; remove `audit_event` from this plan's migration, RLS, and test tasks.
> - **Email:** use `sendEmail` from `@/lib/email/resend` (Plan 1.5); the `src/lib/email/client.ts` here is optional/redundant.
> Everything else in this plan (notifications, skills, portal shell) stands.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four cross-cutting pieces that tie the rest of Agency OS together: (1) the **Client Portal composition shell** — Overview, Tasks, Invoices wired to the already-built Tasks (Plan 02) and Finance (Plan 03) modules, white-labeled per-client and strictly client-scoped; (2) **Notifications** — in-app feed + Resend email with per-user, per-category preferences and an always-on "critical" tier; (3) the **Founder-only Audit Log** that records every money/security event with actor, timestamp, and before/after JSON; and (4) the **Claude Skills Library** — a searchable CRUD knowledge base for the agency's Claude automations. Every new tenant-scoped table ships with an RLS isolation test using the Plan 01 harness.

**Architecture:** Builds directly on Plan 01 (tenancy, RLS helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`, the custom-access-token hook, `tests/helpers/db.ts` `asUser()` harness) and assumes Plans 02–04 exist (Tasks/board/task/task_comment, Finance/invoice/payment, Connections/connection). Four new tables: `notification` and `notification_pref` (per-user, tenant-aware), `audit_event` (Founder-only read; written by every privileged action), and `skill_doc` (agency-internal knowledge base, staff-only). Notifications are emitted through a single server-side `emitNotification()` helper that (a) inserts the in-app row and (b) enqueues a Resend email via an Inngest function, but only after consulting the recipient's `notification_pref` — with a hard-coded **critical-category override** so billing/security alerts can never be muted. Audit writes go through a single `recordAuditEvent()` helper invoked by the privileged Server Actions of earlier modules (we expose the helper and wire the events this plan owns). The portal is a thin App-Router composition layer under `(portal)/` that re-uses the data-access functions of Plans 02–04; it never renders internal chrome, and the internal shell never renders portal-only views — enforced by role guards in both layouts plus a cross-surface routing test.

**Tech Stack:** Next.js 16 (App Router, TypeScript strict) · Drizzle ORM + drizzle-kit · postgres.js · Supabase (Postgres + Auth + RLS) · Tailwind + shadcn/ui · Inngest (email + digest jobs) · Resend (+ React Email) · Vitest (unit/integration incl. RLS tests) — all per Plan 01 / PRD §10.

**Prerequisites the developer needs installed/configured:** Everything from Plan 01 (local Supabase running, seed applied), Plans 02–04 migrations applied (so `task`, `task_comment`, `invoice`, `connection` exist), plus a Resend API key and Inngest dev server. This plan adds `inngest`, `resend`, and `@react-email/components` if not already present from Plan 02/03.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ app/
│  │  ├─ (portal)/
│  │  │  ├─ layout.tsx                      # MODIFY: branded portal shell + role guard + portal nav
│  │  │  ├─ overview/page.tsx               # MODIFY: KPI snapshot + latest report stub + notifications peek
│  │  │  ├─ tasks/page.tsx                   # NEW: client task board (re-uses Plan 02 data access)
│  │  │  ├─ invoices/page.tsx                # NEW: client invoices + Pay button (re-uses Plan 03 data access)
│  │  │  └─ notifications/page.tsx           # NEW: client notification feed
│  │  ├─ (internal)/
│  │  │  ├─ skills/page.tsx                  # NEW: Skills Library list + search
│  │  │  ├─ skills/new/page.tsx              # NEW: create skill
│  │  │  ├─ skills/[id]/page.tsx             # NEW: view/edit skill
│  │  │  ├─ notifications/page.tsx           # NEW: staff notification feed
│  │  │  └─ settings/audit/page.tsx          # NEW: Founder-only audit log viewer
│  │  ├─ api/inngest/route.ts                # MODIFY/NEW: register notification email fn
│  ├─ db/
│  │  ├─ schema.ts                           # MODIFY: add 4 tables + 1 enum
│  │  └─ types.ts                            # MODIFY: export new row types
│  ├─ lib/
│  │  ├─ notifications/
│  │  │  ├─ emit.ts                          # NEW: emitNotification() + category config
│  │  │  ├─ prefs.ts                         # NEW: read/merge per-user prefs + critical override
│  │  │  └─ queries.ts                       # NEW: list/markRead data access (RLS-scoped)
│  │  ├─ audit/
│  │  │  └─ record.ts                        # NEW: recordAuditEvent() (service-role insert)
│  │  ├─ skills/
│  │  │  └─ queries.ts                       # NEW: skills CRUD data access
│  │  ├─ email/
│  │  │  ├─ client.ts                        # NEW: Resend client (server-only)
│  │  │  └─ templates/notification.tsx       # NEW: React Email notification template
│  │  └─ inngest/
│  │     ├─ client.ts                        # MODIFY/NEW: Inngest client
│  │     └─ functions/send-notification-email.ts  # NEW
│  ├─ components/
│  │  ├─ portal/brand-header.tsx             # NEW: white-label header (client logo/name)
│  │  ├─ notifications/notification-list.tsx # NEW: shared feed UI
│  │  └─ skills/skill-form.tsx               # NEW: create/edit form
│  └─ actions/
│     ├─ notifications.ts                    # NEW: markRead / markAllRead / updatePrefs Server Actions
│     └─ skills.ts                           # NEW: createSkill / updateSkill / deleteSkill Server Actions
├─ drizzle/
│  ├─ 00XX_portal_notif_audit_skills.sql     # generated (tables)
│  └─ 00XX_portal_notif_audit_skills_rls.sql # custom (RLS policies + indexes)
└─ tests/
   ├─ rls/notifications.isolation.test.ts    # NEW: RLS isolation (notification, notification_pref)
   ├─ rls/audit.isolation.test.ts            # NEW: RLS isolation (audit_event, Founder-only)
   ├─ rls/skills.isolation.test.ts           # NEW: RLS isolation (skill_doc, staff-only)
   ├─ notifications/emit.test.ts             # NEW: critical-override + pref-muting logic
   ├─ audit/record.test.ts                   # NEW: immutability + before/after capture
   └─ portal/surface-isolation.test.ts       # NEW: client cannot reach internal chrome & vice versa
```

> **Migration numbering:** Plan 01 created `0000`–`0002`; Plans 02–04 added migrations after that. Use the next free numbers when you run `pnpm db:generate`; this plan refers to them as `00XX` / `00XX+1`. Always read the `drizzle/meta/_journal.json` to find the next index before generating.

---

## Task 1: Add dependencies (Inngest, Resend, React Email) and the Inngest client

> If Plan 02/03 already installed any of these, the install is a no-op; keep the client files idempotent (don't clobber an existing Inngest client — extend it).

**Files:**
- Modify: `package.json` (deps)
- Create/Modify: `src/lib/inngest/client.ts`
- Create: `src/lib/email/client.ts`
- Modify: `.env.local` (add `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`)

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add inngest resend @react-email/components
```
Expected: packages added. If already present (from an earlier plan), pnpm reports "already up to date" — fine.

- [ ] **Step 2: Add env vars to `.env.local`**

Append:
```bash
RESEND_API_KEY="re_local_dev_placeholder"
EMAIL_FROM="Agency OS <notifications@milktreeagency.com>"
APP_URL="http://localhost:3000"
```
`RESEND_API_KEY` may be a placeholder locally — the Inngest function logs instead of sending when the key is the placeholder (handled in Task 6). Confirm `.env.local` is gitignored.

- [ ] **Step 3: Create/extend the Inngest client `src/lib/inngest/client.ts`**

```ts
import { Inngest } from 'inngest'

export const inngest = new Inngest({ id: 'agency-os' })
```
If this file already exists from a prior plan, leave the existing `inngest` export intact and skip this step.

- [ ] **Step 4: Create the Resend client `src/lib/email/client.ts`**

```ts
import 'server-only'
import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY ?? ''

// Exposed so callers/tests can detect the local placeholder and avoid real sends.
export const isEmailConfigured = apiKey !== '' && apiKey !== 're_local_dev_placeholder'

export const resend = new Resend(apiKey || 'missing')

export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Agency OS <notifications@example.com>'
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(notif): add inngest, resend, react-email clients"
```

---

## Task 2: Schema — add `notification`, `notification_pref`, `audit_event`, `skill_doc`

The four tables follow PRD §8 names exactly. `notification` and `notification_pref` are **user-scoped but tenant-aware** (they carry `organization_id` so a client's notifications live in the client org and are RLS-isolated; staff notifications live in the agency org). `audit_event` is tenant-tagged (`organization_id` nullable for agency-global events) and **Founder-only readable**. `skill_doc` is agency-staff-only (no client access at all).

A `notification_category` enum encodes which events exist and (in code) which are "critical" (un-mutable).

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/00XX_portal_notif_audit_skills.sql` (generated)

- [ ] **Step 1: Add the enum + tables to `src/db/schema.ts`**

Append to the existing schema file (do not remove anything). These reference `organizations` and `profiles` already defined in Plan 01.

```ts
import {
  pgTable, pgEnum, uuid, text, timestamp, boolean, jsonb, index, unique,
} from 'drizzle-orm/pg-core'
import { organizations, profiles } from './schema' // self-reference within same file: keep existing imports; do NOT duplicate

// --- Plan 05 additions -------------------------------------------------------

// Every notification kind the system can emit (PRD §5.14).
export const notificationCategory = pgEnum('notification_category', [
  'task_assigned',
  'task_mention',
  'client_task_created',
  'approval_requested',
  'approval_decided',
  'invoice_paid',
  'invoice_overdue',
  'connection_broken',
  'renewal_due',
  'report_ready',
  'message_received',
])

// In-app notification. user_id = recipient; organization_id = the tenant the
// recipient is acting within (client org for clients, agency org for staff).
export const notifications = pgTable(
  'notification',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    // Deep-link the user can click (e.g. /tasks?task=...). Relative path.
    linkPath: text('link_path'),
    // Arbitrary structured context (task_id, invoice_id, actor, ...).
    data: jsonb('data').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule).
    byOrgUser: index('idx_notification_org_user').on(t.organizationId, t.userId, t.createdAt),
  }),
)

// Per-user, per-category email preference. Absence of a row == default ON.
// Critical categories are enforced ON in code regardless of this row.
export const notificationPrefs = pgTable(
  'notification_pref',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byOrgUser: index('idx_notification_pref_org_user').on(t.organizationId, t.userId),
    uniqUserCategory: unique('uniq_notif_pref_user_category').on(t.userId, t.category),
  }),
)

// Founder-only audit trail of money/security events (PRD §5.14, §9).
// organization_id is nullable: agency-global events (e.g. role change) may have none.
export const auditEvents = pgTable(
  'audit_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    // Who performed it. Nullable for system/automated events.
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    // Stable string, e.g. 'invoice.void', 'connection.grant', 'role.change'.
    action: text('action').notNull(),
    // Logical target, e.g. 'invoice', 'connection', 'membership'.
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byOrg: index('idx_audit_event_org_created').on(t.organizationId, t.createdAt),
    byCreated: index('idx_audit_event_created').on(t.createdAt),
  }),
)

// Claude Skills Library — agency-internal knowledge base (PRD §5.13). Staff only.
export const skillDocs = pgTable(
  'skill_doc',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Owning agency org (skills are not client-scoped; always the agency tenant).
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    tags: jsonb('tags').notNull().default([]), // string[]
    // Markdown body: how-to-use notes, example prompts, links.
    body: text('body').notNull().default(''),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byOrg: index('idx_skill_doc_org_updated').on(t.organizationId, t.updatedAt),
  }),
)
```

> Note: `import { organizations, profiles } from './schema'` above is illustrative — in `schema.ts` those identifiers are already in scope, so do **not** add a self-import. Just append the enum + four `pgTable` blocks and ensure `index`, `boolean`, `jsonb`, `unique` are in the existing `drizzle-orm/pg-core` import.

- [ ] **Step 2: Export row types in `src/db/types.ts`**

Append:
```ts
import type {
  notifications, notificationPrefs, auditEvents, skillDocs,
} from './schema'

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type NotificationPref = typeof notificationPrefs.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
export type NewAuditEvent = typeof auditEvents.$inferInsert
export type SkillDoc = typeof skillDocs.$inferSelect
export type NotificationCategory = Notification['category']
```

- [ ] **Step 3: Generate the migration**

First find the next index:
```bash
cat drizzle/meta/_journal.json
```
Then:
```bash
pnpm db:generate
```
Expected: a new `drizzle/00XX_*.sql` containing `notification_category` enum and the four tables with their indexes.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E 'notification|audit_event|skill_doc'
```
Expected: `notification`, `notification_pref`, `audit_event`, `skill_doc` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): notification, notification_pref, audit_event, skill_doc tables"
```

---

## Task 3: KEYSTONE — RLS isolation tests for all four tables (watch them FAIL)

RLS is not yet enabled on the new tables, so any authenticated user can read every row. Write the tests first, prove they fail, then enable RLS in Task 4. We extend the seed with notification/skill/audit fixtures so the tests have data.

**Files:**
- Modify: `scripts/seed.ts` (add fixtures)
- Create: `tests/rls/notifications.isolation.test.ts`
- Create: `tests/rls/audit.isolation.test.ts`
- Create: `tests/rls/skills.isolation.test.ts`

- [ ] **Step 1: Add fixtures to `scripts/seed.ts`**

Inside `main()`, after the existing memberships are created and before the final `console.log`, append:

```ts
  // --- Plan 05 fixtures ----------------------------------------------------
  // A team member in the agency (needed for staff-scope tests).
  const team = await ensureUser('team@milktreeagency.com', 'Team Member')
  await ensureMembership(team, agency, 'team')

  // One notification for client-one's user, one for client-two's user.
  await db
    .insert(schema.notifications)
    .values([
      {
        organizationId: client1,
        userId: u1,
        category: 'invoice_paid',
        title: 'Invoice paid',
        body: 'Your March retainer invoice was paid.',
        linkPath: '/invoices',
      },
      {
        organizationId: client2,
        userId: u2,
        category: 'report_ready',
        title: 'Your March report is ready',
        linkPath: '/overview',
      },
    ])
    .onConflictDoNothing()

  // One email-pref row for client-one (mutes report_ready emails).
  await db
    .insert(schema.notificationPrefs)
    .values({
      organizationId: client1,
      userId: u1,
      category: 'report_ready',
      emailEnabled: false,
    })
    .onConflictDoNothing({ target: [schema.notificationPrefs.userId, schema.notificationPrefs.category] })

  // One audit event (agency-global) and one skill doc (agency-owned).
  await db
    .insert(schema.auditEvents)
    .values({
      organizationId: agency,
      actorId: founder,
      action: 'seed.bootstrap',
      targetType: 'system',
      after: { note: 'seed audit row' },
    })
    .onConflictDoNothing()

  await db
    .insert(schema.skillDocs)
    .values({
      organizationId: agency,
      title: 'GA4 monthly pull',
      description: 'Prompt to summarise a client GA4 month.',
      category: 'analytics',
      tags: ['ga4', 'reporting'],
      body: '# Usage\nPaste the metric rows and ask for a MoM summary.',
      ownerId: founder,
    })
    .onConflictDoNothing()
```

> `onConflictDoNothing()` without a target relies on PK/unique collisions; the notification/audit/skill inserts have no natural unique key, so on a *fresh* DB they insert once. Re-running the seed after a reset is the expected workflow; if you re-seed without reset you may get duplicate notification rows — acceptable for dev. The tests below assert membership-scoped visibility, not exact counts, so duplicates don't break them.

Run the seed:
```bash
pnpm db:seed
```
Expected: prints IDs; new fixture rows inserted with no error.

- [ ] **Step 2: Write `tests/rls/notifications.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): notification & notification_pref', () => {
  let clientOneUser: string
  let clientTwoUser: string
  let founder: string

  beforeAll(async () => {
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')
    founder = await userIdByEmail('founder@milktreeagency.com')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client sees ONLY their own notifications', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select user_id from public.notification`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.user_id === clientOneUser)).toBe(true)
  })

  it('a client cannot read another client\'s notifications', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select id from public.notification`)
    const otherRows = await sql`
      select n.id from public.notification n
      join public.profiles p on p.id = n.user_id
      where p.email = 'user2@clienttwo.com'`
    const leakedIds = new Set(otherRows.map((r) => r.id))
    expect(rows.some((r) => leakedIds.has(r.id))).toBe(false)
  })

  it('agency staff (founder) can read all notifications', async () => {
    const rows = await asUser(founder, (tx) => tx`select user_id from public.notification`)
    const distinctUsers = new Set(rows.map((r) => r.user_id))
    expect(distinctUsers.size).toBeGreaterThanOrEqual(2)
  })

  it('a client sees ONLY their own notification prefs', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select user_id from public.notification_pref`)
    expect(rows.every((r) => r.user_id === clientOneUser)).toBe(true)
  })

  it('a client cannot read another client\'s prefs', async () => {
    const rows = await asUser(clientTwoUser, (tx) => tx`select user_id from public.notification_pref`)
    expect(rows.some((r) => r.user_id === clientOneUser)).toBe(false)
  })
})
```

- [ ] **Step 3: Write `tests/rls/audit.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): audit_event (Founder-only)', () => {
  let founder: string
  let team: string
  let clientUser: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    team = await userIdByEmail('team@milktreeagency.com')
    clientUser = await userIdByEmail('user1@clientone.com')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('the founder CAN read audit events', async () => {
    const rows = await asUser(founder, (tx) => tx`select id from public.audit_event`)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('a team member CANNOT read audit events', async () => {
    const rows = await asUser(team, (tx) => tx`select id from public.audit_event`)
    expect(rows.length).toBe(0)
  })

  it('a client CANNOT read audit events', async () => {
    const rows = await asUser(clientUser, (tx) => tx`select id from public.audit_event`)
    expect(rows.length).toBe(0)
  })

  it('no authenticated role can INSERT audit events directly (writes are service-role only)', async () => {
    await expect(
      asUser(founder, (tx) => tx`
        insert into public.audit_event (action, target_type)
        values ('tamper.attempt', 'system')`),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Write `tests/rls/skills.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): skill_doc (staff only)', () => {
  let founder: string
  let team: string
  let clientUser: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    team = await userIdByEmail('team@milktreeagency.com')
    clientUser = await userIdByEmail('user1@clientone.com')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('the founder CAN read skill docs', async () => {
    const rows = await asUser(founder, (tx) => tx`select id from public.skill_doc`)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('a team member CAN read skill docs', async () => {
    const rows = await asUser(team, (tx) => tx`select id from public.skill_doc`)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('a client CANNOT read skill docs', async () => {
    const rows = await asUser(clientUser, (tx) => tx`select id from public.skill_doc`)
    expect(rows.length).toBe(0)
  })
})
```

- [ ] **Step 5: Run the new RLS tests and confirm they FAIL**

Run:
```bash
pnpm test tests/rls/notifications.isolation.test.ts tests/rls/audit.isolation.test.ts tests/rls/skills.isolation.test.ts
```
Expected: **FAIL** — RLS is not enabled, so clients read every notification, the team member reads audit events, and the client reads skill docs. The `audit_event` direct-insert test may also currently *succeed* at inserting (so the `rejects.toThrow()` assertion fails). These failures prove the tests are real.

- [ ] **Step 6: Commit the failing tests + seed fixtures**

```bash
git add -A
git commit -m "test(rls): isolation tests for notification/audit/skill (failing, RLS not enabled)"
```

---

## Task 4: Enable RLS + policies on the four tables → make the tests PASS

`notification`/`notification_pref`: a user reads/updates **their own** rows; staff read all (cross-client visibility for the agency feed). Inserts are performed server-side by the `emitNotification()` helper using the user's own session for in-app rows, so we allow `insert` where `user_id = auth.uid()` OR staff. `audit_event`: **select only for the founder**; **no insert/update/delete** for any authenticated role (writes go through service-role in Task 7, which bypasses RLS). `skill_doc`: full CRUD for agency staff only; clients get nothing.

We need a founder-specific predicate. Plan 01 gave us `is_agency_staff()` (founder OR team). Add `is_founder()` here.

**Files:**
- Create: `drizzle/00XX+1_portal_notif_audit_skills_rls.sql` (custom)

- [ ] **Step 1: Create an empty custom migration**

```bash
pnpm db:generate --custom --name=portal_notif_audit_skills_rls
```
Expected: empty `drizzle/00XX+1_portal_notif_audit_skills_rls.sql` registered in the journal.

- [ ] **Step 2: Fill in the SQL**

```sql
-- Helper: is the current user a founder (agency-type org, role 'founder')?
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

-- ---------------------------------------------------------------------------
-- notification
-- ---------------------------------------------------------------------------
alter table public.notification enable row level security;

create policy notification_select on public.notification
  for select using (user_id = auth.uid() or public.is_agency_staff());

-- A user may create their own in-app notifications; staff may create for anyone
-- in an org they can access (used by server-side emit when acting as the user).
create policy notification_insert on public.notification
  for insert with check (
    user_id = auth.uid()
    or (public.is_agency_staff() and public.has_org_access(organization_id))
  );

-- A user may mark their own notifications read; staff may update within reach.
create policy notification_update on public.notification
  for update using (user_id = auth.uid() or public.is_agency_staff())
  with check (user_id = auth.uid() or public.is_agency_staff());

-- ---------------------------------------------------------------------------
-- notification_pref
-- ---------------------------------------------------------------------------
alter table public.notification_pref enable row level security;

create policy notification_pref_select on public.notification_pref
  for select using (user_id = auth.uid() or public.is_agency_staff());

create policy notification_pref_insert on public.notification_pref
  for insert with check (user_id = auth.uid());

create policy notification_pref_update on public.notification_pref
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_event — Founder-only SELECT; NO authenticated writes (service-role only).
-- ---------------------------------------------------------------------------
alter table public.audit_event enable row level security;

create policy audit_event_select on public.audit_event
  for select using (public.is_founder());

-- Intentionally NO insert/update/delete policies: under RLS, the absence of a
-- permissive policy denies the action for non-bypass roles. service_role bypasses
-- RLS and is the only writer (see lib/audit/record.ts).

-- ---------------------------------------------------------------------------
-- skill_doc — agency staff full CRUD; clients none.
-- ---------------------------------------------------------------------------
alter table public.skill_doc enable row level security;

create policy skill_doc_select on public.skill_doc
  for select using (public.is_agency_staff());

create policy skill_doc_insert on public.skill_doc
  for insert with check (public.is_agency_staff() and public.has_org_access(organization_id));

create policy skill_doc_update on public.skill_doc
  for update using (public.is_agency_staff())
  with check (public.is_agency_staff());

create policy skill_doc_delete on public.skill_doc
  for delete using (public.is_agency_staff());
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies with no errors.

- [ ] **Step 4: Run the RLS tests and confirm they PASS**

Run:
```bash
pnpm test tests/rls/notifications.isolation.test.ts tests/rls/audit.isolation.test.ts tests/rls/skills.isolation.test.ts
```
Expected: **all PASS** — clients see only their own notifications/prefs; staff see all; only the founder reads audit events; the direct audit insert is rejected; clients can't read skill docs.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): RLS policies for notification/audit/skill (is_founder helper) — tests pass"
```

---

## Task 5: Notification emit + preferences logic (with critical-override)

A single server-side `emitNotification()` is the only sanctioned way to create a notification. It (a) inserts the in-app row honoring the recipient's `in_app_enabled` pref, and (b) decides whether to send email by consulting `email_enabled` — **except** for critical categories (`invoice_paid`, `invoice_overdue`, `connection_broken`) which are always emailed and always shown, fulfilling PRD §5.14 "mute categories without losing critical (billing/security) alerts." Pure pref logic lives in `prefs.ts` so it is unit-testable without a DB.

**Files:**
- Create: `src/lib/notifications/prefs.ts`
- Create: `src/lib/notifications/emit.ts`
- Create: `src/lib/notifications/queries.ts`
- Create: `tests/notifications/emit.test.ts`

- [ ] **Step 1: Write the failing unit test `tests/notifications/emit.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { CRITICAL_CATEGORIES, resolveDelivery } from '@/lib/notifications/prefs'

describe('notification preference resolution', () => {
  it('marks billing/security categories as critical', () => {
    expect(CRITICAL_CATEGORIES).toContain('invoice_paid')
    expect(CRITICAL_CATEGORIES).toContain('invoice_overdue')
    expect(CRITICAL_CATEGORIES).toContain('connection_broken')
  })

  it('respects a user mute for a non-critical category', () => {
    const d = resolveDelivery('report_ready', { emailEnabled: false, inAppEnabled: false })
    expect(d.email).toBe(false)
    expect(d.inApp).toBe(false)
  })

  it('ignores mutes for a critical category (always delivered)', () => {
    const d = resolveDelivery('invoice_overdue', { emailEnabled: false, inAppEnabled: false })
    expect(d.email).toBe(true)
    expect(d.inApp).toBe(true)
  })

  it('defaults to both channels ON when no pref row exists', () => {
    const d = resolveDelivery('task_assigned', null)
    expect(d.email).toBe(true)
    expect(d.inApp).toBe(true)
  })
})
```

Run: `pnpm test tests/notifications/emit.test.ts`
Expected: **FAIL** — `prefs.ts` does not exist yet (module not found).

- [ ] **Step 2: Implement `src/lib/notifications/prefs.ts`**

```ts
import type { NotificationCategory } from '@/db/types'

// Billing + security categories that can never be muted (PRD §5.14).
export const CRITICAL_CATEGORIES: readonly NotificationCategory[] = [
  'invoice_paid',
  'invoice_overdue',
  'connection_broken',
] as const

export function isCritical(category: NotificationCategory): boolean {
  return CRITICAL_CATEGORIES.includes(category)
}

export type PrefRow = { emailEnabled: boolean; inAppEnabled: boolean } | null

export type Delivery = { email: boolean; inApp: boolean }

// Decide delivery channels for a category given the user's stored pref (or null
// = no row = defaults ON). Critical categories override any mute.
export function resolveDelivery(category: NotificationCategory, pref: PrefRow): Delivery {
  if (isCritical(category)) return { email: true, inApp: true }
  if (!pref) return { email: true, inApp: true }
  return { email: pref.emailEnabled, inApp: pref.inAppEnabled }
}
```

Run: `pnpm test tests/notifications/emit.test.ts`
Expected: **PASS**.

- [ ] **Step 3: Implement `src/lib/notifications/emit.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { notifications, notificationPrefs } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NotificationCategory } from '@/db/types'
import { resolveDelivery } from './prefs'
import { inngest } from '@/lib/inngest/client'

export type EmitInput = {
  organizationId: string
  userId: string
  category: NotificationCategory
  title: string
  body?: string
  linkPath?: string
  data?: Record<string, unknown>
}

// The ONLY sanctioned way to create a notification. Inserts the in-app row (if
// the user hasn't muted in-app for this category, unless critical) and enqueues
// an email via Inngest (if email is enabled / critical).
export async function emitNotification(input: EmitInput): Promise<void> {
  const [pref] = await db
    .select({
      emailEnabled: notificationPrefs.emailEnabled,
      inAppEnabled: notificationPrefs.inAppEnabled,
    })
    .from(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.userId, input.userId),
        eq(notificationPrefs.category, input.category),
      ),
    )
    .limit(1)

  const delivery = resolveDelivery(input.category, pref ?? null)

  if (delivery.inApp) {
    await db.insert(notifications).values({
      organizationId: input.organizationId,
      userId: input.userId,
      category: input.category,
      title: input.title,
      body: input.body,
      linkPath: input.linkPath,
      data: input.data ?? {},
    })
  }

  if (delivery.email) {
    await inngest.send({
      name: 'notification/email.requested',
      data: {
        userId: input.userId,
        category: input.category,
        title: input.title,
        body: input.body ?? '',
        linkPath: input.linkPath ?? '/',
      },
    })
  }
}
```

> `db` here is the service-side Drizzle client from Plan 01 (`src/db/index.ts`). Because earlier modules call `emitNotification()` inside Server Actions that already hold the acting user's session for their own writes, the in-app insert satisfies the `notification_insert` policy (`user_id = auth.uid()` for self-notifications, or staff inserting within an accessible org). For fan-out from background jobs (no user session), call the service-role variant in Task 7's pattern. Keep `emitNotification()` for request-scoped emits.

- [ ] **Step 4: Implement `src/lib/notifications/queries.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { notifications } from '@/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'

export async function listNotifications(userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return rows.length
}
```

> These read via the Plan 01 server Drizzle client; RLS still applies at the DB level through the request session for portal/internal pages because pages run Server Components that read using the user's cookies (Plan 01's `createSupabaseServerClient` path for auth + RLS-scoped queries). Where a page reads via the raw Drizzle client, the explicit `eq(userId)` filter provides defense-in-depth on top of RLS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notif): emitNotification + critical-override pref logic (tests pass)"
```

---

## Task 6: Resend email template + Inngest send function

The Inngest function consumes `notification/email.requested`, looks up the recipient's email, and sends via Resend — or logs when Resend is the local placeholder. This keeps `emitNotification()` fast (fire-and-enqueue) and gives retries/observability per PRD §10 (Inngest) and §5.14 (Resend email).

**Files:**
- Create: `src/lib/email/templates/notification.tsx`
- Create: `src/lib/inngest/functions/send-notification-email.ts`
- Modify/Create: `src/app/api/inngest/route.ts`

- [ ] **Step 1: React Email template `src/lib/email/templates/notification.tsx`**

```tsx
import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'

export type NotificationEmailProps = {
  title: string
  body: string
  linkPath: string
  appUrl: string
}

export function NotificationEmail({ title, body, linkPath, appUrl }: NotificationEmailProps) {
  const href = `${appUrl}${linkPath}`
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f6f6f6' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '8px' }}>
          <Heading style={{ fontSize: '18px', margin: '0 0 12px' }}>Agency OS</Heading>
          <Section>
            <Text style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px' }}>{title}</Text>
            {body ? <Text style={{ fontSize: '14px', color: '#444' }}>{body}</Text> : null}
            <Link href={href} style={{ fontSize: '14px', color: '#2563eb' }}>
              Open in Agency OS
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default NotificationEmail
```

- [ ] **Step 2: Inngest function `src/lib/inngest/functions/send-notification-email.ts`**

```ts
import { inngest } from '@/lib/inngest/client'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { render } from '@react-email/components'
import { resend, isEmailConfigured, EMAIL_FROM } from '@/lib/email/client'
import { NotificationEmail } from '@/lib/email/templates/notification'

export const sendNotificationEmail = inngest.createFunction(
  { id: 'send-notification-email', retries: 3 },
  { event: 'notification/email.requested' },
  async ({ event, step }) => {
    const { userId, title, body, linkPath } = event.data as {
      userId: string
      title: string
      body: string
      linkPath: string
    }

    const email = await step.run('lookup-recipient', async () => {
      const [row] = await db
        .select({ email: profiles.email })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1)
      return row?.email ?? null
    })

    if (!email) return { skipped: 'no-email' }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const html = await render(NotificationEmail({ title, body, linkPath, appUrl }))

    if (!isEmailConfigured) {
      // Local/dev: do not hit Resend with a placeholder key.
      console.log('[email:dev] would send', { to: email, title })
      return { skipped: 'email-not-configured' }
    }

    await step.run('send-resend', async () => {
      await resend.emails.send({ from: EMAIL_FROM, to: email, subject: title, html })
    })

    return { sent: true }
  },
)
```

- [ ] **Step 3: Register the function at `src/app/api/inngest/route.ts`**

If this route already exists (from Plan 02/03), add `sendNotificationEmail` to the `functions` array. Otherwise create it:

```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { sendNotificationEmail } from '@/lib/inngest/functions/send-notification-email'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendNotificationEmail],
})
```

- [ ] **Step 4: Smoke-test the enqueue path**

Run the Inngest dev server in one terminal and the app in another:
```bash
pnpm dlx inngest-cli@latest dev
pnpm dev
```
Then trigger an emit from a Node REPL or temporary route, or rely on Task 8/9 UI actions. Expected: the Inngest dashboard shows a `notification/email.requested` run that logs `[email:dev] would send` (placeholder key) with no error.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notif): Resend email template + Inngest send function"
```

---

## Task 7: Audit log helper (service-role, immutable) + verification test

Audit writes must succeed even when RLS would deny (the founder cannot insert, by design). We use a dedicated **service-role** Postgres connection that bypasses RLS, exactly as PRD §9 allows (`service_role` for admin/jobs, never user-facing reads). `recordAuditEvent()` captures actor, action, target, and before/after JSON. Reads happen through the normal RLS-scoped path (founder-only policy from Task 4).

**Files:**
- Create: `src/lib/audit/record.ts`
- Create: `tests/audit/record.test.ts`

- [ ] **Step 1: Write the failing test `tests/audit/record.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, userIdByEmail } from '../helpers/db'
import { recordAuditEvent } from '@/lib/audit/record'

describe('audit log', () => {
  let founder: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('records an event with actor, action, target and before/after', async () => {
    await recordAuditEvent({
      actorId: founder,
      action: 'invoice.void',
      targetType: 'invoice',
      targetId: 'inv_test_123',
      before: { status: 'open' },
      after: { status: 'void' },
    })

    const rows = await sql`
      select action, target_type, target_id, before, after, actor_id
      from public.audit_event
      where action = 'invoice.void' and target_id = 'inv_test_123'
      order by created_at desc limit 1`

    expect(rows[0]).toBeTruthy()
    expect(rows[0]!.action).toBe('invoice.void')
    expect(rows[0]!.target_type).toBe('invoice')
    expect(rows[0]!.before.status).toBe('open')
    expect(rows[0]!.after.status).toBe('void')
    expect(rows[0]!.actor_id).toBe(founder)
  })
})
```

Run: `pnpm test tests/audit/record.test.ts`
Expected: **FAIL** — `src/lib/audit/record.ts` does not exist.

- [ ] **Step 2: Implement `src/lib/audit/record.ts`**

```ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

// Dedicated service-role connection: bypasses RLS so audit rows can be written
// even though NO authenticated role is permitted to insert into audit_event.
// Per PRD §9, service_role is used only for admin/jobs, never user-facing reads.
const auditClient = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const auditDb = drizzle(auditClient, { schema })

export type AuditInput = {
  actorId?: string | null
  organizationId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  before?: unknown
  after?: unknown
  ipAddress?: string | null
}

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  await auditDb.insert(schema.auditEvents).values({
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    ipAddress: input.ipAddress ?? null,
  })
}
```

> In production, point `recordAuditEvent` at a connection authenticated as `service_role` (set the role on the connection, e.g. via a `SUPABASE_DB_URL` with the service-role credentials). Locally, the default `postgres` superuser connection from Plan 01's `DATABASE_URL` already bypasses RLS, so the test passes as written. Document this swap in the deploy runbook.

Run: `pnpm test tests/audit/record.test.ts`
Expected: **PASS**.

- [ ] **Step 3: Wire the audit events this plan owns**

These are the money/security events from PRD §5.14 that surface in earlier modules. Where the relevant Server Action lives in Plan 02–04, add a `recordAuditEvent(...)` call inside it. List them so the developer can grep for each action and add the call:

```ts
// In Finance (Plan 03) invoice void action, after the status flip:
await recordAuditEvent({
  actorId: session.userId,
  organizationId: invoice.organizationId,
  action: 'invoice.void',
  targetType: 'invoice',
  targetId: invoice.id,
  before: { status: prevStatus },
  after: { status: 'void' },
})

// In Connections (Plan 04) grant/revoke action:
await recordAuditEvent({
  actorId: session.userId,
  organizationId: connection.organizationId,
  action: grant ? 'connection.grant' : 'connection.revoke',
  targetType: 'connection',
  targetId: connection.id,
  after: { provider: connection.provider, status: connection.status },
})
```

> If Plans 03/04's actions are not yet present in the tree, leave a tracked checkbox: the helper is complete and unit-tested; the call sites are added when those actions exist. This plan's deliverable is the helper + the audit table + the viewer (Task 11); call-site wiring is a one-line insert per privileged action.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(audit): immutable recordAuditEvent helper (service-role) + test"
```

---

## Task 8: Skills Library — data access, Server Actions, and pages

Agency-staff CRUD knowledge base (PRD §5.13). Search/filter by title/tag; markdown body; owner + last-updated. RLS already restricts to staff (Task 4); the UI lives under `(internal)/skills`.

**Files:**
- Create: `src/lib/skills/queries.ts`
- Create: `src/actions/skills.ts`
- Create: `src/components/skills/skill-form.tsx`
- Create: `src/app/(internal)/skills/page.tsx`
- Create: `src/app/(internal)/skills/new/page.tsx`
- Create: `src/app/(internal)/skills/[id]/page.tsx`

- [ ] **Step 1: Data access `src/lib/skills/queries.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { skillDocs } from '@/db/schema'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'

export async function listSkills(orgId: string, q?: string) {
  const base = eq(skillDocs.organizationId, orgId)
  const where = q
    ? and(
        base,
        or(
          ilike(skillDocs.title, `%${q}%`),
          ilike(skillDocs.description, `%${q}%`),
          // tags is jsonb string[]; match if any tag ILIKEs the query.
          sql`exists (select 1 from jsonb_array_elements_text(${skillDocs.tags}) t where t ilike ${'%' + q + '%'})`,
        ),
      )
    : base
  return db.select().from(skillDocs).where(where).orderBy(desc(skillDocs.updatedAt))
}

export async function getSkill(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(skillDocs)
    .where(and(eq(skillDocs.organizationId, orgId), eq(skillDocs.id, id)))
    .limit(1)
  return row ?? null
}
```

- [ ] **Step 2: Server Actions `src/actions/skills.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { skillDocs } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSession, isStaff } from '@/lib/auth'

function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string') return []
  return raw.split(',').map((t) => t.trim()).filter(Boolean)
}

export async function createSkill(formData: FormData) {
  const session = await getSession()
  if (!session || !isStaff(session.role) || !session.orgId) throw new Error('forbidden')

  await db.insert(skillDocs).values({
    organizationId: session.orgId,
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    tags: parseTags(formData.get('tags')),
    body: String(formData.get('body') ?? ''),
    ownerId: session.userId,
  })
  revalidatePath('/skills')
  redirect('/skills')
}

export async function updateSkill(id: string, formData: FormData) {
  const session = await getSession()
  if (!session || !isStaff(session.role) || !session.orgId) throw new Error('forbidden')

  await db
    .update(skillDocs)
    .set({
      title: String(formData.get('title') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim() || null,
      category: String(formData.get('category') ?? '').trim() || null,
      tags: parseTags(formData.get('tags')),
      body: String(formData.get('body') ?? ''),
      updatedAt: new Date(),
    })
    .where(and(eq(skillDocs.organizationId, session.orgId), eq(skillDocs.id, id)))
  revalidatePath('/skills')
  revalidatePath(`/skills/${id}`)
  redirect(`/skills/${id}`)
}

export async function deleteSkill(id: string) {
  const session = await getSession()
  if (!session || !isStaff(session.role) || !session.orgId) throw new Error('forbidden')
  await db.delete(skillDocs).where(and(eq(skillDocs.organizationId, session.orgId), eq(skillDocs.id, id)))
  revalidatePath('/skills')
  redirect('/skills')
}
```

- [ ] **Step 3: Form component `src/components/skills/skill-form.tsx`**

```tsx
import { Button } from '@/components/ui/button'
import type { SkillDoc } from '@/db/types'

export function SkillForm({
  action,
  skill,
}: {
  action: (formData: FormData) => void | Promise<void>
  skill?: SkillDoc
}) {
  return (
    <form action={action} className="flex flex-col gap-3 max-w-2xl">
      <input
        name="title"
        defaultValue={skill?.title ?? ''}
        placeholder="Title"
        required
        className="rounded border p-2"
      />
      <input
        name="description"
        defaultValue={skill?.description ?? ''}
        placeholder="Short description"
        className="rounded border p-2"
      />
      <input
        name="category"
        defaultValue={skill?.category ?? ''}
        placeholder="Category (e.g. analytics)"
        className="rounded border p-2"
      />
      <input
        name="tags"
        defaultValue={Array.isArray(skill?.tags) ? (skill!.tags as string[]).join(', ') : ''}
        placeholder="Tags (comma-separated)"
        className="rounded border p-2"
      />
      <textarea
        name="body"
        defaultValue={skill?.body ?? ''}
        placeholder="How-to-use notes, example prompts (markdown)"
        rows={12}
        className="rounded border p-2 font-mono text-sm"
      />
      <Button type="submit">Save</Button>
    </form>
  )
}
```

- [ ] **Step 4: List page `src/app/(internal)/skills/page.tsx`**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { listSkills } from '@/lib/skills/queries'
import { Button } from '@/components/ui/button'

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role) || !session.orgId) redirect('/overview')

  const { q } = await searchParams
  const skills = await listSkills(session.orgId, q)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Claude Skills Library</h1>
        <Button asChild>
          <Link href="/skills/new">New skill</Link>
        </Button>
      </div>
      <form className="mb-4">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by title or tag…"
          className="w-full max-w-md rounded border p-2"
        />
      </form>
      <ul className="flex flex-col gap-2">
        {skills.map((s) => (
          <li key={s.id} className="rounded border p-3">
            <Link href={`/skills/${s.id}`} className="font-medium">
              {s.title}
            </Link>
            {s.description ? <p className="text-sm text-muted-foreground">{s.description}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {(s.tags as string[]).join(' · ')}
            </p>
          </li>
        ))}
        {skills.length === 0 ? <p className="text-sm text-muted-foreground">No skills yet.</p> : null}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: New page `src/app/(internal)/skills/new/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { createSkill } from '@/actions/skills'
import { SkillForm } from '@/components/skills/skill-form'

export default async function NewSkillPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')
  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">New skill</h1>
      <SkillForm action={createSkill} />
    </div>
  )
}
```

- [ ] **Step 6: Detail/edit page `src/app/(internal)/skills/[id]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { getSkill } from '@/lib/skills/queries'
import { updateSkill, deleteSkill } from '@/actions/skills'
import { SkillForm } from '@/components/skills/skill-form'
import { Button } from '@/components/ui/button'

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role) || !session.orgId) redirect('/overview')

  const { id } = await params
  const skill = await getSkill(session.orgId, id)
  if (!skill) notFound()

  const update = updateSkill.bind(null, id)
  const remove = deleteSkill.bind(null, id)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Edit skill</h1>
        <form action={remove}>
          <Button type="submit" variant="destructive">
            Delete
          </Button>
        </form>
      </div>
      <SkillForm action={update} skill={skill} />
    </div>
  )
}
```

- [ ] **Step 7: Manual smoke test**

Run `pnpm dev`, sign in as `founder@milktreeagency.com`, visit `/skills`:
1. See the seeded "GA4 monthly pull" skill.
2. Search "ga4" → it appears; search "zzz" → empty state.
3. Create a new skill → redirected to list with the new row.
4. Open it, edit the title, save → change persists.
Sign in as `user1@clientone.com` and visit `/skills` → redirected to `/overview` (clients have no Skills access).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(skills): Claude Skills Library CRUD (staff-only) with search"
```

---

## Task 9: Notification feed UI + Server Actions (shared by portal & internal)

A shared `NotificationList` component renders the feed; `(portal)/notifications` and `(internal)/notifications` both use it. Server Actions mark single/all read and update prefs.

**Files:**
- Create: `src/components/notifications/notification-list.tsx`
- Create: `src/actions/notifications.ts`
- Create: `src/app/(internal)/notifications/page.tsx`
- Create: `src/app/(portal)/notifications/page.tsx`

- [ ] **Step 1: Server Actions `src/actions/notifications.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { notifications, notificationPrefs } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import type { NotificationCategory } from '@/db/types'

export async function markRead(id: string) {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, session.userId)))
  revalidatePath('/notifications')
}

export async function markAllRead() {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt)))
  revalidatePath('/notifications')
}

export async function updatePref(category: NotificationCategory, formData: FormData) {
  const session = await getSession()
  if (!session || !session.orgId) throw new Error('unauthenticated')
  const emailEnabled = formData.get('emailEnabled') === 'on'
  const inAppEnabled = formData.get('inAppEnabled') === 'on'
  await db
    .insert(notificationPrefs)
    .values({
      organizationId: session.orgId,
      userId: session.userId,
      category,
      emailEnabled,
      inAppEnabled,
    })
    .onConflictDoUpdate({
      target: [notificationPrefs.userId, notificationPrefs.category],
      set: { emailEnabled, inAppEnabled, updatedAt: new Date() },
    })
  revalidatePath('/notifications')
}
```

- [ ] **Step 2: Shared feed component `src/components/notifications/notification-list.tsx`**

```tsx
import Link from 'next/link'
import type { Notification } from '@/db/types'
import { markRead, markAllRead } from '@/actions/notifications'
import { Button } from '@/components/ui/button'

export function NotificationList({ items }: { items: Notification[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Notifications</h1>
        <form action={markAllRead}>
          <Button type="submit" variant="outline" size="sm">
            Mark all read
          </Button>
        </form>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((n) => {
          const mark = markRead.bind(null, n.id)
          return (
            <li
              key={n.id}
              className={`rounded border p-3 ${n.readAt ? 'opacity-60' : 'bg-accent/30'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  {n.linkPath ? (
                    <Link href={n.linkPath} className="font-medium">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{n.title}</span>
                  )}
                  {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                </div>
                {!n.readAt ? (
                  <form action={mark}>
                    <Button type="submit" variant="ghost" size="sm">
                      Mark read
                    </Button>
                  </form>
                ) : null}
              </div>
            </li>
          )
        })}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">You're all caught up.</p>
        ) : null}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Internal feed page `src/app/(internal)/notifications/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { listNotifications } from '@/lib/notifications/queries'
import { NotificationList } from '@/components/notifications/notification-list'

export default async function InternalNotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isStaff(session.role)) redirect('/overview')
  const items = await listNotifications(session.userId)
  return <NotificationList items={items} />
}
```

- [ ] **Step 4: Portal feed page `src/app/(portal)/notifications/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { listNotifications } from '@/lib/notifications/queries'
import { NotificationList } from '@/components/notifications/notification-list'

export default async function PortalNotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  const items = await listNotifications(session.userId)
  return <NotificationList items={items} />
}
```

- [ ] **Step 5: Manual smoke test**

`pnpm dev`; sign in as `user1@clientone.com`, visit `/notifications` → see the seeded "Invoice paid" notification; click "Mark read" → it dims; "Mark all read" clears the unread highlight. Sign in as founder, visit `/notifications` → staff feed renders.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(notif): in-app feed UI + mark-read/prefs server actions"
```

---

## Task 10: Client Portal composition shell (branded, client-scoped)

Compose the portal's Overview, Tasks, and Invoices from the already-built Plan 02 (Tasks) and Plan 03 (Finance) data-access functions. The shell is white-labeled with the client org's name/branding (PRD §5.15). Every page redirects staff away (no portal chrome for staff) and unauthenticated users to login. We assume Plan 02 exposes a task query (e.g. `listTasksForClient(orgId)`) and Plan 03 an invoice query (e.g. `listInvoicesForClient(orgId)`); if their exact names differ, adapt the import — the composition pattern is the deliverable.

**Files:**
- Modify: `src/app/(portal)/layout.tsx`
- Create: `src/components/portal/brand-header.tsx`
- Modify: `src/app/(portal)/overview/page.tsx`
- Create: `src/app/(portal)/tasks/page.tsx`
- Create: `src/app/(portal)/invoices/page.tsx`

- [ ] **Step 1: White-label header `src/components/portal/brand-header.tsx`**

```tsx
import Link from 'next/link'

const PORTAL_NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/notifications', label: 'Notifications' },
]

export function BrandHeader({ orgName }: { orgName: string }) {
  return (
    <header className="mb-6 border-b pb-4">
      <div className="flex items-center justify-between">
        {/* White-label: client org name as the brand; no third-party logos. */}
        <span className="text-base font-semibold">{orgName}</span>
        <span className="text-xs text-muted-foreground">Powered by Agency OS</span>
      </div>
      <nav className="mt-3 flex gap-4 text-sm text-muted-foreground">
        {PORTAL_NAV.map((item) => (
          <Link key={item.href} href={item.href} className="hover:text-foreground">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
```

- [ ] **Step 2: Branded portal layout `src/app/(portal)/layout.tsx`**

Replace the Plan 01 stub with a branded shell that loads the client org name. RLS scopes the org read to the client's own org.

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { db } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { BrandHeader } from '@/components/portal/brand-header'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Staff never see portal chrome.
  if (isStaff(session.role)) redirect('/cockpit')

  let orgName = 'Client Portal'
  if (session.orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.orgId))
      .limit(1)
    if (org) orgName = org.name
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <BrandHeader orgName={orgName} />
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Overview page `src/app/(portal)/overview/page.tsx`**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
import { listNotifications } from '@/lib/notifications/queries'
import { Card } from '@/components/ui/card'

export default async function Overview() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')

  const recent = (await listNotifications(session.userId, 5)).filter((n) => !n.readAt)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Latest report</p>
          <Link href="/overview" className="text-sm font-medium">
            View reports
          </Link>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Open tasks</p>
          <Link href="/tasks" className="text-sm font-medium">
            Go to your board
          </Link>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Invoices</p>
          <Link href="/invoices" className="text-sm font-medium">
            View &amp; pay
          </Link>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {recent.map((n) => (
            <li key={n.id}>
              {n.linkPath ? <Link href={n.linkPath}>{n.title}</Link> : n.title}
            </li>
          ))}
          {recent.length === 0 ? (
            <li className="text-muted-foreground">Nothing new right now.</li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Portal Tasks page `src/app/(portal)/tasks/page.tsx`**

Re-use the Plan 02 client task data access. RLS guarantees the client only sees their own org's board; we also pass `session.orgId` explicitly (defense in depth).

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
// Provided by Plan 02 (Tasks). Adjust the import path/name to match Plan 02.
import { listTasksForClient } from '@/lib/tasks/queries'

export default async function PortalTasks() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  if (!session.orgId) redirect('/login')

  const tasks = await listTasksForClient(session.orgId)

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Your tasks</h1>
      <ul className="flex flex-col gap-2">
        {tasks.map((t) => (
          <li key={t.id} className="rounded border p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t.title}</span>
              <span className="text-xs text-muted-foreground">{t.status}</span>
            </div>
            {t.origin === 'client' ? (
              <span className="text-[10px] uppercase tracking-wide text-blue-600">
                Created by you
              </span>
            ) : null}
          </li>
        ))}
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : null}
      </ul>
    </div>
  )
}
```

> If Plan 02 named the function differently (e.g. `getClientBoard`), update the import. The point of this task is composition + scoping, not re-implementing Tasks. The full interactive board (dnd-kit, two-way create/comment) is Plan 02's deliverable rendered here; this page lists the client-scoped tasks and the "created by you" badge required by PRD §5.2.

- [ ] **Step 5: Portal Invoices page `src/app/(portal)/invoices/page.tsx`**

Re-use Plan 03 finance data access; render outstanding balance + a Pay button linking to the Stripe-hosted invoice URL (PRD §5.8 — never trust the redirect; the webhook reconciles status).

```tsx
import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@/lib/auth'
// Provided by Plan 03 (Finance). Adjust the import path/name to match Plan 03.
import { listInvoicesForClient } from '@/lib/finance/queries'
import { Button } from '@/components/ui/button'

function formatMoney(totalMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(totalMinor / 100)
}

export default async function PortalInvoices() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (isStaff(session.role)) redirect('/cockpit')
  if (!session.orgId) redirect('/login')

  const invoices = await listInvoicesForClient(session.orgId)

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Invoices</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Invoice</th>
            <th>Status</th>
            <th>Total</th>
            <th>Due</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b">
              <td className="py-2">{inv.id.slice(0, 8)}</td>
              <td>{inv.status}</td>
              <td>{formatMoney(inv.total, inv.currency)}</td>
              <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB') : '—'}</td>
              <td className="text-right">
                {inv.status !== 'paid' && inv.hostedUrl ? (
                  <Button asChild size="sm">
                    <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer">
                      Pay
                    </a>
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {invoices.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No invoices yet.</p>
      ) : null}
    </div>
  )
}
```

> Field names (`total`, `currency`, `hostedUrl`, `dueDate`, `status`) follow PRD §8's `invoice` shape; map to Plan 03's actual Drizzle column names if they differ. The Pay button opens the Stripe-hosted page in a new tab; reconciliation is handled by Plan 03's webhook.

- [ ] **Step 6: Manual smoke test**

`pnpm dev`; sign in as `user1@clientone.com`:
1. `/overview` shows the branded header with "Client One Ltd" and "Powered by Agency OS", three cards, and recent activity.
2. `/tasks` and `/invoices` render client-scoped data (or empty states if Plans 02/03 have no seed rows).
3. Visiting `/cockpit` or `/skills` redirects to `/overview` (no internal chrome).
Sign in as founder: visiting `/overview`/`/tasks`/`/invoices` redirects to `/cockpit` (no portal chrome for staff).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(portal): branded client portal shell (overview/tasks/invoices) wired to plans 02-03"
```

---

## Task 11: Founder-only Audit Log viewer

A read-only table at `/settings/audit`, gated to the founder by both the page guard and the Task 4 RLS policy. Reads through the RLS-scoped Drizzle path so a non-founder gets zero rows even if the route guard were bypassed.

**Files:**
- Create: `src/app/(internal)/settings/audit/page.tsx`

- [ ] **Step 1: Add a founder check to `src/lib/auth.ts`**

Append to the existing `auth.ts`:
```ts
export function isFounder(role: AppRole | null): boolean {
  return role === 'founder'
}
```

- [ ] **Step 2: Audit viewer page `src/app/(internal)/settings/audit/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession, isFounder } from '@/lib/auth'
import { db } from '@/db'
import { auditEvents, profiles } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'

export default async function AuditLogPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isFounder(session.role)) redirect('/cockpit')

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      actorEmail: profiles.email,
      createdAt: auditEvents.createdAt,
      before: auditEvents.before,
      after: auditEvents.after,
    })
    .from(auditEvents)
    .leftJoin(profiles, eq(profiles.id, auditEvents.actorId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200)

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Audit Log</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="py-2 whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString('en-GB')}
              </td>
              <td>{r.actorEmail ?? 'system'}</td>
              <td className="font-mono text-xs">{r.action}</td>
              <td className="text-xs">
                {r.targetType}
                {r.targetId ? `:${r.targetId.slice(0, 8)}` : ''}
              </td>
              <td className="max-w-xs">
                <pre className="overflow-x-auto text-[10px] text-muted-foreground">
                  {JSON.stringify({ before: r.before, after: r.after })}
                </pre>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-3 text-muted-foreground">
                No audit events yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

`pnpm dev`; sign in as founder, visit `/settings/audit` → see the seeded `seed.bootstrap` row (and any from Task 7's test if run against the same DB). Sign in as `team@milktreeagency.com`, visit `/settings/audit` → redirected to `/cockpit`. Sign in as a client → redirected to `/overview`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(audit): Founder-only audit log viewer at /settings/audit"
```

---

## Task 12: Cross-surface isolation test (portal vs internal) — release gate

PRD §5.15 requires an automated test that a client can reach **nothing** internal and a staff user sees no portal chrome. Plan 01's RLS tests cover the data layer; this covers the **routing/role** layer by asserting the layout/page guards behave correctly. We test the pure guard logic (the `isStaff`/`isFounder` decisions the layouts use) plus an assertion that every portal page redirects staff and every internal page redirects clients.

**Files:**
- Create: `tests/portal/surface-isolation.test.ts`

- [ ] **Step 1: Write `tests/portal/surface-isolation.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isStaff, isFounder } from '@/lib/auth'

// These mirror the exact guard decisions the (portal) and (internal) layouts make.
// Portal pages: redirect when isStaff(role) === true.
// Internal pages: redirect when isStaff(role) === false.
// Audit page: redirect when isFounder(role) === false.

describe('cross-surface isolation (routing guards)', () => {
  it('client role is NOT staff and NOT founder (kept out of internal + audit)', () => {
    expect(isStaff('client')).toBe(false)
    expect(isFounder('client')).toBe(false)
  })

  it('team role IS staff but NOT founder (in internal, out of audit)', () => {
    expect(isStaff('team')).toBe(true)
    expect(isFounder('team')).toBe(false)
  })

  it('founder role IS staff AND founder (full internal + audit)', () => {
    expect(isStaff('founder')).toBe(true)
    expect(isFounder('founder')).toBe(true)
  })

  it('a null role (no membership) is treated as non-staff, non-founder', () => {
    expect(isStaff(null)).toBe(false)
    expect(isFounder(null)).toBe(false)
  })

  // Encodes the guard contract for each surface as data so a reviewer can see it.
  it('guard contract: who may render each surface', () => {
    type Role = 'founder' | 'team' | 'client'
    const canRenderPortal = (r: Role) => !isStaff(r) // portal layout redirects staff
    const canRenderInternal = (r: Role) => isStaff(r) // internal layout redirects clients
    const canRenderAudit = (r: Role) => isFounder(r) // audit page redirects non-founders

    expect(canRenderPortal('client')).toBe(true)
    expect(canRenderPortal('team')).toBe(false)
    expect(canRenderPortal('founder')).toBe(false)

    expect(canRenderInternal('client')).toBe(false)
    expect(canRenderInternal('team')).toBe(true)
    expect(canRenderInternal('founder')).toBe(true)

    expect(canRenderAudit('client')).toBe(false)
    expect(canRenderAudit('team')).toBe(false)
    expect(canRenderAudit('founder')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/portal/surface-isolation.test.ts`
Expected: **PASS** — the guard decisions are correct for all roles.

- [ ] **Step 3: Run the full suite (mirror CI)**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all tests pass — Plan 01 RLS + auth-claims, plus this plan's notification/audit/skill RLS isolation, emit pref logic, audit record, and surface isolation.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(portal): cross-surface isolation gate (client vs internal vs audit)"
```

---

## Self-Review

**Spec coverage (vs PRD §5.13 Skills, §5.14 Notifications & Audit, §5.15 Client Portal, §8 Data Model, §9 Security):**

- **§5.15 Client Portal (composition):** branded shell (`BrandHeader`, "Powered by Agency OS", no third-party logos) → Task 10; Overview (KPI cards + latest-report link + recent activity), Tasks (client-scoped, "created by you" badge), Invoices (status + Pay button to Stripe-hosted URL) wired to Plan 02/03 data access → Task 10. The acceptance "a client can reach nothing internal" is enforced by the portal layout staff-redirect + internal layout client-redirect and proven by the cross-surface test → Task 12. ✅
- **§5.14 Notifications:** in-app + Resend email → Tasks 5/6/9; all PRD categories present in the `notification_category` enum → Task 2; per-user preferences with the mandated **critical (billing/security) override** (`invoice_paid`/`invoice_overdue`/`connection_broken` un-mutable) → Task 5 (`resolveDelivery`/`CRITICAL_CATEGORIES`) + unit test. ✅
- **§5.14 Audit log (Founder-only):** `audit_event` with actor, timestamp, before/after, target → Task 2; Founder-only SELECT + no authenticated writes (service-role only, immutable to users) → Task 4; `recordAuditEvent()` helper + the money/security call-sites (invoice void, connection grant/revoke) → Task 7; Founder-only viewer → Task 11. "Every money/security action writes an immutable audit row" — helper + table + wiring list provided. ✅
- **§5.13 Skills Library:** `skill_doc` with title, description, category/tags, how-to-use markdown body, owner, last-updated → Task 2; CRUD + search/filter, staff-only → Tasks 4 & 8; "find a skill by name/tag in <10s" via the search box. ✅
- **§8 Data Model:** table names `notification`, `notification_pref`, `audit_event`, `skill_doc` used exactly; tenant column `organization_id` is the **leading** column of a composite index on every tenant-scoped table (`idx_notification_org_user`, `idx_notification_pref_org_user`, `idx_audit_event_org_created`, `idx_skill_doc_org_updated`) per the §9 performance rule. ✅
- **§9 Security:** RLS enabled on all four tables; policies REUSE Plan 01 helpers `has_org_access()`/`is_agency_staff()` and add `is_founder()`; `service_role` used only for audit writes/jobs, never user-facing reads; every new tenant-scoped table has an RLS isolation test using the Plan 01 `asUser()` harness (Tasks 3/4). Defense-in-depth: pages also filter by `userId`/`orgId` explicitly. ✅
- **Dependencies (Plans 01–04):** reuses Plan 01 tenancy/helpers/harness; composes Plan 02 task queries and Plan 03 invoice queries; audit wiring references Plan 03 (invoice void) and Plan 04 (connection grant/revoke) Server Actions — not re-spec'd. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to above". Every code step contains complete code. The only deferred items are explicit, justified integration seams: (a) the exact Plan 02/03 query function names (the plan states the expected signature and tells the builder to adapt the import); (b) the audit call-site inserts inside Plan 03/04 actions (full insert code given; gated on those actions existing); (c) the production service-role connection string swap for `recordAuditEvent` (documented). These are integration instructions, not unfinished code. ✅

**Type consistency:** `NotificationCategory` derived from the Drizzle `notification` enum and used across `prefs.ts`, `emit.ts`, and `actions/notifications.ts`; `Notification`/`SkillDoc`/`AuditEvent` row types exported from `src/db/types.ts` and used in components/pages; enum values match between `schema.ts`, the SQL migration, the seed fixtures, and the tests; helper names `is_agency_staff`/`has_org_access`/`is_founder` consistent between the migration and policy usage; `isStaff`/`isFounder`/`getSession` consistent between `auth.ts`, the layouts/pages, and the surface-isolation test. ✅

**Definition of done for Plan 05:** `pnpm lint && pnpm test` green — including the three new RLS isolation suites (notification/notification_pref, audit_event Founder-only, skill_doc staff-only), the notification critical-override unit test, the audit record test, and the cross-surface isolation gate — and the manual smoke tests in Tasks 8–11 behave correctly for founder, team, and client users.
