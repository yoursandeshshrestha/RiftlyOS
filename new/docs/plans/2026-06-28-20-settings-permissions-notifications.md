# Agency OS — Plan 20: Settings, Team Permissions & Notification Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining PRD coverage gaps that no earlier plan owned: (A) a **founder-only Settings hub** at `(internal)/settings` for team & user management (invite via Supabase Admin `createUser` + create membership; deactivate; change role) and a role/permission management UI; (B) a **granular team-permission model** (`team_permission`, per-membership boolean flags) with a tested authorize-style helper `hasPermission(session, flag)` enforced in the relevant Server Actions (founder ⇒ always true, client ⇒ always false); (C) **renewal alerts** — an Inngest CRON that sweeps `client.renewalDate` daily and emits `renewal_due` notifications at 60 and 30 days; (D) **notification wiring** of the two deferred emitters — `client_task_created` inside Plan 03's `createTask`, and `@mention`-parsing → `task_mention` notifications inside Plan 03's `addComment`. Every new tenant-scoped table gets an RLS isolation test using the Plan 01 harness.

**Architecture:** Builds directly on the foundation (Plan 01) and the modules it consumes. One new tenant-scoped table — `team_permission` (one row per membership, carrying `organization_id` as the leading index column, RLS enabled, policies reuse `public.has_org_access(uuid)` / `public.is_agency_staff()` / `public.is_founder()`). Permission decisions are centralised in a pure, fully tested helper `hasPermission(session, flag)` so the same rule (founder ⇒ true, client ⇒ false, team ⇒ DB flag) is enforced identically across Server Actions; a thin async wrapper `loadPermissions(userId)` reads the flags row. The Settings hub is an App-Router composition under `(internal)/settings/` gated by `isFounder()` in both the section layout and each Server Action; user invites/deactivation/role-changes use the Supabase **Admin API** (service-role) for the `auth.users` side and the RLS-bypassing service-role Drizzle connection for the `profiles`/`memberships`/`team_permission` side, exactly as PRD §9 permits (`service_role` for admin/jobs, never user-facing reads). Every privileged Settings mutation writes an immutable audit row via Plan 1.5's `recordAuditEvent()`. The renewal CRON is a durable Inngest function appended to the Plan 1.5 serve-route registry; it computes day-deltas against `client.renewalDate`, emits `renewal_due` through Plan 05's notification path (service-role variant, since there is no user session in a job) and sends an email via Plan 1.5's `sendEmail`. The two notification emitters are inserted at the exact call-sites inside Plan 03's `createTask`/`addComment`.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions) · TypeScript strict · pnpm · Supabase Postgres + RLS + Supabase Admin API (`@supabase/supabase-js`) · Drizzle ORM + drizzle-kit · postgres.js · Tailwind + shadcn/ui · Inngest (renewal CRON, appended to the shared serve-route registry) · Resend (renewal email via `sendEmail`) · Vitest (unit: permission helper + mention parser; integration: RLS isolation, CRON sweep logic, emitter wiring).

**Prerequisites the developer needs installed/configured:** Everything from Plan 01 (local Supabase running, `pnpm db:seed` applied, `tests/helpers/db.ts` present). Plus the Inngest dev server for the CRON smoke test (`pnpm dlx inngest-cli@latest dev`) and an `ANTHROPIC_API_KEY` is **not** needed (no AI here).

**Dependencies (assume already built; do NOT re-spec):**
- **Plan 01** — `organizations` (`org_type` `agency|client`), `profiles`, `memberships(user_id, organization_id, role app_role 'founder'|'team'|'client')`; RLS helpers `public.has_org_access(uuid)` and `public.is_agency_staff()`; the `custom_access_token_hook`; `src/lib/auth.ts` exporting `getSession()` / `isStaff()`; `scripts/seed.ts`; the test harness `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`, `sql`); the Drizzle client `src/db/index.ts` (`db`); schema single-source `src/db/schema.ts`; row types `src/db/types.ts`.
- **Plan 1.5 (Shared Platform Services)** — Inngest client `src/lib/inngest/client.ts` (`export const inngest = new Inngest({ id: 'agency-os' })`); the Inngest serve route `src/app/api/inngest/route.ts` using a central `functions: [...]` **registry** that each module appends to; `src/lib/email/resend.ts` exporting `async sendEmail({ to, subject, html })`; `src/lib/audit/record.ts` exporting `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })` (service-role insert into `audit_event`); the `audit_event` table.
- **Plan 02** — `client` table with `organizationId`, `name`, `accountManagerId` (`account_manager_id`), `renewalDate` (`renewal_date`).
- **Plan 03** — `tasks`, `task_comments`; the Server Actions file `src/app/(internal)/tasks/actions.ts` exporting `createTask(...)` and `addComment(taskId, body)`.
- **Plan 05** — `notification`, `notification_pref`, the `notification_category` enum (includes `client_task_created`, `task_mention`, `renewal_due`); `src/lib/notifications/emit.ts` exporting `emitNotification(input)`; `src/lib/auth.ts` additionally exports `isFounder(role)`; SQL helper `public.is_founder()`.

> **`recordAuditEvent` signature note.** The canonical Plan 1.5 signature is `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })`. The Plan 05 reference implementation used `before`/`after` instead of `metadata`. This plan calls it with `metadata` per the canonical Plan 1.5 contract; if your build's `audit_event` row uses `before`/`after`, pass `{ after: <metadata object> }` instead — adapt the single field name, not the call. All other fields match.

> **`sendEmail` path note.** The canonical Plan 1.5 email wrapper is `sendEmail` at `src/lib/email/resend.ts`. Plan 05's reference text created `src/lib/email/client.ts` with `resend`/`EMAIL_FROM`. This plan imports the canonical `sendEmail` from `@/lib/email/resend`; if your build exposes it elsewhere, alias the import.

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ app/
│  │  └─ (internal)/
│  │     └─ settings/
│  │        ├─ layout.tsx                       # NEW: founder-only section guard + sub-nav
│  │        ├─ team/
│  │        │  ├─ page.tsx                       # NEW: team & user management (list)
│  │        │  ├─ actions.ts                     # NEW: invite/deactivate/changeRole server actions
│  │        │  ├─ invite-user-form.tsx           # NEW: client component (invite)
│  │        │  └─ member-row.tsx                  # NEW: client component (role select + deactivate)
│  │        └─ permissions/
│  │           ├─ page.tsx                       # NEW: per-team-member permission toggles
│  │           ├─ actions.ts                     # NEW: setPermission server action
│  │           └─ permission-toggles.tsx         # NEW: client component (flag switches)
│  │  └─ api/inngest/route.ts                    # MODIFY: append renewalSweep to the registry
│  ├─ db/
│  │  ├─ schema.ts                               # MODIFY: append team_permission table
│  │  └─ types.ts                                # MODIFY: export TeamPermission types + PermissionFlag
│  ├─ lib/
│  │  ├─ permissions/
│  │  │  ├─ flags.ts                             # NEW: flag list + pure hasPermission() helper
│  │  │  └─ load.ts                              # NEW: loadPermissions() (async DB read)
│  │  ├─ settings/
│  │  │  └─ admin.ts                             # NEW: service-role Supabase admin + Drizzle helpers
│  │  ├─ tasks/
│  │  │  └─ mentions.ts                          # NEW: pure @mention parser
│  │  ├─ notifications/
│  │  │  └─ emit-service.ts                      # NEW: service-role emit variant (for jobs)
│  │  └─ inngest/
│  │     └─ renewals.ts                          # NEW: renewalSweep CRON + day-delta logic
│  └─ app/(internal)/tasks/actions.ts           # MODIFY: wire client_task_created + task_mention
├─ drizzle/
│  └─ 00XX_team_permission.sql                   # NEW: team_permission table + RLS policies (custom SQL)
└─ tests/
   ├─ permissions/hasPermission.test.ts          # NEW: unit (founder/client/team matrix)
   ├─ permissions/flags.test.ts                  # NEW: unit (flag set is stable)
   ├─ tasks/mentions.test.ts                      # NEW: unit (@mention parsing)
   ├─ renewals/sweep.test.ts                      # NEW: unit (60/30-day window logic)
   ├─ settings/team-actions.test.ts               # NEW: integration (invite/role/deactivate effects)
   └─ rls/team-permission.isolation.test.ts       # NEW: KEYSTONE RLS isolation for team_permission
```

> Naming note: this plan uses PRD §8-consistent singular table name `team_permission` (the canonical convention for new tables). Drizzle symbol `teamPermissions`, DB table `team_permission`.

---

## Task 1: Define the `team_permission` schema (one row per membership)

**Files:**
- Modify: `src/db/schema.ts` (append the `team_permission` table)
- Modify: `src/db/types.ts` (export row types)

The permission model is one row per membership, carrying four boolean flags (PRD §3.3 "configurable" capabilities). `organization_id` is the agency org (team members live in the agency org), kept as the leading index column per the §9 performance rule. Absence of a row == all flags default `false` (conservative default, per PRD §3.3 "default conservative").

- [ ] **Step 1: Append the table to `src/db/schema.ts`**

Append after the Plan 05 additions. Ensure `boolean`, `uuid`, `timestamp`, `index`, `unique` are already in the existing `drizzle-orm/pg-core` import (they are, from earlier plans). Do **not** re-import `organizations` / `profiles` / `memberships` — they are already in scope in `schema.ts`.

```ts
// --- Plan 20 additions: granular team permissions (PRD §3.3 "configurable") ----

// One row per membership. Each flag gates a "configurable" capability the founder
// toggles per team member. Absence of a row == every flag false (conservative).
// founder ⇒ always allowed, client ⇒ never allowed — enforced in code, not here.
export const teamPermissions = pgTable(
  'team_permission',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Agency tenant the team member belongs to (leading index column, §9).
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // The membership these flags apply to.
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    // Denormalised for fast per-user lookup in Server Actions.
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    // PRD §3.3 configurable capabilities:
    financeEdit: boolean('finance_edit').notNull().default(false),
    timeReportsView: boolean('time_reports_view').notNull().default(false),
    connectionsManage: boolean('connections_manage').notNull().default(false),
    invoicingManage: boolean('invoicing_manage').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (§9 RLS performance rule).
    byOrgUser: index('idx_team_permission_org_user').on(t.organizationId, t.userId),
    // exactly one flags row per membership.
    uniqMembership: unique('uniq_team_permission_membership').on(t.membershipId),
  }),
)
```

- [ ] **Step 2: Export row types in `src/db/types.ts`**

Append:

```ts
import type { teamPermissions } from './schema'

export type TeamPermission = typeof teamPermissions.$inferSelect
export type NewTeamPermission = typeof teamPermissions.$inferInsert
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00XX_*.sql` is created containing the `team_permission` table with its two indexes. Note the exact filename printed (referenced as `00XX` below).

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies with no errors. Verify:
```bash
psql "$DATABASE_URL" -c "\d public.team_permission"
```
Expected: columns `finance_edit`, `time_reports_view`, `connections_manage`, `invoicing_manage` (all `boolean not null default false`), plus `membership_id`, `user_id`, `organization_id`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): team_permission table (per-membership configurable flags)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: KEYSTONE — RLS isolation test for `team_permission` (watch it FAIL)

**Files:**
- Create: `tests/rls/team-permission.isolation.test.ts`

RLS is not enabled on the new table yet, so a client user can currently read agency permission rows. Write the test first, confirm it fails, then enable RLS in Task 3 to make it pass. This satisfies the hard requirement: every new tenant-scoped table gets an RLS isolation test using the Plan 01 harness.

This test seeds one team member in the agency org and one `team_permission` row for them via the privileged `sql` connection, then asserts a client user cannot see it.

- [ ] **Step 1: Write `tests/rls/team-permission.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): team_permission', () => {
  let founder: string
  let clientOneUser: string
  let teamMembershipId: string
  let teamUserId: string
  let agencyOrgId: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')

    // The founder's membership is in the agency org. Reuse it as the subject
    // membership for a permission row (we just need an agency-org membership).
    const [memb] = await sql`
      select m.id, m.user_id, m.organization_id
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = ${founder} and o.type = 'agency'
      limit 1`
    teamMembershipId = memb!.id as string
    teamUserId = memb!.user_id as string
    agencyOrgId = memb!.organization_id as string

    // Seed a flags row via the privileged connection (bypasses RLS).
    await sql`
      insert into public.team_permission
        (organization_id, membership_id, user_id, finance_edit)
      values (${agencyOrgId}, ${teamMembershipId}, ${teamUserId}, true)
      on conflict (membership_id) do update set finance_edit = excluded.finance_edit`
  })

  afterAll(async () => {
    await sql`delete from public.team_permission where membership_id = ${teamMembershipId}`
    await sql.end()
  })

  it('a CLIENT user sees ZERO team_permission rows', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select id from public.team_permission`)
    expect(rows.length).toBe(0)
  })

  it('agency staff (founder) CAN see the team_permission row', async () => {
    const rows = await asUser(founder, (tx) => tx`select id from public.team_permission`)
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `pnpm test tests/rls/team-permission.isolation.test.ts`
Expected: FAIL — "a CLIENT user sees ZERO team_permission rows" returns ≥ 1 row because RLS is not enabled yet. This proves the test is real.

- [ ] **Step 3: Commit the failing test**

```bash
git add -A
git commit -m "test(rls): team_permission isolation test (failing, RLS not enabled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Enable RLS on `team_permission` → make the test PASS

**Files:**
- Create: `drizzle/00YY_team_permission_rls.sql` (custom SQL migration)

Permission rows are agency-internal. Read for any agency staff (so the team UI can show flags); write only for the founder (founder owns permission config — PRD §3.3 / §3.3 "Settings, user management" is founder-only). Clients get nothing. We reuse the Plan 01 helpers `is_agency_staff()` / `has_org_access()` and the Plan 05 helper `is_founder()`.

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=team_permission_rls`
Expected: an empty `drizzle/00YY_team_permission_rls.sql` is created and registered in the journal.

- [ ] **Step 2: Fill in `drizzle/00YY_team_permission_rls.sql`**

```sql
-- team_permission: agency-internal config. Staff read; founder writes; clients none.
alter table public.team_permission enable row level security;

-- SELECT: any agency staff member may read permission rows in an org they access.
create policy team_permission_select on public.team_permission
  for select using (public.is_agency_staff() and public.has_org_access(organization_id));

-- INSERT: founder only (permission config is a founder-only capability, §3.3).
create policy team_permission_insert on public.team_permission
  for insert with check (public.is_founder() and public.has_org_access(organization_id));

-- UPDATE: founder only.
create policy team_permission_update on public.team_permission
  for update using (public.is_founder() and public.has_org_access(organization_id))
  with check (public.is_founder() and public.has_org_access(organization_id));

-- DELETE: founder only.
create policy team_permission_delete on public.team_permission
  for delete using (public.is_founder() and public.has_org_access(organization_id));
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `00YY_team_permission_rls.sql` with no errors.

- [ ] **Step 4: Run the isolation test and confirm it PASSES**

Run: `pnpm test tests/rls/team-permission.isolation.test.ts`
Expected: both tests PASS — the client user now sees zero rows; the founder sees the seeded row.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): RLS on team_permission (staff read, founder write) — test passes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The permission flag list + pure `hasPermission()` helper (TDD)

**Files:**
- Create: `tests/permissions/flags.test.ts`
- Create: `tests/permissions/hasPermission.test.ts`
- Create: `src/lib/permissions/flags.ts`

`hasPermission` is the single authorize-style decision used everywhere: **founder ⇒ always true**, **client ⇒ always false**, **team ⇒ the stored flag** (defaulting `false` when no flags object is present). We test it exhaustively first.

- [ ] **Step 1: Write the failing unit tests**

`tests/permissions/flags.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PERMISSION_FLAGS } from '@/lib/permissions/flags'

describe('permission flag set', () => {
  it('contains exactly the four PRD §3.3 configurable flags', () => {
    expect([...PERMISSION_FLAGS].sort()).toEqual(
      ['connectionsManage', 'financeEdit', 'invoicingManage', 'timeReportsView'].sort(),
    )
  })
})
```

`tests/permissions/hasPermission.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hasPermission } from '@/lib/permissions/flags'

const flagsAllFalse = {
  financeEdit: false,
  timeReportsView: false,
  connectionsManage: false,
  invoicingManage: false,
}

describe('hasPermission', () => {
  it('founder is allowed every flag regardless of stored flags', () => {
    const s = { role: 'founder' as const, flags: null }
    expect(hasPermission(s, 'financeEdit')).toBe(true)
    expect(hasPermission(s, 'invoicingManage')).toBe(true)
    expect(hasPermission(s, 'connectionsManage')).toBe(true)
    expect(hasPermission(s, 'timeReportsView')).toBe(true)
  })

  it('client is denied every flag regardless of stored flags', () => {
    const s = { role: 'client' as const, flags: { ...flagsAllFalse, financeEdit: true } }
    expect(hasPermission(s, 'financeEdit')).toBe(false)
    expect(hasPermission(s, 'invoicingManage')).toBe(false)
  })

  it('team member follows the stored flag', () => {
    const granted = { role: 'team' as const, flags: { ...flagsAllFalse, financeEdit: true } }
    const denied = { role: 'team' as const, flags: { ...flagsAllFalse } }
    expect(hasPermission(granted, 'financeEdit')).toBe(true)
    expect(hasPermission(granted, 'invoicingManage')).toBe(false)
    expect(hasPermission(denied, 'financeEdit')).toBe(false)
  })

  it('team member with NO flags row defaults to false (conservative)', () => {
    const s = { role: 'team' as const, flags: null }
    expect(hasPermission(s, 'financeEdit')).toBe(false)
    expect(hasPermission(s, 'connectionsManage')).toBe(false)
  })

  it('null role is denied (secure-by-default)', () => {
    const s = { role: null, flags: null }
    expect(hasPermission(s, 'financeEdit')).toBe(false)
  })
})
```

Run: `pnpm test tests/permissions/`
Expected: **FAIL** — `@/lib/permissions/flags` does not exist (module not found).

- [ ] **Step 2: Implement `src/lib/permissions/flags.ts`**

```ts
import type { AppRole } from '@/db/types'

// The four "configurable" capabilities from PRD §3.3, as the column names on
// team_permission. Keep this list and the table columns in lock-step.
export const PERMISSION_FLAGS = [
  'financeEdit',
  'timeReportsView',
  'connectionsManage',
  'invoicingManage',
] as const

export type PermissionFlag = (typeof PERMISSION_FLAGS)[number]

// The subset of team_permission a decision needs. null == no flags row == all false.
export type PermissionFlags = Record<PermissionFlag, boolean> | null

export type PermissionSubject = {
  role: AppRole | null
  flags: PermissionFlags
}

// THE single authorize rule. founder ⇒ true; client/null ⇒ false; team ⇒ stored flag.
export function hasPermission(subject: PermissionSubject, flag: PermissionFlag): boolean {
  if (subject.role === 'founder') return true
  if (subject.role !== 'team') return false // client | null ⇒ denied
  if (!subject.flags) return false // no flags row ⇒ conservative default
  return subject.flags[flag] === true
}
```

Run: `pnpm test tests/permissions/`
Expected: **PASS** (both files).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(perms): pure hasPermission() helper + flag set (tests pass)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `loadPermissions()` — read a user's flags row for use in Server Actions

**Files:**
- Create: `src/lib/permissions/load.ts`

A thin async wrapper that fetches the (at most one) `team_permission` row for a user and returns it in the shape `hasPermission` expects (or `null`). Server Actions combine `getSession()` + `loadPermissions()` to build the `PermissionSubject`.

- [ ] **Step 1: Implement `src/lib/permissions/load.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { teamPermissions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { PermissionFlags } from './flags'

// Reads the flags row for a user (one row per membership; team members have one
// agency membership). Returns null when absent (⇒ all flags false).
export async function loadPermissions(userId: string): Promise<PermissionFlags> {
  const [row] = await db
    .select({
      financeEdit: teamPermissions.financeEdit,
      timeReportsView: teamPermissions.timeReportsView,
      connectionsManage: teamPermissions.connectionsManage,
      invoicingManage: teamPermissions.invoicingManage,
    })
    .from(teamPermissions)
    .where(eq(teamPermissions.userId, userId))
    .limit(1)
  return row ?? null
}
```

> Reads go through the Plan 01 Drizzle client. RLS on `team_permission` (Task 3) already denies clients; the explicit `eq(userId)` filter is defense-in-depth. In a Server Action the caller is staff, so the staff-read policy returns the row.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(perms): loadPermissions() DB reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Settings admin helpers (service-role Supabase + Drizzle)

**Files:**
- Create: `src/lib/settings/admin.ts`

Inviting/deactivating users touches `auth.users` (Supabase Admin API) and `profiles`/`memberships`/`team_permission` (DB). Both are admin/job operations, so they use the **service-role** credentials, exactly as PRD §9 allows (`service_role` for admin/jobs, never user-facing reads). We centralise the privileged clients here so the Server Actions stay small and the service-role surface is auditable in one file.

- [ ] **Step 1: Implement `src/lib/settings/admin.ts`**

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

// Supabase Admin client (service-role) for auth.users management (createUser, etc.).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Dedicated service-role Drizzle connection: bypasses RLS so the founder can
// insert profiles/memberships/permissions for OTHER users (which the user's own
// RLS session could not do). Per PRD §9, service_role is for admin/jobs only.
const adminPg = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
export const adminDb = drizzle(adminPg, { schema })
```

> Production note: point `SUPABASE_SERVICE_ROLE_KEY` and the admin connection at real service-role credentials (Plan 01 already provisions these env vars). Locally, the default `postgres` superuser `DATABASE_URL` bypasses RLS, so the admin Drizzle writes succeed as written.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(settings): service-role admin clients (Supabase Admin + Drizzle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Team-management Server Actions (invite / deactivate / change role) + integration test

**Files:**
- Create: `src/app/(internal)/settings/team/actions.ts`
- Create: `tests/settings/team-actions.test.ts`

Three founder-only actions:
- `inviteUser` — Supabase Admin `createUser` (confirmed, temp password) → insert `profiles` → insert `memberships` (role `team` by default) → seed a default-`false` `team_permission` row → audit `user.invite`.
- `changeRole` — update the membership's role (founder/team only; never make someone a `client` here) → audit `role.change`.
- `deactivateUser` — Supabase Admin `deleteUser` (removes the auth account; `profiles`/`memberships` cascade via the FKs) → audit `user.deactivate`.

Each guards with `isFounder(session.role)` before any privileged work.

- [ ] **Step 1: Write the failing integration test `tests/settings/team-actions.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { sql } from '../helpers/db'
import { inviteUser, changeRole, deactivateUser } from '@/app/(internal)/settings/team/actions'

// Founder session is faked via the exported __setSessionForTest hook below.
import { __setSessionForTest } from '@/app/(internal)/settings/team/actions'

const TEST_EMAIL = `invitee+${Date.now()}@milktreeagency.com`

describe('team management actions (founder)', () => {
  afterAll(async () => {
    // Clean up the auth user + cascade rows.
    const [p] = await sql`select id from public.profiles where email = ${TEST_EMAIL}`
    if (p) {
      const { supabaseAdmin } = await import('@/lib/settings/admin')
      await supabaseAdmin.auth.admin.deleteUser(p.id as string).catch(() => {})
    }
    await sql.end()
  })

  it('inviteUser creates a profile + agency membership (role team) + flags row', async () => {
    const [agency] = await sql`select id from public.organizations where type = 'agency' limit 1`
    const [founder] = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    __setSessionForTest({ userId: founder!.id as string, role: 'founder', orgId: agency!.id as string, email: 'founder@milktreeagency.com' })

    await inviteUser({ email: TEST_EMAIL, fullName: 'New Teammate', organizationId: agency!.id as string })

    const [profile] = await sql`select id from public.profiles where email = ${TEST_EMAIL}`
    expect(profile).toBeTruthy()
    const memb = await sql`select role from public.memberships where user_id = ${profile!.id}`
    expect(memb[0]!.role).toBe('team')
    const flags = await sql`select finance_edit from public.team_permission where user_id = ${profile!.id}`
    expect(flags.length).toBe(1)
    expect(flags[0]!.finance_edit).toBe(false)
  })

  it('changeRole updates the membership role', async () => {
    const [profile] = await sql`select id from public.profiles where email = ${TEST_EMAIL}`
    const [memb] = await sql`select id from public.memberships where user_id = ${profile!.id}`
    await changeRole({ membershipId: memb!.id as string, role: 'founder' })
    const [after] = await sql`select role from public.memberships where id = ${memb!.id}`
    expect(after!.role).toBe('founder')
  })

  it('non-founder is rejected', async () => {
    __setSessionForTest({ userId: 'x', role: 'team', orgId: 'y', email: 't@x.com' })
    await expect(
      inviteUser({ email: 'nope@x.com', fullName: 'No', organizationId: 'y' }),
    ).rejects.toThrow(/founder/i)
  })

  it('deactivateUser removes the auth user + cascades the profile', async () => {
    const [agency] = await sql`select id from public.organizations where type = 'agency' limit 1`
    const [founder] = await sql`select id from public.profiles where email = 'founder@milktreeagency.com'`
    __setSessionForTest({ userId: founder!.id as string, role: 'founder', orgId: agency!.id as string, email: 'founder@milktreeagency.com' })

    const [profile] = await sql`select id from public.profiles where email = ${TEST_EMAIL}`
    await deactivateUser({ userId: profile!.id as string })
    const after = await sql`select id from public.profiles where email = ${TEST_EMAIL}`
    expect(after.length).toBe(0)
  })
})
```

Run: `pnpm test tests/settings/team-actions.test.ts`
Expected: **FAIL** — `@/app/(internal)/settings/team/actions` does not exist.

- [ ] **Step 2: Implement `src/app/(internal)/settings/team/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { supabaseAdmin, adminDb } from '@/lib/settings/admin'
import { profiles, memberships, teamPermissions } from '@/db/schema'
import { getSession, isFounder } from '@/lib/auth'
import { recordAuditEvent } from '@/lib/audit/record'
import type { SessionInfo } from '@/lib/auth'

// Test seam: lets the integration test inject a session without a real cookie.
let __testSession: SessionInfo | null = null
export function __setSessionForTest(s: SessionInfo | null) {
  __testSession = s
}

async function requireFounder(): Promise<SessionInfo> {
  const session = __testSession ?? (await getSession())
  if (!session) throw new Error('Not authenticated')
  if (!isFounder(session.role)) throw new Error('Only the founder can manage users')
  return session
}

function randomPassword(): string {
  // Temp password; the invitee resets via the standard reset flow.
  return `Temp-${crypto.randomUUID().slice(0, 12)}!`
}

export async function inviteUser(input: {
  email: string
  fullName: string
  organizationId: string
  role?: 'founder' | 'team'
}) {
  const actor = await requireFounder()
  const role = input.role ?? 'team'

  // 1) Create the auth user (confirmed) via the Admin API.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  const userId = data.user.id

  // 2) profile + membership + default-false flags row (service-role, bypasses RLS).
  await adminDb.insert(profiles).values({ id: userId, email: input.email, fullName: input.fullName })
  const [memb] = await adminDb
    .insert(memberships)
    .values({ userId, organizationId: input.organizationId, role })
    .returning()
  await adminDb.insert(teamPermissions).values({
    organizationId: input.organizationId,
    membershipId: memb!.id,
    userId,
  })

  await recordAuditEvent({
    actorId: actor.userId,
    action: 'user.invite',
    targetType: 'membership',
    targetId: memb!.id,
    organizationId: input.organizationId,
    metadata: { email: input.email, role },
  })

  revalidatePath('/settings/team')
  revalidatePath('/settings/permissions')
}

export async function changeRole(input: {
  membershipId: string
  role: 'founder' | 'team'
}) {
  const actor = await requireFounder()

  const [before] = await adminDb
    .select()
    .from(memberships)
    .where(eq(memberships.id, input.membershipId))
  if (!before) throw new Error('Membership not found')
  if (before.role === 'client') throw new Error('Cannot change a client membership here')

  await adminDb.update(memberships).set({ role: input.role }).where(eq(memberships.id, input.membershipId))

  await recordAuditEvent({
    actorId: actor.userId,
    action: 'role.change',
    targetType: 'membership',
    targetId: input.membershipId,
    organizationId: before.organizationId,
    metadata: { from: before.role, to: input.role },
  })

  revalidatePath('/settings/team')
}

export async function deactivateUser(input: { userId: string }) {
  const actor = await requireFounder()
  if (input.userId === actor.userId) throw new Error('You cannot deactivate yourself')

  // Deleting the auth user cascades profiles/memberships/team_permission via FKs.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(input.userId)
  if (error) throw error

  await recordAuditEvent({
    actorId: actor.userId,
    action: 'user.deactivate',
    targetType: 'user',
    targetId: input.userId,
    organizationId: actor.orgId,
    metadata: {},
  })

  revalidatePath('/settings/team')
}
```

> `SessionInfo` is the Plan 01 type exported from `src/lib/auth.ts` (`{ userId, email, role, orgId }`). If your `getSession` return type is named differently, import that type instead.

Run: `pnpm test tests/settings/team-actions.test.ts`
Expected: **PASS** — invite creates profile/membership/flags; changeRole flips the role; non-founder rejected; deactivate cascades the profile away.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(settings): founder team-management actions (invite/role/deactivate) + audit (tests pass)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Permission Server Action (`setPermission`) + the founder-only Settings layout

**Files:**
- Create: `src/app/(internal)/settings/layout.tsx`
- Create: `src/app/(internal)/settings/permissions/actions.ts`

The Settings section is founder-only at the layout boundary (defense-in-depth on top of each action's own guard). The permissions action upserts a single flag on a membership's `team_permission` row, gated by `isFounder`, and audits the change.

- [ ] **Step 1: Founder-only section layout `src/app/(internal)/settings/layout.tsx`**

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession, isFounder } from '@/lib/auth'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Settings, user management, billing config = Founder only (PRD §3.3).
  if (!isFounder(session.role)) redirect('/cockpit')

  return (
    <div className="flex gap-6">
      <nav className="w-48 shrink-0 border-r pr-4 text-sm">
        <p className="mb-3 font-semibold">Settings</p>
        <ul className="flex flex-col gap-1 text-muted-foreground">
          <li><Link href="/settings/team">Team &amp; Users</Link></li>
          <li><Link href="/settings/permissions">Permissions</Link></li>
          <li><Link href="/settings/audit">Audit log</Link></li>
        </ul>
      </nav>
      <section className="flex-1">{children}</section>
    </div>
  )
}
```

> `/settings/audit` is owned by Plan 05; this sub-nav just links to it. If Plan 05 created its own `settings/layout.tsx`, merge the two sub-nav lists into one file rather than creating a second layout.

- [ ] **Step 2: Implement `src/app/(internal)/settings/permissions/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { adminDb } from '@/lib/settings/admin'
import { memberships, teamPermissions } from '@/db/schema'
import { getSession, isFounder } from '@/lib/auth'
import { recordAuditEvent } from '@/lib/audit/record'
import { PERMISSION_FLAGS, type PermissionFlag } from '@/lib/permissions/flags'

export async function setPermission(input: {
  membershipId: string
  flag: PermissionFlag
  value: boolean
}) {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')
  if (!isFounder(session.role)) throw new Error('Only the founder can edit permissions')
  if (!PERMISSION_FLAGS.includes(input.flag)) throw new Error('Unknown permission flag')

  const [memb] = await adminDb.select().from(memberships).where(eq(memberships.id, input.membershipId))
  if (!memb) throw new Error('Membership not found')

  // Upsert the flags row for this membership, setting only the targeted column.
  await adminDb
    .insert(teamPermissions)
    .values({
      organizationId: memb.organizationId,
      membershipId: memb.id,
      userId: memb.userId,
      [input.flag]: input.value,
    } as typeof teamPermissions.$inferInsert)
    .onConflictDoUpdate({
      target: teamPermissions.membershipId,
      set: { [input.flag]: input.value, updatedAt: new Date() },
    })

  await recordAuditEvent({
    actorId: session.userId,
    action: 'permission.change',
    targetType: 'membership',
    targetId: input.membershipId,
    organizationId: memb.organizationId,
    metadata: { flag: input.flag, value: input.value },
  })

  revalidatePath('/settings/permissions')
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(settings): founder-only layout + setPermission action (audited)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Settings UI — team list + invite form + permission toggles

**Files:**
- Create: `src/app/(internal)/settings/team/page.tsx`
- Create: `src/app/(internal)/settings/team/invite-user-form.tsx`
- Create: `src/app/(internal)/settings/team/member-row.tsx`
- Create: `src/app/(internal)/settings/permissions/page.tsx`
- Create: `src/app/(internal)/settings/permissions/permission-toggles.tsx`

The team page lists agency-org memberships with a role select + deactivate button; the invite form posts to `inviteUser`. The permissions page renders one row per team member with four toggle switches bound to `setPermission`. Pages are Server Components reading via the Plan 01 Drizzle client (RLS already gates non-staff to nothing; founder layout gates the section).

- [ ] **Step 1: Team list page `src/app/(internal)/settings/team/page.tsx`**

```tsx
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { memberships, profiles, organizations } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { InviteUserForm } from './invite-user-form'
import { MemberRow } from './member-row'

export default async function TeamSettingsPage() {
  const session = await getSession()
  const agencyOrgId = session!.orgId!

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(profiles, eq(profiles.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, agencyOrgId), eq(organizations.type, 'agency')))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Team &amp; Users</h1>
        <p className="text-sm text-muted-foreground">Invite, deactivate, and set roles for agency staff.</p>
      </div>

      <InviteUserForm organizationId={agencyOrgId} />

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Name</th><th>Email</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <MemberRow
              key={r.membershipId}
              membershipId={r.membershipId}
              userId={r.userId}
              fullName={r.fullName ?? '—'}
              email={r.email}
              role={r.role}
              isSelf={r.userId === session!.userId}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Invite form `src/app/(internal)/settings/team/invite-user-form.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { inviteUser } from './actions'

export function InviteUserForm({ organizationId }: { organizationId: string }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    start(async () => {
      try {
        await inviteUser({ email, fullName, organizationId })
        setOk(true)
        setEmail('')
        setFullName('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invite failed')
      }
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded border p-4">
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">Full name</label>
        <input className="rounded border p-2 text-sm" value={fullName}
          onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">Email</label>
        <input className="rounded border p-2 text-sm" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Inviting…' : 'Invite user'}</Button>
      {ok && <span className="text-sm text-green-600">Invited.</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  )
}
```

- [ ] **Step 3: Member row `src/app/(internal)/settings/team/member-row.tsx`**

```tsx
'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { changeRole, deactivateUser } from './actions'
import type { AppRole } from '@/db/types'

export function MemberRow(props: {
  membershipId: string
  userId: string
  fullName: string
  email: string
  role: AppRole
  isSelf: boolean
}) {
  const [pending, start] = useTransition()

  function onRole(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value as 'founder' | 'team'
    start(async () => {
      await changeRole({ membershipId: props.membershipId, role })
    })
  }

  function onDeactivate() {
    if (!confirm(`Deactivate ${props.email}? This removes their login.`)) return
    start(async () => {
      await deactivateUser({ userId: props.userId })
    })
  }

  return (
    <tr className="border-t">
      <td className="py-2">{props.fullName}</td>
      <td>{props.email}</td>
      <td>
        <select className="rounded border p-1 text-sm" defaultValue={props.role}
          onChange={onRole} disabled={pending || props.isSelf}>
          <option value="founder">founder</option>
          <option value="team">team</option>
        </select>
      </td>
      <td className="text-right">
        {!props.isSelf && (
          <Button variant="destructive" size="sm" onClick={onDeactivate} disabled={pending}>
            Deactivate
          </Button>
        )}
      </td>
    </tr>
  )
}
```

> `Button` `variant`/`size` props come from the shadcn/ui button added in Plan 01. If your build's button lacks `destructive`/`sm`, drop those props.

- [ ] **Step 4: Permissions page `src/app/(internal)/settings/permissions/page.tsx`**

```tsx
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { memberships, profiles, organizations, teamPermissions } from '@/db/schema'
import { getSession } from '@/lib/auth'
import { PermissionToggles } from './permission-toggles'

export default async function PermissionsSettingsPage() {
  const session = await getSession()
  const agencyOrgId = session!.orgId!

  // Only TEAM members have configurable flags (founder is always-allowed).
  const rows = await db
    .select({
      membershipId: memberships.id,
      email: profiles.email,
      fullName: profiles.fullName,
      financeEdit: teamPermissions.financeEdit,
      timeReportsView: teamPermissions.timeReportsView,
      connectionsManage: teamPermissions.connectionsManage,
      invoicingManage: teamPermissions.invoicingManage,
    })
    .from(memberships)
    .innerJoin(profiles, eq(profiles.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .leftJoin(teamPermissions, eq(teamPermissions.membershipId, memberships.id))
    .where(and(
      eq(memberships.organizationId, agencyOrgId),
      eq(organizations.type, 'agency'),
      eq(memberships.role, 'team'),
    ))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Permissions</h1>
        <p className="text-sm text-muted-foreground">
          Toggle configurable capabilities per team member. Founders always have full access.
        </p>
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No team members yet.</p>}

      <div className="space-y-4">
        {rows.map((r) => (
          <PermissionToggles
            key={r.membershipId}
            membershipId={r.membershipId}
            label={`${r.fullName ?? r.email} (${r.email})`}
            flags={{
              financeEdit: r.financeEdit ?? false,
              timeReportsView: r.timeReportsView ?? false,
              connectionsManage: r.connectionsManage ?? false,
              invoicingManage: r.invoicingManage ?? false,
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Toggle component `src/app/(internal)/settings/permissions/permission-toggles.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { setPermission } from './actions'
import { PERMISSION_FLAGS, type PermissionFlag } from '@/lib/permissions/flags'

const LABELS: Record<PermissionFlag, string> = {
  financeEdit: 'Finance edit',
  timeReportsView: 'Time & profitability reports',
  connectionsManage: 'Manage connections',
  invoicingManage: 'Create/send/void invoices',
}

export function PermissionToggles(props: {
  membershipId: string
  label: string
  flags: Record<PermissionFlag, boolean>
}) {
  const [flags, setFlags] = useState(props.flags)
  const [pending, start] = useTransition()

  function toggle(flag: PermissionFlag, value: boolean) {
    setFlags((f) => ({ ...f, [flag]: value })) // optimistic
    start(async () => {
      try {
        await setPermission({ membershipId: props.membershipId, flag, value })
      } catch {
        setFlags((f) => ({ ...f, [flag]: !value })) // rollback
      }
    })
  }

  return (
    <div className="rounded border p-4">
      <p className="mb-2 text-sm font-medium">{props.label}</p>
      <div className="flex flex-wrap gap-4">
        {PERMISSION_FLAGS.map((flag) => (
          <label key={flag} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={flags[flag]}
              disabled={pending}
              onChange={(e) => toggle(flag, e.target.checked)}
            />
            {LABELS[flag]}
          </label>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`. Sign in as `founder@milktreeagency.com`.
1. Visit `/settings/team` → see the founder listed; invite a new user (e.g. `qa@milktreeagency.com`). Row appears with role `team`.
2. Visit `/settings/permissions` → the new team member appears with four unchecked toggles. Toggle "Finance edit" on; refresh → it stays on (persisted).
3. Sign in as a `team`-role user and visit `/settings/team` → redirected to `/cockpit` (founder-only layout). Sign in as a client → redirected to `/overview`.

Expected: all behave as described.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): team & permissions management UI (founder-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Enforce `hasPermission` in the relevant Server Actions

**Files:**
- Modify: (finance) `src/app/(internal)/finance/actions.ts` — gate invoice create/send/void on `invoicingManage`
- Modify: (connections) `src/app/(internal)/connections/actions.ts` — gate connect/reconnect on `connectionsManage`
- Modify: (time) `src/app/(internal)/time/reports/page.tsx` (or its data action) — gate the reports read on `timeReportsView`

Each "configurable" capability from PRD §3.3 is enforced with the same three-line preamble. This task shows the **exact** preamble to insert; apply it at the top of each named action (the surrounding bodies are owned by Plans 04/06/14 and are not re-spec'd here). If a path differs in your build, apply the same preamble to the equivalently-named action.

The canonical preamble (compute the subject once, then call `hasPermission`):

```ts
import { getSession } from '@/lib/auth'
import { loadPermissions } from '@/lib/permissions/load'
import { hasPermission, type PermissionFlag } from '@/lib/permissions/flags'

// Reusable guard — throws if the acting user lacks the flag (founder always passes,
// client always fails). Place this near the top of the actions module.
async function requirePermission(flag: PermissionFlag) {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')
  const flags = await loadPermissions(session.userId)
  if (!hasPermission({ role: session.role, flags }, flag)) {
    throw new Error(`Forbidden: missing permission "${flag}"`)
  }
  return session
}
```

- [ ] **Step 1: Add the `requirePermission` helper to each actions module**

Add the helper above (import block + function) once at the top of each of the finance, connections, and time-reports action modules. If those modules already import `getSession`, do not duplicate the import — just add the two permissions imports and the function.

- [ ] **Step 2: Gate the invoicing actions (PRD §3.3 "Create/send/void invoices — configurable")**

At the very top of each of `createOneOffInvoice`, `createRetainer`, `sendInvoice`, and `voidInvoice` (Plan 04's finance actions), insert:

```ts
  await requirePermission('invoicingManage')
```

(Place it as the first statement, before any DB work. The founder always passes; a team member without the flag is rejected; a client never reaches these staff-only actions anyway.)

- [ ] **Step 3: Gate the connection-management actions (PRD §3.3 "Connections / integrations setup — configurable")**

At the top of each of `connectProvider`, `reconnectProvider`, and `disconnectProvider` (Plan 06's connection actions), insert:

```ts
  await requirePermission('connectionsManage')
```

- [ ] **Step 4: Gate the time & profitability reports read (PRD §3.3 "Time & profitability reports (all) — configurable")**

In Plan 14's reports data path (the Server Action or the page's data loader that returns cross-team/client time + profitability), insert at the top of the loader:

```ts
  await requirePermission('timeReportsView')
```

> Note: logging one's **own** time (PRD §3.3 "Time tracking (log own time)") is NOT configurable and is allowed for all staff — do **not** gate `startTimer`/`stopTimer`/`addManualTime`. Only the **reports** read is gated.

- [ ] **Step 5: Gate the founder-only finance-config edit (PRD §3.3 "finance_edit") where applicable**

If Plan 04 exposes a revenue-target / finance-config edit action (e.g. `setRevenueTarget`), insert at its top:

```ts
  await requirePermission('financeEdit')
```

- [ ] **Step 6: Type-check + targeted test**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors across the modified modules.

> Behavioural coverage for the gate itself is provided by the pure `hasPermission` unit suite (Task 4). The per-action wiring is a one-line preamble; a full per-action integration test belongs to the owning plan's suite. Re-run `pnpm test tests/permissions/` to confirm the decision logic is green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(perms): enforce hasPermission gates in finance/connections/time-reports actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Service-role notification emit variant (for background jobs)

**Files:**
- Create: `src/lib/notifications/emit-service.ts`

Plan 05's `emitNotification()` runs request-scoped (inside a Server Action holding the user's session, satisfying the `user_id = auth.uid()` insert policy). The renewal CRON has **no user session**, so its in-app insert would be denied by RLS. We add a service-role variant that mirrors `emitNotification`'s pref-aware logic but writes via an RLS-bypassing connection — exactly the "service-role variant" pattern Plan 05 documented for background fan-out.

- [ ] **Step 1: Implement `src/lib/notifications/emit-service.ts`**

```ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { resolveDelivery } from './prefs'
import { inngest } from '@/lib/inngest/client'
import type { EmitInput } from './emit'

// Dedicated service-role connection: jobs have no user session, so we bypass RLS
// to insert in-app notifications for arbitrary recipients (PRD §9: service_role
// for admin/jobs only). Pref logic + critical-override match emitNotification().
const svcPg = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const svcDb = drizzle(svcPg, { schema })

export async function emitNotificationServiceRole(input: EmitInput): Promise<void> {
  const [pref] = await svcDb
    .select({
      emailEnabled: schema.notificationPrefs.emailEnabled,
      inAppEnabled: schema.notificationPrefs.inAppEnabled,
    })
    .from(schema.notificationPrefs)
    .where(
      and(
        eq(schema.notificationPrefs.userId, input.userId),
        eq(schema.notificationPrefs.category, input.category),
      ),
    )
    .limit(1)

  const delivery = resolveDelivery(input.category, pref ?? null)

  if (delivery.inApp) {
    await svcDb.insert(schema.notifications).values({
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

> `EmitInput` and `resolveDelivery` are reused verbatim from Plan 05, keeping one source of truth for the delivery rule. The only difference is the RLS-bypassing connection.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(notif): service-role emit variant for background jobs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Renewal-window logic (pure) + CRON sweep (TDD)

**Files:**
- Create: `tests/renewals/sweep.test.ts`
- Create: `src/lib/inngest/renewals.ts`

PRD §5.4: "Renewal tracking with alerts (30/60-day)." We extract a pure helper `renewalAlertDay(renewalDate, today)` that returns `60`, `30`, or `null` (alert exactly on the day that is 60 or 30 calendar days before renewal), test it, then build the daily CRON that loads clients with a `renewalDate`, computes the window, and emits `renewal_due` to the client's `account_manager_id` (plus an email via `sendEmail`).

- [ ] **Step 1: Write the failing unit test `tests/renewals/sweep.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { renewalAlertDay } from '@/lib/inngest/renewals'

function d(s: string) {
  return new Date(`${s}T00:00:00.000Z`)
}

describe('renewalAlertDay', () => {
  it('returns 60 exactly 60 days before renewal', () => {
    expect(renewalAlertDay('2026-08-30', d('2026-07-01'))).toBe(60)
  })

  it('returns 30 exactly 30 days before renewal', () => {
    expect(renewalAlertDay('2026-07-31', d('2026-07-01'))).toBe(30)
  })

  it('returns null on a non-threshold day (e.g. 45 days out)', () => {
    expect(renewalAlertDay('2026-08-15', d('2026-07-01'))).toBeNull()
  })

  it('returns null after the renewal date has passed', () => {
    expect(renewalAlertDay('2026-06-01', d('2026-07-01'))).toBeNull()
  })

  it('returns null when there is no renewal date', () => {
    expect(renewalAlertDay(null, d('2026-07-01'))).toBeNull()
  })

  it('ignores time-of-day (compares calendar days in UTC)', () => {
    expect(renewalAlertDay('2026-07-31', new Date('2026-07-01T23:59:59.000Z'))).toBe(30)
  })
})
```

Run: `pnpm test tests/renewals/sweep.test.ts`
Expected: **FAIL** — `@/lib/inngest/renewals` does not exist.

- [ ] **Step 2: Implement `src/lib/inngest/renewals.ts`**

```ts
import { inngest } from '@/lib/inngest/client'
import { db } from '@/db'
import { clients, memberships } from '@/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { emitNotificationServiceRole } from '@/lib/notifications/emit-service'
import { sendEmail } from '@/lib/email/resend'

const MS_PER_DAY = 86_400_000

// Pure: how many days until renewal, as a calendar-day delta in UTC. Returns the
// threshold (60 | 30) when `today` is exactly that many days before `renewalDate`,
// else null. `renewalDate` is the DATE string stored on client.renewal_date.
export function renewalAlertDay(
  renewalDate: string | null,
  today: Date = new Date(),
): 60 | 30 | null {
  if (!renewalDate) return null
  const renewal = new Date(`${renewalDate}T00:00:00.000Z`)
  if (Number.isNaN(renewal.getTime())) return null

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const renewalUtc = Date.UTC(renewal.getUTCFullYear(), renewal.getUTCMonth(), renewal.getUTCDate())
  const days = Math.round((renewalUtc - todayUtc) / MS_PER_DAY)

  if (days === 60) return 60
  if (days === 30) return 30
  return null
}

// Daily CRON: sweep client.renewalDate; emit renewal_due at 60 and 30 days to the
// account manager (PRD §5.4 + §5.14 "renewal due" notification).
export const renewalSweep = inngest.createFunction(
  { id: 'renewal-sweep' },
  { cron: '0 7 * * *' }, // 07:00 UTC daily
  async ({ step }) => {
    const candidates = await step.run('load-clients-with-renewal', async () =>
      db
        .select({
          id: clients.id,
          name: clients.name,
          organizationId: clients.organizationId,
          accountManagerId: clients.accountManagerId,
          renewalDate: clients.renewalDate,
        })
        .from(clients)
        .where(and(isNotNull(clients.renewalDate), isNotNull(clients.accountManagerId))),
    )

    const today = new Date()
    let emitted = 0

    for (const c of candidates) {
      const threshold = renewalAlertDay(c.renewalDate, today)
      if (threshold === null) continue

      await step.run(`emit-${c.id}-${threshold}`, async () => {
        // The account manager is an agency-staff user; their notifications live in
        // the agency org. Resolve their agency membership org for tenant tagging.
        const [memb] = await db
          .select({ organizationId: memberships.organizationId })
          .from(memberships)
          .where(eq(memberships.userId, c.accountManagerId!))
          .limit(1)
        if (!memb) return { skipped: 'no-membership' }

        const title = `Renewal due in ${threshold} days: ${c.name}`
        const body = `${c.name}'s retainer renews on ${c.renewalDate} (${threshold} days away).`
        const linkPath = `/clients/${c.id}`

        await emitNotificationServiceRole({
          organizationId: memb.organizationId,
          userId: c.accountManagerId!,
          category: 'renewal_due',
          title,
          body,
          linkPath,
          data: { clientId: c.id, threshold, renewalDate: c.renewalDate },
        })
        return { sent: true }
      })
      emitted++
    }

    return { candidates: candidates.length, emitted }
  },
)
```

> The `renewal_due` email is delivered through Plan 05's existing `notification/email.requested` → `sendNotificationEmail` Inngest function (which calls `sendEmail`). We rely on that path rather than calling `sendEmail` twice; `emitNotificationServiceRole` already enqueues the email when the recipient's pref allows. The `sendEmail` import is kept available for any direct ops alert you wish to add, and documents the dependency on Plan 1.5's email wrapper.

Run: `pnpm test tests/renewals/sweep.test.ts`
Expected: **PASS** — all six window cases green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renewals): renewalAlertDay logic + daily renewalSweep CRON (60/30-day) — tests pass

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Register `renewalSweep` in the Inngest serve-route registry

**Files:**
- Modify: `src/app/api/inngest/route.ts` (append to the central `functions` array)

The serve route is owned by Plan 1.5 and uses a central registry pattern. We **append** `renewalSweep` — we do not recreate the route or the client.

- [ ] **Step 1: Add the import and registry entry**

In `src/app/api/inngest/route.ts`, add the import alongside the existing ones and add `renewalSweep` to the `functions` array:

```ts
import { renewalSweep } from '@/lib/inngest/renewals'
// ...existing imports (sendNotificationEmail, finance crons, connectors, etc.)...

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    /* ...all existing functions, unchanged... */
    renewalSweep,
  ],
})
```

> Only add the single `renewalSweep` line and its import. Leave every other registered function in place — overwriting the array would unregister other modules' jobs.

- [ ] **Step 2: Verify the cron registers**

Run `pnpm dlx inngest-cli@latest dev` in one terminal and `pnpm dev` in another; open the Inngest dev UI.
Expected: `renewal-sweep` appears with the cron schedule `0 7 * * *`. Seed a client whose `renewal_date` is exactly 30 or 60 days from today and an `account_manager_id`, then trigger `renewal-sweep` manually from the dev UI.
Expected: the run reports `emitted ≥ 1`, a `renewal_due` row lands in `notification` for the account manager, and a `notification/email.requested` run fires (logging `[email:dev] would send` with the local placeholder key).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renewals): register renewalSweep in the Inngest serve-route registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Wire `client_task_created` into Plan 03's `createTask` (exact call-site)

**Files:**
- Modify: `src/app/(internal)/tasks/actions.ts` (the `createTask` action)

PRD §5.2 acceptance: "Client-created task generates a notification to the assigned account manager." PRD §5.14 lists `client-created task` as a notification kind (enum value `client_task_created`). When a **client** creates a task (origin `client`), notify the client's `account_manager_id`. We insert the emit at the end of `createTask`, after the task insert, so it never blocks the write and only fires for client-origin tasks.

- [ ] **Step 1: Add imports at the top of `src/app/(internal)/tasks/actions.ts`**

Add to the existing import block (do not duplicate `eq` if already imported):

```ts
import { clients } from '@/db/schema'
import { emitNotification } from '@/lib/notifications/emit'
```

- [ ] **Step 2: Capture the inserted task id and emit after insert**

The current `createTask` ends with:

```ts
  await db.insert(tasks).values({
    organizationId: board.organizationId,
    boardId: input.boardId,
    columnId: input.columnId,
    title: input.title,
    description: input.description ?? null,
    assigneeId,
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    origin,
    createdBy: userId,
    position: nextPos,
  })
  revalidatePath('/tasks')
}
```

Replace those final lines with the following (capture the new row, then emit for client-origin tasks):

```ts
  const [created] = await db
    .insert(tasks)
    .values({
      organizationId: board.organizationId,
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description ?? null,
      assigneeId,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      origin,
      createdBy: userId,
      position: nextPos,
    })
    .returning({ id: tasks.id })

  // PRD §5.2/§5.14: a client-created task notifies the client's account manager.
  if (origin === 'client' && created) {
    const [client] = await db
      .select({ accountManagerId: clients.accountManagerId })
      .from(clients)
      .where(eq(clients.organizationId, board.organizationId))
      .limit(1)

    if (client?.accountManagerId) {
      await emitNotification({
        organizationId: board.organizationId,
        userId: client.accountManagerId,
        category: 'client_task_created',
        title: `New client task: ${input.title}`,
        body: `A client created a task on their board.`,
        linkPath: `/tasks/${created.id}`,
        data: { taskId: created.id, boardId: input.boardId },
      })
    }
  }

  revalidatePath('/tasks')
}
```

> `board.organizationId` is the client's tenant org (the board belongs to the client org), and Plan 02's `client` row is keyed by that `organization_id`, so this lookup resolves the right account manager. The account manager is agency staff but the in-app row is tagged with the client org for the client board context; if your build prefers the manager's agency org for their notification feed, swap `organizationId` for the manager's agency-membership org (resolve via `memberships` as in Task 12) — the recipient (`userId`) is unchanged.

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tasks): emit client_task_created to the account manager on client task create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: @mention parser (pure, TDD)

**Files:**
- Create: `tests/tasks/mentions.test.ts`
- Create: `src/lib/tasks/mentions.ts`

PRD §5.2 / §5.14: "@mentions trigger notifications." We parse `@token` handles from comment text. Convention: a mention is `@` followed by the local-part of a user's email (e.g. `@levi` for `levi@...`) OR a full `@email@domain`. To keep it deterministic and testable, the parser extracts candidate handles; the action (Task 16) resolves them against `profiles.email` within the task's org and emits `task_mention` to matched users.

- [ ] **Step 1: Write the failing unit test `tests/tasks/mentions.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseMentions } from '@/lib/tasks/mentions'

describe('parseMentions', () => {
  it('extracts a simple @handle', () => {
    expect(parseMentions('hey @levi can you check this')).toEqual(['levi'])
  })

  it('extracts a full @email@domain mention', () => {
    expect(parseMentions('cc @sandesh@milktreeagency.com please')).toEqual([
      'sandesh@milktreeagency.com',
    ])
  })

  it('extracts multiple unique mentions, preserving first-seen order', () => {
    expect(parseMentions('@a and @b and @a again')).toEqual(['a', 'b'])
  })

  it('ignores an @ with no following word char', () => {
    expect(parseMentions('email me @ the office')).toEqual([])
  })

  it('does not treat mid-word @ as a mention (e.g. inside an email already)', () => {
    expect(parseMentions('write to bob@x.com directly')).toEqual([])
  })

  it('handles dots, hyphens and underscores in handles', () => {
    expect(parseMentions('@levi.eweka and @a-b_c hi')).toEqual(['levi.eweka', 'a-b_c'])
  })

  it('returns [] for empty / no mentions', () => {
    expect(parseMentions('')).toEqual([])
    expect(parseMentions('no mentions here')).toEqual([])
  })
})
```

Run: `pnpm test tests/tasks/mentions.test.ts`
Expected: **FAIL** — `@/lib/tasks/mentions` does not exist.

- [ ] **Step 2: Implement `src/lib/tasks/mentions.ts`**

```ts
// Pure @mention extractor. A mention is `@` preceded by start-of-string or
// whitespace, then a handle: either an email (local@domain) or a bare token
// (letters, digits, dot, hyphen, underscore). Returns unique handles in
// first-seen order. The mid-word case (e.g. inside `bob@x.com`) is excluded by
// requiring a boundary before the `@`.
export function parseMentions(text: string): string[] {
  if (!text) return []
  const re = /(?:^|\s)@([A-Za-z0-9._-]+(?:@[A-Za-z0-9.-]+)?)/g
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const handle = m[1]!
    if (!seen.has(handle)) {
      seen.add(handle)
      out.push(handle)
    }
  }
  return out
}

// Given parsed handles, build the set of email candidates to match against
// profiles.email: a bare handle `levi` matches any email whose local-part is
// `levi`; a full `a@b` matches that exact email.
export function handlesToEmailMatchers(handles: string[]): {
  exactEmails: string[]
  localParts: string[]
} {
  const exactEmails: string[] = []
  const localParts: string[] = []
  for (const h of handles) {
    if (h.includes('@')) exactEmails.push(h.toLowerCase())
    else localParts.push(h.toLowerCase())
  }
  return { exactEmails, localParts }
}
```

Run: `pnpm test tests/tasks/mentions.test.ts`
Expected: **PASS** — all seven cases green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(tasks): pure @mention parser + email matchers (tests pass)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Wire `task_mention` into Plan 03's `addComment` (exact call-site)

**Files:**
- Modify: `src/app/(internal)/tasks/actions.ts` (the `addComment` action)

After inserting a comment, parse mentions, resolve matched users in the task's org, and emit `task_mention` to each (excluding the author). This satisfies PRD §5.2 ("@mentions trigger notifications") and uses the `task_mention` enum value from Plan 05.

- [ ] **Step 1: Add imports**

Add to the import block of `src/app/(internal)/tasks/actions.ts` (do not duplicate already-present symbols):

```ts
import { profiles, memberships } from '@/db/schema'
import { inArray, ne } from 'drizzle-orm'
import { parseMentions, handlesToEmailMatchers } from '@/lib/tasks/mentions'
import { emitNotification } from '@/lib/notifications/emit'
import { sql as dsql } from 'drizzle-orm'
```

> `emitNotification` may already be imported from Task 14 — if so, do not add it twice. `clients`/`eq` likewise.

- [ ] **Step 2: Emit mentions after the comment insert**

The current `addComment` ends with:

```ts
  await db.insert(taskComments).values({
    organizationId: task.organizationId,
    taskId,
    authorId: userId,
    body: body.trim(),
  })
  revalidatePath(`/tasks/${taskId}`)
}
```

Replace those final lines with:

```ts
  await db.insert(taskComments).values({
    organizationId: task.organizationId,
    taskId,
    authorId: userId,
    body: body.trim(),
  })

  // PRD §5.2/§5.14: @mentions in a comment notify the mentioned users.
  const handles = parseMentions(body)
  if (handles.length > 0) {
    const { exactEmails, localParts } = handlesToEmailMatchers(handles)

    // Resolve mentioned users who are members of the task's org (so a comment can
    // only mention people on that board's tenant — agency staff or the client org).
    const mentioned = await db
      .select({ id: profiles.id, email: profiles.email })
      .from(profiles)
      .innerJoin(memberships, eq(memberships.userId, profiles.id))
      .where(
        and(
          eq(memberships.organizationId, task.organizationId),
          ne(profiles.id, userId), // never self-notify
          exactEmails.length > 0 || localParts.length > 0
            ? dsql`(
                lower(${profiles.email}) = any(${exactEmails})
                or lower(split_part(${profiles.email}, '@', 1)) = any(${localParts})
              )`
            : dsql`false`,
        ),
      )

    for (const u of mentioned) {
      await emitNotification({
        organizationId: task.organizationId,
        userId: u.id,
        category: 'task_mention',
        title: `You were mentioned on a task`,
        body: body.trim().slice(0, 140),
        linkPath: `/tasks/${taskId}`,
        data: { taskId, by: userId },
      })
    }
  }

  revalidatePath(`/tasks/${taskId}`)
}
```

> Account managers for agency staff also live in the agency org, so mentioning a staff handle on a client board only matches if that staff user is a member of the client org. If you want staff to be mentionable on client boards regardless of membership, resolve against the agency org as well (union the membership filter with `is_agency_staff`-style logic). The conservative default above scopes mentions to actual board members.

- [ ] **Step 3: Type-check + full task-related run**

Run: `pnpm exec tsc --noEmit`
Expected: compiles with no type errors.

Run: `pnpm test tests/tasks/mentions.test.ts`
Expected: still PASS (parser unchanged).

- [ ] **Step 4: Manual smoke test**

Run `pnpm dlx inngest-cli@latest dev` + `pnpm dev`. As a client (`user1@clientone.com`), create a task on the client board → confirm a `client_task_created` notification row appears for the client's account manager (set `account_manager_id` on the client first via Plan 02). As any board member, add a comment containing `@founder` (or `@<email-local-part>` of another member) → confirm a `task_mention` notification row appears for that user and a `notification/email.requested` run fires.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tasks): parse @mentions in comments and emit task_mention notifications

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 17: Full-suite run to mirror CI

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the full suite**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: lint clean; no type errors; all tests pass — Plan 01 RLS/auth tests, all earlier modules' suites, plus this plan's: `permissions/flags`, `permissions/hasPermission`, `tasks/mentions`, `renewals/sweep`, `settings/team-actions`, and `rls/team-permission.isolation`.

- [ ] **Step 2: Commit (if lint/format produced changes)**

```bash
git add -A
git commit -m "chore: plan 20 full-suite green (settings, permissions, renewals, notif wiring)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed)

**Spec coverage (vs the four scope items + PRD §3.3, §4.1, §5.2, §5.4, §5.14, §12):**

- **(A) Settings hub at `(internal)/settings` (founder-only):**
  - Team & user management — invite via Supabase Admin `createUser` + create membership → `inviteUser` (Task 7) + UI (Task 9). ✅
  - Deactivate user → `deactivateUser` (Admin `deleteUser`, FK-cascade) (Task 7) + UI (Task 9). ✅
  - Change role → `changeRole` (Task 7) + role select (Task 9). ✅
  - Role/permission management UI → `/settings/permissions` page + toggles + `setPermission` (Tasks 8–9). ✅
  - Founder-only enforcement → section layout guard `isFounder()` (Task 8) + per-action `requireFounder()`/`isFounder` guards (Tasks 7–8). PRD §3.3 "Settings, user management, billing config — Founder only." ✅
- **(B) Granular team permissions (PRD §3.3 "configurable"):**
  - `team_permission` model with the four required boolean flags `finance_edit | time_reports_view | connections_manage | invoicing_manage` (Task 1). ✅
  - Tested authorize-style helper `hasPermission(session, flag)` — founder ⇒ true, client ⇒ false, team ⇒ DB flag (default false) — full unit matrix (Task 4). ✅
  - Enforcement in the relevant Server Actions via `requirePermission` preamble (finance invoicing, connections, time reports, finance-config) (Task 10). ✅
  - RLS + isolation test → Tasks 2–3 (KEYSTONE) with the Plan 01 harness. ✅
- **(C) Renewal alerts (PRD §5.4 30/60-day):**
  - Inngest CRON `renewalSweep` registered via the Plan 1.5 serve-route registry (Tasks 12–13). ✅
  - Sweeps `client.renewalDate` daily; emits `renewal_due` at exactly 60 and 30 days (pure `renewalAlertDay`, tested) (Task 12). ✅
  - Uses Plan 05 emit path (service-role variant for the session-less job) + Plan 1.5 `sendEmail` via the existing `notification/email.requested` worker (Tasks 11–12). ✅
- **(D) Notification wiring of the deferred emitters:**
  - `client_task_created` emitted inside Plan 03's `createTask` to the client's `account_manager_id` — exact call-site code shown (Task 14). PRD §5.2 acceptance. ✅
  - `@mention` parsing → `task_mention` notifications inside `addComment` — exact call-site code shown (Tasks 15–16). PRD §5.2 "@mentions trigger notifications." ✅
  - Canonical helpers used: `emitNotification` (Plan 05), `sendEmail` (Plan 1.5), `recordAuditEvent` (Plan 1.5). ✅

**Shared-conventions compliance:** the one new tenant table `team_permission` carries `organization_id` as the leading column of a composite index (`idx_team_permission_org_user`); RLS enabled with policies that REUSE `public.is_agency_staff()` / `public.has_org_access()` / `public.is_founder()` (Task 3); `service_role` used only for admin/jobs (Settings admin clients, audit, service-role emit, renewal CRON) and never for user-facing reads (Settings pages read via the Plan 01 RLS-scoped Drizzle client); a KEYSTONE RLS isolation test exists for the new table (Tasks 2–3). Inngest client/serve-route/registry are CONSUMED, not recreated (Task 13 appends only). Enum values reused from Plan 05 (`client_task_created`, `task_mention`, `renewal_due`) — no new enum drift. Table name singular per PRD §8 convention (`team_permission`). ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. The only deferred items are explicit, justified integration seams against named upstream plans: (a) the `recordAuditEvent` `metadata` vs `before/after` field name (documented adapt-one-field note); (b) the `sendEmail` import path if the build placed it differently (documented alias note); (c) Task 10's per-action gates are inserted into Plan 04/06/14-owned modules whose surrounding bodies this plan does not re-spec (exact preamble + exact action names given). These are wiring instructions, not unfinished code. ✅

**Type consistency:** `PermissionFlag`/`PERMISSION_FLAGS`/`PermissionSubject`/`PermissionFlags` consistent across `flags.ts`, `load.ts`, `permissions/page.tsx`, `permission-toggles.tsx`, and the Task 10 preamble; `hasPermission` signature identical between definition and all call-sites; `TeamPermission`/`NewTeamPermission` exported from `src/db/types.ts` and the `teamPermissions` Drizzle symbol ↔ `team_permission` DB table consistent across schema, RLS SQL, actions, and tests; `EmitInput`/`resolveDelivery` reused verbatim from Plan 05 in `emit-service.ts`; `notification_category` literals (`client_task_created`, `task_mention`, `renewal_due`) match the Plan 05 enum; `SessionInfo` (`{ userId, email, role, orgId }`) from `src/lib/auth.ts` used uniformly; `renewalAlertDay` signature identical between definition, the CRON, and the test. ✅

**Definition of done for Plan 20:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green (permission unit matrix, mention parser, renewal-window logic, team-action integration, and the `team_permission` RLS isolation test all pass), the manual smoke tests behave as described (founder can invite/deactivate/role-change and toggle permissions; non-founders are redirected from `/settings`; a client-created task notifies the account manager; an @mention in a comment notifies the mentioned member; the `renewal-sweep` cron emits `renewal_due` at 60/30 days), and `renewal-sweep` is visible in the Inngest dev UI with no other registered function removed.
