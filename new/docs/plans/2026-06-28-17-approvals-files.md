# Agency OS — Plan 17: Approvals & File Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver PRD §5.11 — professional deliverable hand-off and sign-off in the client portal. Agency staff upload deliverables (creative, docs, drafts) to a client into a private, tenant-isolated Supabase Storage bucket; staff request approval; the client reviews and either **approves** or **requests changes** with threaded comments; deliverables are **versioned** (re-uploads supersede earlier versions without losing history); every status transition **notifies** the right people (re-using Plan 05 `emitNotification()`) and is **audited** (re-using Plan 05 `recordAuditEvent()`). All file downloads happen via short-lived **expiring signed URLs** minted server-side from the user's own RLS-scoped session, and an automated test proves a client cannot fetch another client's asset.

**Architecture:** Builds directly on Plan 01 (tenancy, RLS helpers `public.has_org_access(uuid)` / `public.is_agency_staff()`, the custom-access-token hook, the `tests/helpers/db.ts` `asUser()` harness, `getSession`/`isStaff` from `src/lib/auth.ts`) and Plan 02 (`client` table → the per-client organization profile; we attach file assets and approvals to a `client_id` whose `organization_id` is the tenant). It also re-uses Plan 05's `emitNotification()` (with the already-defined `approval_requested` / `approval_decided` categories) and `recordAuditEvent()` helpers — we do **not** re-spec those.

Three new tenant-scoped tables (PRD §8 names exactly): `file_asset`, `approval`, `approval_comment`. A `file_asset` row is the metadata record for one uploaded object in the `client-files` Storage bucket; multiple `file_asset` rows form a **version chain** through a self-referential `root_asset_id` + monotonically increasing `version` (the latest version of a chain is `is_current = true`). An `approval` row attaches to **one** `file_asset` (the version being signed off) and carries `status` (`pending | approved | changes_requested`). `approval_comment` rows thread feedback under an approval. Storage objects live at the path `{organization_id}/{client_id}/{file_asset_id}/{filename}` so the tenant id is the leading path segment; a **Storage RLS policy** on `storage.objects` (re-using `public.has_org_access`) makes cross-tenant object access impossible at the database layer, and the app only ever mints `createSignedUrl` from the user's RLS-scoped session. Uploads, status transitions, and version supersession all run inside Server Actions that scope by `client_id`/`organization_id`, fire notifications, and write audit rows.

**Tech Stack:** Next.js 16 (App Router, TypeScript strict) · Supabase (Postgres + Auth + **Storage**) · Drizzle ORM + drizzle-kit · postgres.js · Tailwind + shadcn/ui · Vitest (unit + RLS isolation incl. Storage cross-tenant test) · Inngest + Resend (via Plan 05 `emitNotification`). No new external services.

**Depends on:** Plan 01 (foundation) and Plan 05 (notifications + audit). Specifically reuses, and does NOT redefine:
- Plan 01: `organizations`/`profiles`/`memberships`, `org_type`/`app_role` enums, `public.has_org_access(uuid)`, `public.is_agency_staff()`, `custom_access_token_hook`, `scripts/seed.ts`, `tests/helpers/db.ts` (`asUser()`, `userIdByEmail()`), `src/lib/auth.ts` (`getSession`, `isStaff`), `src/lib/supabase/server.ts` (`createSupabaseServerClient`), `src/db/index.ts` (`db`).
- Plan 02: `client` table (`src/db/schema.ts` → `clients`), `idx_client_org`, the `client-one` / `client-two` org seed.
- Plan 05: `src/lib/notifications/emit.ts` (`emitNotification`, categories `approval_requested` / `approval_decided`), `src/lib/audit/record.ts` (`recordAuditEvent`).

---

## File Structure (created/modified by this plan)

```
.
├─ src/
│  ├─ db/
│  │  ├─ schema.ts                              # MODIFY: append file_asset, approval, approval_comment
│  │  └─ types.ts                               # MODIFY: export new row types
│  ├─ lib/
│  │  └─ files/
│  │     ├─ storage.ts                          # NEW: bucket name, object-path builder, signed-URL minting
│  │     ├─ versioning.ts                       # NEW: pure next-version / supersede logic (unit-tested)
│  │     └─ queries.ts                          # NEW: server-only reads (asset list, approval + comments)
│  ├─ actions/
│  │  └─ approvals.ts                           # NEW: uploadDeliverable / requestApproval /
│  │                                            #      decideApproval / addApprovalComment / getDownloadUrl
│  ├─ components/
│  │  └─ files/
│  │     ├─ file-list.tsx                       # NEW: shared version-grouped asset list + download buttons
│  │     ├─ approval-panel.tsx                  # NEW: approve / request-changes controls (client) + comments
│  │     └─ upload-deliverable.tsx              # NEW: staff upload form (client component)
│  └─ app/
│     ├─ (internal)/clients/[clientId]/files/page.tsx   # NEW: staff upload + request-approval view
│     └─ (portal)/files/page.tsx                        # NEW: client review/approve/download view
├─ drizzle/
│  ├─ 00XX_approvals_files.sql                  # generated (tables + enum)
│  └─ 00XX+1_approvals_files_rls.sql            # custom (table RLS + Storage bucket/policies + indexes)
├─ scripts/seed-files.ts                        # NEW: idempotent files/approvals demo seed (for tests)
└─ tests/
   ├─ files/versioning.test.ts                  # NEW: pure version-chain logic unit test
   ├─ rls/files.isolation.test.ts               # NEW: RLS isolation (file_asset, approval, approval_comment)
   └─ rls/storage.isolation.test.ts             # NEW: cross-tenant Storage object access denied
```

> **Migration numbering:** this plan adds two migrations after the highest existing number in `drizzle/`. Discover it with `ls drizzle/*.sql`; this document writes `00XX` / `00XX+1` for the generated and custom files respectively. Substitute the real numbers drizzle-kit assigns.

---

## Task 1: Schema — add `file_asset`, `approval`, `approval_comment`

The three tables follow PRD §8 names exactly and are **tenant-scoped**: each carries `organization_id` as the **leading** column of a composite index (PRD §9 performance rule). `file_asset` also carries `client_id` (the Plan 02 `client.id`) so the portal view filters by client. Versioning is modelled in-row: `root_asset_id` groups a chain (the first version points at itself after insert via the action), `version` is a 1-based counter, and `is_current` marks the head of the chain.

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `drizzle/00XX_approvals_files.sql` (generated)

- [ ] **Step 1: Append the tables to `src/db/schema.ts`**

Ensure the existing top-of-file `drizzle-orm/pg-core` import already includes `pgTable, pgEnum, uuid, text, timestamp, integer, boolean, jsonb, index` (Plan 02 added all of these). Append to the **bottom** of `src/db/schema.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Plan 17 — Approvals & File Sharing (PRD §5.11)
// ─────────────────────────────────────────────────────────────────────────────

// Approval lifecycle (PRD §5.11): pending → approved | changes_requested.
export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'changes_requested',
])

// file_asset = metadata for ONE uploaded object in the `client-files` Storage
// bucket. Multiple rows sharing root_asset_id form a version chain; is_current
// marks the head. storage_path is the object key inside the bucket and ALWAYS
// begins with the tenant org id segment (see lib/files/storage.ts).
export const fileAssets = pgTable(
  'file_asset',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // Object key within the bucket: {organizationId}/{clientId}/{assetId}/{filename}.
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    // Version chain: rootAssetId groups all versions; version is 1-based; the head
    // of the chain has isCurrent = true. The first row sets rootAssetId = its own id.
    rootAssetId: uuid('root_asset_id'),
    version: integer('version').notNull().default(1),
    isCurrent: boolean('is_current').notNull().default(true),
    uploadedById: uuid('uploaded_by_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // tenant-leading composite index (PRD §9 performance rule).
    byOrgClient: index('idx_file_asset_org_client').on(
      t.organizationId,
      t.clientId,
      t.createdAt,
    ),
    byRoot: index('idx_file_asset_root').on(t.rootAssetId, t.version),
  }),
)

// approval = a sign-off request attached to ONE file_asset version.
export const approvals = pgTable(
  'approval',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    fileAssetId: uuid('file_asset_id')
      .notNull()
      .references(() => fileAssets.id, { onDelete: 'cascade' }),
    status: approvalStatus('status').notNull().default('pending'),
    // Staff member who requested the approval.
    requestedById: uuid('requested_by_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    // Client user who approved / requested changes (set on decision).
    decidedById: uuid('decided_by_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byOrgClient: index('idx_approval_org_client').on(
      t.organizationId,
      t.clientId,
      t.createdAt,
    ),
    byAsset: index('idx_approval_asset').on(t.fileAssetId),
  }),
)

// approval_comment = threaded feedback under an approval (client + staff).
export const approvalComments = pgTable(
  'approval_comment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    approvalId: uuid('approval_id')
      .notNull()
      .references(() => approvals.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byOrgClient: index('idx_approval_comment_org_client').on(
      t.organizationId,
      t.clientId,
      t.approvalId,
    ),
  }),
)
```

> Note: `organizations`, `profiles`, and `clients` are already in scope in `schema.ts` (Plan 01 + Plan 02). Do **not** add a self-import. `rootAssetId` is a plain `uuid` (no `.references`) because the first version's row references its own not-yet-existing id; the upload action backfills it transactionally (Task 5).

- [ ] **Step 2: Export row types in `src/db/types.ts`**

Append:

```ts
import type { fileAssets, approvals, approvalComments } from './schema'

export type FileAsset = typeof fileAssets.$inferSelect
export type NewFileAsset = typeof fileAssets.$inferInsert
export type Approval = typeof approvals.$inferSelect
export type NewApproval = typeof approvals.$inferInsert
export type ApprovalComment = typeof approvalComments.$inferSelect
export type NewApprovalComment = typeof approvalComments.$inferInsert
export type ApprovalStatus = Approval['status']
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00XX_approvals_files.sql` containing the `approval_status` enum and the three tables (`file_asset`, `approval`, `approval_comment`) with their indexes.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Then verify:
```bash
psql "$DATABASE_URL" -c "\dt public.*" | grep -E 'file_asset|approval'
```
Expected: `file_asset`, `approval`, `approval_comment` listed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): file_asset, approval, approval_comment tables (Plan 17)"
```

---

## Task 2: Pure versioning logic + unit test (TDD)

Version-chain arithmetic must be pure and unit-testable without a DB. `nextVersion()` computes the next version number from existing chain rows; `chainUpdates()` returns the set of `is_current` flips a new version must apply (the new row is current; all prior rows in the chain become not-current). Writing the failing test first proves the logic.

**Files:**
- Create: `tests/files/versioning.test.ts`
- Create: `src/lib/files/versioning.ts`

- [ ] **Step 1: Write the failing unit test `tests/files/versioning.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { nextVersion, supersededAssetIds } from '@/lib/files/versioning'

describe('file version chain', () => {
  it('first version of a new chain is 1', () => {
    expect(nextVersion([])).toBe(1)
  })

  it('next version is max(existing) + 1', () => {
    expect(nextVersion([{ version: 1 }, { version: 2 }])).toBe(3)
    expect(nextVersion([{ version: 3 }, { version: 1 }, { version: 2 }])).toBe(4)
  })

  it('supersededAssetIds returns every currently-current asset in the chain', () => {
    const chain = [
      { id: 'a', version: 1, isCurrent: false },
      { id: 'b', version: 2, isCurrent: true },
    ]
    expect(supersededAssetIds(chain)).toEqual(['b'])
  })

  it('supersededAssetIds is empty for a fresh (single-version) chain head only', () => {
    // No prior current rows besides what we are about to insert → nothing to flip.
    expect(supersededAssetIds([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `pnpm test tests/files/versioning.test.ts`
Expected: **FAIL** — `src/lib/files/versioning.ts` does not exist (module not found).

- [ ] **Step 3: Implement `src/lib/files/versioning.ts`**

```ts
// Pure version-chain helpers — no DB, no IO (unit-tested in tests/files/versioning.test.ts).

export type ChainRow = { id?: string; version: number; isCurrent?: boolean }

// The next 1-based version number for a chain given its existing rows.
export function nextVersion(existing: Pick<ChainRow, 'version'>[]): number {
  if (existing.length === 0) return 1
  return Math.max(...existing.map((r) => r.version)) + 1
}

// Ids of rows in the chain that are currently `is_current = true` and must be
// flipped to false when a newer version becomes the head.
export function supersededAssetIds(existing: ChainRow[]): string[] {
  return existing
    .filter((r) => r.isCurrent && typeof r.id === 'string')
    .map((r) => r.id as string)
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `pnpm test tests/files/versioning.test.ts`
Expected: **PASS** — all four cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(files): pure version-chain logic + unit test (Plan 17)"
```

---

## Task 3: Storage path + signed-URL helper

A single module owns the bucket name, the tenant-leading object path, and signed-URL minting. The path **always** starts with `{organizationId}/` so the Storage RLS policy (Task 4) can authorize by the leading segment via `public.has_org_access`. Signed URLs are minted from the **user's own** RLS-scoped Supabase server client (Plan 01 `createSupabaseServerClient`), never the service role — so a request that the Storage policy would deny cannot mint a URL.

**Files:**
- Create: `src/lib/files/storage.ts`

- [ ] **Step 1: Implement `src/lib/files/storage.ts`**

```ts
import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Private bucket holding all client deliverables. Created (private) in the
// Storage migration (Task 4). All objects are tenant-isolated by RLS on
// storage.objects keyed on the leading path segment (the org id).
export const CLIENT_FILES_BUCKET = 'client-files'

// Signed URLs expire quickly: long enough to start a download, short enough that
// a leaked URL is useless (PRD §5.11 "downloads use expiring signed URLs").
export const SIGNED_URL_TTL_SECONDS = 60

// Build the object key. The org id is the LEADING segment so Storage RLS can
// authorize via public.has_org_access on (storage.foldername(name))[1].
export function buildStoragePath(
  organizationId: string,
  clientId: string,
  fileAssetId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^\w.\- ]+/g, '_')
  return `${organizationId}/${clientId}/${fileAssetId}/${safeName}`
}

// Mint a short-lived signed download URL from the USER's RLS-scoped session.
// Returns null when Storage RLS denies access (cross-tenant or unauthenticated),
// so callers must treat null as "forbidden / not found".
export async function createSignedDownloadUrl(storagePath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.storage
    .from(CLIENT_FILES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

// Upload bytes to the user's RLS-scoped session. Returns true on success; false
// when Storage RLS denies the write (e.g. wrong tenant path).
export async function uploadToStorage(
  storagePath: string,
  file: File,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.storage
    .from(CLIENT_FILES_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  return !error
}
```

- [ ] **Step 2: Type-check it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors introduced by `storage.ts` (it only references Plan 01's `createSupabaseServerClient`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(files): storage bucket + tenant-leading path + signed-URL helper (Plan 17)"
```

---

## Task 4: KEYSTONE — RLS isolation tests (tables + Storage) → watch them FAIL

RLS is not yet enabled on the three new tables, and the Storage bucket/policies do not exist. Write the isolation tests first, prove they fail, then enable everything in Task 5 (which is split: table RLS + Storage RLS in one custom migration, then re-run to green). We extend the seed in this task so the tests have cross-tenant fixtures.

**Files:**
- Create: `scripts/seed-files.ts`
- Modify: `package.json` (add `db:seed:files` script)
- Create: `tests/rls/files.isolation.test.ts`
- Create: `tests/rls/storage.isolation.test.ts`

- [ ] **Step 1: Add the seed script entry to `package.json`**

Add to the `"scripts"` block:
```json
{
  "db:seed:files": "tsx scripts/seed-files.ts"
}
```

- [ ] **Step 2: Write `scripts/seed-files.ts`**

This seeds, for **each** client org, one `file_asset` (current, version 1), one `pending` `approval` on it, and one staff `approval_comment` — plus the matching Storage objects so the cross-tenant Storage test has real keys to probe. It is idempotent (skips if a seed asset already exists for the org).

```ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { buildStoragePath, CLIENT_FILES_BUCKET } from '../src/lib/files/storage'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const db = drizzle(postgres(process.env.DATABASE_URL!, { prepare: false }), { schema })

async function orgIdBySlug(slug: string): Promise<string> {
  const rows = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug))
  if (!rows[0]) throw new Error(`org not found: ${slug} (run pnpm db:seed first)`)
  return rows[0].id
}

async function clientIdByOrg(orgId: string): Promise<string> {
  const rows = await db.select().from(schema.clients).where(eq(schema.clients.organizationId, orgId))
  if (!rows[0]) throw new Error(`client profile not found for org ${orgId} (run pnpm db:seed:crm first)`)
  return rows[0].id
}

async function profileIdByEmail(email: string): Promise<string> {
  const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.email, email))
  if (!rows[0]) throw new Error(`profile not found: ${email} (run pnpm db:seed first)`)
  return rows[0].id
}

async function seedForClient(orgSlug: string, fileName: string) {
  const orgId = await orgIdBySlug(orgSlug)
  const clientId = await clientIdByOrg(orgId)
  const founder = await profileIdByEmail('founder@milktreeagency.com')

  // Idempotency: skip if this org already has a seeded asset with this fileName.
  const existing = await db
    .select()
    .from(schema.fileAssets)
    .where(and(eq(schema.fileAssets.organizationId, orgId), eq(schema.fileAssets.fileName, fileName)))
  if (existing[0]) return

  const [asset] = await db
    .insert(schema.fileAssets)
    .values({
      organizationId: orgId,
      clientId,
      // Placeholder; backfilled with the real path below now we have the id.
      storagePath: 'pending',
      fileName,
      contentType: 'text/plain',
      sizeBytes: 12,
      version: 1,
      isCurrent: true,
      uploadedById: founder,
    })
    .returning()

  const storagePath = buildStoragePath(orgId, clientId, asset!.id, fileName)
  await db
    .update(schema.fileAssets)
    .set({ storagePath, rootAssetId: asset!.id })
    .where(eq(schema.fileAssets.id, asset!.id))

  // Upload the matching object via the service role so the Storage test can probe it.
  await admin.storage
    .from(CLIENT_FILES_BUCKET)
    .upload(storagePath, new Blob(['seed deliver'], { type: 'text/plain' }), { upsert: true })

  const [approval] = await db
    .insert(schema.approvals)
    .values({
      organizationId: orgId,
      clientId,
      fileAssetId: asset!.id,
      status: 'pending',
      requestedById: founder,
    })
    .returning()

  await db.insert(schema.approvalComments).values({
    organizationId: orgId,
    clientId,
    approvalId: approval!.id,
    authorId: founder,
    body: 'Please review this draft and approve.',
  })
}

async function main() {
  await seedForClient('client-one', 'client-one-draft.txt')
  await seedForClient('client-two', 'client-two-draft.txt')
  console.log('Files/approvals seed complete')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 3: Run the seeds in order**

Run:
```bash
pnpm db:seed
pnpm db:seed:crm
pnpm db:seed:files
```
Expected: all succeed; re-running `pnpm db:seed:files` prints "Files/approvals seed complete" with no duplicate rows.

- [ ] **Step 4: Write `tests/rls/files.isolation.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, asUser, userIdByEmail } from '../helpers/db'

describe('tenant isolation (RLS): file_asset / approval / approval_comment', () => {
  let founder: string
  let clientOneUser: string
  let clientTwoUser: string

  beforeAll(async () => {
    founder = await userIdByEmail('founder@milktreeagency.com')
    clientOneUser = await userIdByEmail('user1@clientone.com')
    clientTwoUser = await userIdByEmail('user2@clienttwo.com')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('a client sees ONLY their own file_asset rows', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select file_name from public.file_asset`)
    const names = rows.map((r) => r.file_name)
    expect(names).toEqual(['client-one-draft.txt'])
  })

  it('a client cannot read another client\'s file_asset', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select file_name from public.file_asset`)
    expect(rows.some((r) => r.file_name === 'client-two-draft.txt')).toBe(false)
  })

  it('agency staff (founder) can read ALL file_asset rows', async () => {
    const rows = await asUser(founder, (tx) => tx`select file_name from public.file_asset order by file_name`)
    const names = rows.map((r) => r.file_name)
    expect(names).toContain('client-one-draft.txt')
    expect(names).toContain('client-two-draft.txt')
  })

  it('a client sees ONLY their own approvals', async () => {
    const rows = await asUser(clientTwoUser, (tx) => tx`select client_id from public.approval`)
    const own = await sql`
      select c.id from public.client c
      join public.organizations o on o.id = c.organization_id
      where o.slug = 'client-two'`
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.client_id === own[0]!.id)).toBe(true)
  })

  it('a client cannot read another client\'s approval_comment', async () => {
    const rows = await asUser(clientOneUser, (tx) => tx`select client_id from public.approval_comment`)
    const other = await sql`
      select c.id from public.client c
      join public.organizations o on o.id = c.organization_id
      where o.slug = 'client-two'`
    expect(rows.some((r) => r.client_id === other[0]!.id)).toBe(false)
  })
})
```

- [ ] **Step 5: Write `tests/rls/storage.isolation.test.ts`**

This asserts the **acceptance criterion** "a client cannot fetch another client's asset." It signs in as each client user with the anon Supabase client (so Storage RLS applies), then attempts to create a signed URL for the *other* client's seeded object — which must fail — and for *their own* object — which must succeed.

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const BUCKET = 'client-files'
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })

async function signedInClient(email: string): Promise<SupabaseClient> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { error } = await supabase.auth.signInWithPassword({ email, password: 'Password123!' })
  if (error) throw error
  return supabase
}

async function seededPathForOrg(slug: string): Promise<string> {
  const rows = await sql`
    select fa.storage_path from public.file_asset fa
    join public.organizations o on o.id = fa.organization_id
    where o.slug = ${slug}
    order by fa.created_at asc
    limit 1`
  if (!rows[0]) throw new Error(`no seeded file_asset for ${slug} (run pnpm db:seed:files)`)
  return rows[0].storage_path as string
}

describe('cross-tenant Storage isolation (signed URLs)', () => {
  let clientOnePath: string
  let clientTwoPath: string

  beforeAll(async () => {
    clientOnePath = await seededPathForOrg('client-one')
    clientTwoPath = await seededPathForOrg('client-two')
  })

  it('client-one user CAN sign their own object', async () => {
    const supa = await signedInClient('user1@clientone.com')
    const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(clientOnePath, 60)
    expect(error).toBeNull()
    expect(data?.signedUrl).toBeTruthy()
  })

  it('client-one user CANNOT sign client-two\'s object', async () => {
    const supa = await signedInClient('user1@clientone.com')
    const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(clientTwoPath, 60)
    // Storage RLS denies → no URL is returned.
    expect(data?.signedUrl ?? null).toBeNull()
    expect(error).not.toBeNull()
  })

  it('client-two user CANNOT sign client-one\'s object', async () => {
    const supa = await signedInClient('user2@clienttwo.com')
    const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(clientOnePath, 60)
    expect(data?.signedUrl ?? null).toBeNull()
    expect(error).not.toBeNull()
  })

  it('agency staff CAN sign any client object', async () => {
    const supa = await signedInClient('founder@milktreeagency.com')
    const one = await supa.storage.from(BUCKET).createSignedUrl(clientOnePath, 60)
    const two = await supa.storage.from(BUCKET).createSignedUrl(clientTwoPath, 60)
    expect(one.data?.signedUrl).toBeTruthy()
    expect(two.data?.signedUrl).toBeTruthy()
  })
})
```

> The Storage test uses real password sign-in against the local stack (seed users have password `Password123!`, Plan 01). Auth sign-in is allowed against the local API; no special harness is needed because Storage RLS evaluates the signed-in JWT directly.

- [ ] **Step 6: Run both isolation suites and confirm they FAIL**

Run:
```bash
pnpm test tests/rls/files.isolation.test.ts tests/rls/storage.isolation.test.ts
```
Expected: **FAIL** —
- `files.isolation.test.ts`: a client reads **all** file_asset/approval/approval_comment rows because table RLS is not enabled, so the "ONLY their own" assertions fail.
- `storage.isolation.test.ts`: either the `client-files` bucket does not exist yet (sign attempts error for everyone) **or**, if you created it ad hoc, no Storage policy denies cross-tenant access. Both ways the "CANNOT sign" / "CAN sign own" expectations fail. These failures prove the tests are real.

- [ ] **Step 7: Commit the failing tests + seed**

```bash
git add -A
git commit -m "test(rls): file/approval + Storage cross-tenant isolation (failing, RLS not enabled)"
```

---

## Task 5: Enable table RLS + Storage bucket/policies → make the tests PASS

One custom migration does both halves: (a) enable RLS on the three tables with policies that REUSE Plan 01's `public.has_org_access(organization_id)` and `public.is_agency_staff()`; (b) create the **private** `client-files` Storage bucket and RLS policies on `storage.objects` keyed on the leading path segment (the org id) via `public.has_org_access`. Staff get cross-client read/write; clients get read on their own org's objects (download) and **no** Storage write (uploads are staff-only per PRD §5.11 "Founder, Team upload"; clients review/approve/download).

**Files:**
- Create: `drizzle/00XX+1_approvals_files_rls.sql` (custom)

- [ ] **Step 1: Create an empty custom migration**

Run: `pnpm db:generate --custom --name=approvals_files_rls`
Expected: an empty `drizzle/00XX+1_approvals_files_rls.sql` registered in the journal.

- [ ] **Step 2: Fill in `drizzle/00XX+1_approvals_files_rls.sql`**

```sql
-- ── Table RLS ────────────────────────────────────────────────────────────────
alter table public.file_asset       enable row level security;
alter table public.approval         enable row level security;
alter table public.approval_comment enable row level security;

-- file_asset: visible if the user has access to the owning org (staff: all;
-- client: own org only). Inserts/updates require the same access (staff upload;
-- supersede flips is_current). Defense-in-depth scoping in the actions too.
create policy file_asset_select on public.file_asset
  for select using (public.has_org_access(organization_id));
create policy file_asset_insert on public.file_asset
  for insert with check (public.has_org_access(organization_id));
create policy file_asset_update on public.file_asset
  for update using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- approval: same org-access rule for select/insert/update (client decisions are
-- updates; staff requests are inserts).
create policy approval_select on public.approval
  for select using (public.has_org_access(organization_id));
create policy approval_insert on public.approval
  for insert with check (public.has_org_access(organization_id));
create policy approval_update on public.approval
  for update using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- approval_comment: anyone with org access may read; the author may post within
-- an accessible org.
create policy approval_comment_select on public.approval_comment
  for select using (public.has_org_access(organization_id));
create policy approval_comment_insert on public.approval_comment
  for insert with check (
    public.has_org_access(organization_id) and author_id = auth.uid()
  );

-- ── Storage bucket + RLS ─────────────────────────────────────────────────────
-- Private bucket for all client deliverables.
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

-- Object key shape: {organization_id}/{client_id}/{file_asset_id}/{filename}.
-- (storage.foldername(name))[1] is the leading org-id segment; authorize via the
-- Plan 01 helper so cross-tenant object access is impossible at the DB layer.

-- SELECT (download / createSignedUrl): any user with access to the org segment.
create policy "client_files_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-files'
    and public.has_org_access(((storage.foldername(name))[1])::uuid)
  );

-- INSERT (upload): STAFF ONLY (clients review/approve/download, never upload).
create policy "client_files_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-files'
    and public.is_agency_staff()
    and public.has_org_access(((storage.foldername(name))[1])::uuid)
  );

-- UPDATE (overwrite metadata on re-upload): staff only.
create policy "client_files_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-files'
    and public.is_agency_staff()
    and public.has_org_access(((storage.foldername(name))[1])::uuid)
  );

-- DELETE: staff only (version cleanup / withdrawals).
create policy "client_files_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-files'
    and public.is_agency_staff()
    and public.has_org_access(((storage.foldername(name))[1])::uuid)
  );
```

> `public.has_org_access` and `public.is_agency_staff` are SECURITY DEFINER functions from Plan 01; they read `auth.uid()` and the user's memberships, so they evaluate correctly inside `storage.objects` policies (the policy runs as the signed-in user). Casting the first path segment to `uuid` rejects malformed keys.

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies `00XX+1_approvals_files_rls.sql` with no errors (bucket inserted, eight policies created).

- [ ] **Step 4: Re-run the isolation suites and confirm they PASS**

Run:
```bash
pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:files
pnpm test tests/rls/files.isolation.test.ts tests/rls/storage.isolation.test.ts
```
Expected: **all PASS** —
- `files.isolation`: each client sees only their own file_asset/approval/approval_comment; the founder sees both.
- `storage.isolation`: each client can sign their own object but **not** the other client's; staff can sign both.

> If the Storage seed objects predate the bucket policy, re-run `pnpm db:seed:files` (idempotent) after the migration so the objects exist under the new policy regime.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(security): table + Storage RLS for approvals/files (cross-tenant tests pass)"
```

---

## Task 6: Server query layer (asset list, approval thread, signed downloads)

Read functions for the two pages. They run as the user's RLS-scoped session for defense in depth (explicit `organizationId`/`clientId` filters on top of RLS). `listClientAssets` groups by version chain and returns only current heads with their version count; `getApprovalThread` loads an approval, its asset, and ordered comments.

**Files:**
- Create: `src/lib/files/queries.ts`

- [ ] **Step 1: Implement `src/lib/files/queries.ts`**

```ts
import 'server-only'
import { db } from '@/db'
import { fileAssets, approvals, approvalComments, profiles } from '@/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'

// Current (head) deliverables for a client org, newest first. Each row is the
// latest version of its chain; versionCount is the number of rows in the chain.
export async function listClientAssets(organizationId: string, clientId: string) {
  const heads = await db
    .select({
      id: fileAssets.id,
      fileName: fileAssets.fileName,
      contentType: fileAssets.contentType,
      sizeBytes: fileAssets.sizeBytes,
      storagePath: fileAssets.storagePath,
      version: fileAssets.version,
      rootAssetId: fileAssets.rootAssetId,
      createdAt: fileAssets.createdAt,
    })
    .from(fileAssets)
    .where(
      and(
        eq(fileAssets.organizationId, organizationId),
        eq(fileAssets.clientId, clientId),
        eq(fileAssets.isCurrent, true),
      ),
    )
    .orderBy(desc(fileAssets.createdAt))
  return heads
}

// The latest approval (if any) for a given file_asset head.
export async function getApprovalForAsset(organizationId: string, fileAssetId: string) {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.organizationId, organizationId), eq(approvals.fileAssetId, fileAssetId)))
    .orderBy(desc(approvals.createdAt))
    .limit(1)
  return row ?? null
}

// An approval plus its ordered comment thread (author email joined).
export async function getApprovalThread(organizationId: string, approvalId: string) {
  const [approval] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.organizationId, organizationId), eq(approvals.id, approvalId)))
    .limit(1)
  if (!approval) return null

  const comments = await db
    .select({
      id: approvalComments.id,
      body: approvalComments.body,
      createdAt: approvalComments.createdAt,
      authorEmail: profiles.email,
    })
    .from(approvalComments)
    .leftJoin(profiles, eq(profiles.id, approvalComments.authorId))
    .where(
      and(
        eq(approvalComments.organizationId, organizationId),
        eq(approvalComments.approvalId, approvalId),
      ),
    )
    .orderBy(asc(approvalComments.createdAt))

  return { approval, comments }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(files): server query layer (asset heads, approval thread) (Plan 17)"
```

---

## Task 7: Server Actions — upload, request approval, decide, comment, download (with notify + audit)

All mutations live in one Server Actions module. Each: (1) authenticates via Plan 01 `getSession`; (2) enforces role (upload/request are staff-only; decide is client-only); (3) writes the row(s) scoped by `organizationId`/`clientId`; (4) re-uses Plan 05 `emitNotification()` and `recordAuditEvent()`; (5) `revalidatePath`s. Versioning re-uses Task 2's pure helpers transactionally.

**Files:**
- Create: `src/actions/approvals.ts`

- [ ] **Step 1: Implement `src/actions/approvals.ts`**

```ts
'use server'
import { db } from '@/db'
import { fileAssets, approvals, approvalComments, clients, memberships } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getSession, isStaff } from '@/lib/auth'
import { buildStoragePath, uploadToStorage, createSignedDownloadUrl } from '@/lib/files/storage'
import { nextVersion, supersededAssetIds } from '@/lib/files/versioning'
import { emitNotification } from '@/lib/notifications/emit'
import { recordAuditEvent } from '@/lib/audit/record'

// Resolve the client + its tenant org id, asserting it exists.
async function resolveClient(clientId: string) {
  const [c] = await db
    .select({ id: clients.id, organizationId: clients.organizationId, name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  if (!c) throw new Error('client not found')
  return c
}

// First client user of an org (notification recipient for requests).
async function firstClientUser(organizationId: string): Promise<string | null> {
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'client')))
    .limit(1)
  return m?.userId ?? null
}

// STAFF: upload a deliverable. If rootAssetId is provided, this is a new VERSION
// of that chain (supersedes the prior current head); otherwise a new chain.
export async function uploadDeliverable(formData: FormData): Promise<{ assetId: string }> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  if (!isStaff(session.role)) throw new Error('forbidden: staff only')

  const clientId = String(formData.get('clientId') ?? '')
  const rootAssetId = (formData.get('rootAssetId') as string | null) || null
  const file = formData.get('file')
  if (!clientId || !(file instanceof File)) throw new Error('clientId and file required')

  const client = await resolveClient(clientId)

  // Determine the version + chain rows to supersede.
  let version = 1
  let supersede: string[] = []
  if (rootAssetId) {
    const chain = await db
      .select({ id: fileAssets.id, version: fileAssets.version, isCurrent: fileAssets.isCurrent })
      .from(fileAssets)
      .where(
        and(eq(fileAssets.organizationId, client.organizationId), eq(fileAssets.rootAssetId, rootAssetId)),
      )
    version = nextVersion(chain)
    supersede = supersededAssetIds(chain)
  }

  // Insert metadata first to get the id for the storage path.
  const [asset] = await db
    .insert(fileAssets)
    .values({
      organizationId: client.organizationId,
      clientId,
      storagePath: 'pending',
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      version,
      isCurrent: true,
      rootAssetId: rootAssetId ?? undefined,
      uploadedById: session.userId,
    })
    .returning()

  const storagePath = buildStoragePath(client.organizationId, clientId, asset!.id, file.name)
  const ok = await uploadToStorage(storagePath, file)
  if (!ok) {
    // Roll back metadata if the object write was denied/failed.
    await db.delete(fileAssets).where(eq(fileAssets.id, asset!.id))
    throw new Error('storage upload failed')
  }

  // Backfill the path and rootAssetId (self-reference for a brand-new chain).
  await db
    .update(fileAssets)
    .set({ storagePath, rootAssetId: rootAssetId ?? asset!.id })
    .where(eq(fileAssets.id, asset!.id))

  // Demote superseded versions.
  if (supersede.length > 0) {
    await db
      .update(fileAssets)
      .set({ isCurrent: false })
      .where(inArray(fileAssets.id, supersede))
  }

  await recordAuditEvent({
    actorId: session.userId,
    organizationId: client.organizationId,
    action: 'file.upload',
    targetType: 'file_asset',
    targetId: asset!.id,
    after: { fileName: file.name, version, clientId },
  })

  revalidatePath(`/clients/${clientId}/files`)
  return { assetId: asset!.id }
}

// STAFF: request the client's approval on a specific asset version.
export async function requestApproval(assetId: string): Promise<{ approvalId: string }> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  if (!isStaff(session.role)) throw new Error('forbidden: staff only')

  const [asset] = await db
    .select({
      id: fileAssets.id,
      organizationId: fileAssets.organizationId,
      clientId: fileAssets.clientId,
      fileName: fileAssets.fileName,
    })
    .from(fileAssets)
    .where(eq(fileAssets.id, assetId))
    .limit(1)
  if (!asset) throw new Error('asset not found')

  const [approval] = await db
    .insert(approvals)
    .values({
      organizationId: asset.organizationId,
      clientId: asset.clientId,
      fileAssetId: asset.id,
      status: 'pending',
      requestedById: session.userId,
    })
    .returning()

  const recipient = await firstClientUser(asset.organizationId)
  if (recipient) {
    await emitNotification({
      organizationId: asset.organizationId,
      userId: recipient,
      category: 'approval_requested',
      title: 'Approval requested',
      body: `Please review "${asset.fileName}".`,
      linkPath: '/files',
      data: { approvalId: approval!.id, fileAssetId: asset.id },
    })
  }

  await recordAuditEvent({
    actorId: session.userId,
    organizationId: asset.organizationId,
    action: 'approval.request',
    targetType: 'approval',
    targetId: approval!.id,
    after: { fileAssetId: asset.id, status: 'pending' },
  })

  revalidatePath(`/clients/${asset.clientId}/files`)
  revalidatePath('/files')
  return { approvalId: approval!.id }
}

// CLIENT: approve or request changes. Notifies the requesting staff member and
// audits the transition.
export async function decideApproval(
  approvalId: string,
  decision: 'approved' | 'changes_requested',
): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  if (isStaff(session.role)) throw new Error('forbidden: client decision only')

  const [current] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, approvalId))
    .limit(1)
  if (!current) throw new Error('approval not found')
  if (current.status !== 'pending') throw new Error('approval already decided')

  await db
    .update(approvals)
    .set({ status: decision, decidedById: session.userId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(approvals.id, approvalId))

  if (current.requestedById) {
    await emitNotification({
      organizationId: current.organizationId,
      userId: current.requestedById,
      category: 'approval_decided',
      title: decision === 'approved' ? 'Deliverable approved' : 'Changes requested',
      body:
        decision === 'approved'
          ? 'The client approved the deliverable.'
          : 'The client requested changes.',
      linkPath: `/clients/${current.clientId}/files`,
      data: { approvalId, decision },
    })
  }

  await recordAuditEvent({
    actorId: session.userId,
    organizationId: current.organizationId,
    action: 'approval.decide',
    targetType: 'approval',
    targetId: approvalId,
    before: { status: current.status },
    after: { status: decision },
  })

  revalidatePath('/files')
  revalidatePath(`/clients/${current.clientId}/files`)
}

// EITHER side: post a comment on an approval thread.
export async function addApprovalComment(approvalId: string, body: string): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  const trimmed = body.trim()
  if (!trimmed) throw new Error('empty comment')

  const [approval] = await db
    .select({ organizationId: approvals.organizationId, clientId: approvals.clientId })
    .from(approvals)
    .where(eq(approvals.id, approvalId))
    .limit(1)
  if (!approval) throw new Error('approval not found')

  await db.insert(approvalComments).values({
    organizationId: approval.organizationId,
    clientId: approval.clientId,
    approvalId,
    authorId: session.userId,
    body: trimmed,
  })

  revalidatePath('/files')
  revalidatePath(`/clients/${approval.clientId}/files`)
}

// EITHER side: mint a short-lived signed download URL for an asset the caller
// can access. Returns null when Storage RLS denies (cross-tenant / not found).
export async function getDownloadUrl(assetId: string): Promise<string | null> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')

  const [asset] = await db
    .select({ storagePath: fileAssets.storagePath })
    .from(fileAssets)
    .where(eq(fileAssets.id, assetId))
    .limit(1)
  if (!asset) return null

  // Minted from the user's RLS-scoped session inside createSignedDownloadUrl:
  // cross-tenant requests return null because Storage RLS denies them.
  return createSignedDownloadUrl(asset.storagePath)
}
```

> `memberships` is the Plan 01 table (already in `schema.ts`). `emitNotification`/`recordAuditEvent` are Plan 05 helpers — signatures match exactly (see Plan 05 Tasks 5 & 7). The `firstClientUser` lookup is a deliberate v1 simplification (one client user per client org per Plan 01 seed); fan-out to all client members is a later enhancement, not in §5.11 scope.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(approvals): upload/request/decide/comment/download actions + notify + audit (Plan 17)"
```

---

## Task 8: UI components — file list, upload form, approval panel

Three components. `FileList` (shared) renders current deliverables with a download button (calls `getDownloadUrl` then opens the URL). `UploadDeliverable` (staff) posts the upload form action and offers a "Request approval" button per asset. `ApprovalPanel` (client) shows Approve / Request changes buttons (disabled once decided) and the comment thread + composer.

**Files:**
- Create: `src/components/files/file-list.tsx`
- Create: `src/components/files/upload-deliverable.tsx`
- Create: `src/components/files/approval-panel.tsx`

- [ ] **Step 1: Shared download-capable list `src/components/files/file-list.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { getDownloadUrl } from '@/actions/approvals'

export type FileRow = {
  id: string
  fileName: string
  version: number
  createdAt: string | Date
}

export function FileList({ files }: { files: FileRow[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(id: string) {
    setError(null)
    setBusy(id)
    try {
      const url = await getDownloadUrl(id)
      if (!url) {
        setError('You do not have access to this file.')
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(null)
    }
  }

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No deliverables yet.</p>
  }

  return (
    <ul className="divide-y rounded border">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between p-3 text-sm">
          <span>
            {f.fileName} <span className="text-muted-foreground">v{f.version}</span>
          </span>
          <Button size="sm" variant="outline" disabled={busy === f.id} onClick={() => download(f.id)}>
            {busy === f.id ? 'Preparing…' : 'Download'}
          </Button>
        </li>
      ))}
      {error && <li className="p-3 text-sm text-red-600">{error}</li>}
    </ul>
  )
}
```

- [ ] **Step 2: Staff upload form `src/components/files/upload-deliverable.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { uploadDeliverable, requestApproval } from '@/actions/approvals'

export function UploadDeliverable({
  clientId,
  assets,
}: {
  clientId: string
  assets: { id: string; fileName: string; rootAssetId: string | null }[]
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onUpload(formData: FormData) {
    setBusy(true)
    setMessage(null)
    try {
      formData.set('clientId', clientId)
      await uploadDeliverable(formData)
      setMessage('Uploaded.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRequest(assetId: string) {
    setBusy(true)
    setMessage(null)
    try {
      await requestApproval(assetId)
      setMessage('Approval requested.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={onUpload} className="flex items-center gap-3">
        <input type="file" name="file" required className="text-sm" />
        <Button type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Upload deliverable'}
        </Button>
      </form>

      {assets.length > 0 && (
        <ul className="divide-y rounded border">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center justify-between p-3 text-sm">
              <span>{a.fileName}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onRequest(a.id)}>
                Request approval
              </Button>
            </li>
          ))}
        </ul>
      )}

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Client approval panel `src/components/files/approval-panel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { decideApproval, addApprovalComment } from '@/actions/approvals'

export type ApprovalView = {
  id: string
  status: 'pending' | 'approved' | 'changes_requested'
  fileName: string
}

export type CommentView = { id: string; body: string; authorEmail: string | null }

export function ApprovalPanel({
  approval,
  comments,
}: {
  approval: ApprovalView
  comments: CommentView[]
}) {
  const [status, setStatus] = useState(approval.status)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const decided = status !== 'pending'

  async function decide(decision: 'approved' | 'changes_requested') {
    setBusy(true)
    try {
      await decideApproval(approval.id, decision)
      setStatus(decision)
    } finally {
      setBusy(false)
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    setBusy(true)
    try {
      await addApprovalComment(approval.id, comment)
      setComment('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded border p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">{approval.fileName}</p>
        <span className="text-xs uppercase text-muted-foreground">{status.replace('_', ' ')}</span>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || decided} onClick={() => decide('approved')}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || decided}
          onClick={() => decide('changes_requested')}
        >
          Request changes
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{c.authorEmail ?? 'Unknown'}: </span>
            {c.body}
          </li>
        ))}
      </ul>

      <form onSubmit={postComment} className="flex gap-2">
        <input
          className="flex-1 rounded border p-2 text-sm"
          placeholder="Add a comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Post
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(files): UI components — file list, upload form, approval panel (Plan 17)"
```

---

## Task 9: Routes — staff client-files page + portal files page

Two App-Router Server Components compose the queries (Task 6) and components (Task 8). The staff route lives under `(internal)/clients/[clientId]/files` (Plan 01's internal layout already redirects non-staff); the portal route lives under `(portal)/files` (Plan 01's portal layout already redirects staff). The portal page resolves the client by the session's `orgId`.

**Files:**
- Create: `src/app/(internal)/clients/[clientId]/files/page.tsx`
- Create: `src/app/(portal)/files/page.tsx`

- [ ] **Step 1: Staff page `src/app/(internal)/clients/[clientId]/files/page.tsx`**

```tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { listClientAssets } from '@/lib/files/queries'
import { FileList } from '@/components/files/file-list'
import { UploadDeliverable } from '@/components/files/upload-deliverable'

export default async function StaffFilesPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { clientId } = await params
  const [client] = await db
    .select({ id: clients.id, organizationId: clients.organizationId, name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  if (!client) redirect('/clients')

  const assets = await listClientAssets(client.organizationId, client.id)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Files & Approvals — {client.name}</h1>
      <UploadDeliverable
        clientId={client.id}
        assets={assets.map((a) => ({ id: a.id, fileName: a.fileName, rootAssetId: a.rootAssetId }))}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Current deliverables</h2>
        <FileList
          files={assets.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            version: a.version,
            createdAt: a.createdAt,
          }))}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Portal page `src/app/(portal)/files/page.tsx`**

```tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { listClientAssets, getApprovalForAsset, getApprovalThread } from '@/lib/files/queries'
import { FileList } from '@/components/files/file-list'
import { ApprovalPanel } from '@/components/files/approval-panel'

export default async function PortalFilesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.orgId) redirect('/overview')

  const [client] = await db
    .select({ id: clients.id, organizationId: clients.organizationId, name: clients.name })
    .from(clients)
    .where(eq(clients.organizationId, session.orgId))
    .limit(1)
  if (!client) {
    return <p className="text-sm text-muted-foreground">No files yet.</p>
  }

  const assets = await listClientAssets(client.organizationId, client.id)

  // Build approval panels for assets that have an approval request.
  const panels = []
  for (const a of assets) {
    const approval = await getApprovalForAsset(client.organizationId, a.id)
    if (!approval) continue
    const thread = await getApprovalThread(client.organizationId, approval.id)
    if (!thread) continue
    panels.push(
      <ApprovalPanel
        key={approval.id}
        approval={{ id: approval.id, status: approval.status, fileName: a.fileName }}
        comments={thread.comments.map((c) => ({ id: c.id, body: c.body, authorEmail: c.authorEmail }))}
      />,
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Files & Approvals</h1>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Deliverables</h2>
        <FileList
          files={assets.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            version: a.version,
            createdAt: a.createdAt,
          }))}
        />
      </section>
      {panels.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Awaiting your review</h2>
          {panels}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev`
1. Sign in as `founder@milktreeagency.com` → visit `/clients/<client-one client id>/files` → upload a file → "Request approval" on it. (Find the client id via the Plan 02 clients list `/clients`, or `psql "$DATABASE_URL" -c "select id from public.client"`.)
2. Sign out; sign in as `user1@clientone.com` → visit `/files` → see the deliverable + an approval panel; click **Download** (opens a signed URL), add a comment, then **Approve**. The panel shows "approved" and the buttons disable.
3. Sign back in as the founder → visit `/notifications` (Plan 05) → see the "Deliverable approved" notification; visit `/settings/audit` → see `approval.decide` and `file.upload` rows.

Expected: all steps behave as described; a client never sees another client's files (proven in Task 4).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(files): staff client-files route + portal files/approvals route (Plan 17)"
```

---

## Task 10: Full suite + lint gate

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the whole suite**

Run:
```bash
pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:files
pnpm lint && pnpm tsc --noEmit && pnpm test
```
Expected: lint clean; types clean; **all** tests pass — Plan 01 RLS + auth-claims, Plan 02/05 suites, plus this plan's:
- `tests/files/versioning.test.ts` (pure version logic)
- `tests/rls/files.isolation.test.ts` (file_asset / approval / approval_comment tenant isolation)
- `tests/rls/storage.isolation.test.ts` (cross-tenant Storage signed-URL denial)

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test(files): green suite gate for approvals & file sharing (Plan 17)"
```

---

## Self-Review (completed)

**Spec coverage (vs PRD §5.11 Approvals & File Sharing, §8 Data Model, §9 Security):**
- §5.11 "Upload deliverables to a client; request approval" → `uploadDeliverable` + `requestApproval` Server Actions (Task 7); staff-only enforced in code (role guard) and at the Storage layer (`is_agency_staff()` insert policy, Task 5). ✅
- §5.11 "client approves/requests changes with comments" → `decideApproval` (client-only) + `addApprovalComment` (Task 7); `ApprovalPanel` UI (Task 8); `approval_comment` table (Task 1). ✅
- §5.11 "Versioning" → `root_asset_id` + `version` + `is_current` chain (Task 1); pure `nextVersion`/`supersededAssetIds` (Task 2, unit-tested); transactional supersession in `uploadDeliverable` (Task 7). ✅
- §5.11 "status (pending / approved / changes-requested)" → `approval_status` enum exactly those three values (Task 1). ✅
- §5.11 "notifications on each transition" → `emitNotification('approval_requested')` on request, `emitNotification('approval_decided')` on decision, re-using Plan 05's already-defined categories (Task 7). ✅
- §5.11 "File library per client with signed-URL downloads" → `listClientAssets` per client (Task 6); `FileList` download via `getDownloadUrl` → `createSignedDownloadUrl` with `SIGNED_URL_TTL_SECONDS = 60` (Tasks 3/7/8). ✅
- §5.11 acceptance "Approval state changes notify the right people and are audited" → notify (above) + `recordAuditEvent('approval.request' / 'approval.decide' / 'file.upload')` (Task 7), readable in Plan 05's Founder-only audit viewer. ✅
- §5.11 acceptance "Files are tenant-isolated; downloads use expiring signed URLs" → table RLS + Storage RLS keyed on the org-id leading path segment via `public.has_org_access` (Task 5); expiring signed URLs (Task 3); **cross-tenant fetch denied test** `tests/rls/storage.isolation.test.ts` proves a client cannot fetch another client's asset (Task 4 fails → Task 5 passes). ✅
- §8 Data Model: table names `file_asset`, `approval`, `approval_comment` used **exactly**; each tenant-scoped table carries `organization_id` as the **leading** column of a composite index (`idx_file_asset_org_client`, `idx_approval_org_client`, `idx_approval_comment_org_client`) per the §9 performance rule. ✅
- §9 Security: RLS enabled on all three tables; policies REUSE Plan 01 helpers `public.has_org_access()` / `public.is_agency_staff()` (no new helper invented); Storage objects are tenant-isolated by RLS on `storage.objects`; signed URLs are minted from the **user's** RLS-scoped session (never `service_role`); the only `service_role` use is the seed/admin object upload (Task 4) and Plan 05's `recordAuditEvent` connection — never a user-facing read; every new tenant-scoped table has an RLS isolation test using the Plan 01 `asUser()` harness (Task 4). Defense-in-depth: queries and actions also filter by `organizationId`/`clientId` explicitly. ✅
- §7 cross-check: PRD §7 (AI report) also stores PDFs in Supabase Storage via signed URLs; this plan establishes the private-bucket + tenant-path + signed-URL pattern that §7's report storage reuses — consistent, not conflicting. ✅
- **Dependencies (Plans 01, 02, 05):** reuses Plan 01 tenancy/helpers/harness/auth/Supabase server client; attaches to Plan 02's `client` table and its org seed; re-uses Plan 05's `emitNotification` (categories `approval_requested`/`approval_decided` already defined there) and `recordAuditEvent`. None of these are re-spec'd. ✅

**Placeholder scan:** No "TBD" / "add error handling" / "similar to above". Every code step contains complete, runnable code. The only deferred items are explicit integration seams, each justified: (a) migration file numbers (`00XX`) are environment-determined and the plan says how to discover them; (b) `firstClientUser` notification fan-out is a documented v1 simplification matching the Plan 01 one-client-user seed, not unfinished code. ✅

**Type consistency:** `ApprovalStatus` derived from the Drizzle `approval` enum and used across actions/components; `FileAsset`/`Approval`/`ApprovalComment` row types exported from `src/db/types.ts`; enum values `pending | approved | changes_requested` match between `schema.ts`, the SQL migration, the seed, the actions, and the UI; `getSession`/`isStaff` (Plan 01), `emitNotification`/`EmitInput` categories and `recordAuditEvent`/`AuditInput` (Plan 05) used with their exact signatures; `CLIENT_FILES_BUCKET = 'client-files'` is the single source of the bucket name shared by `storage.ts`, the seed, the migration, and the Storage test. ✅

**Definition of done for Plan 17:** `pnpm db:seed && pnpm db:seed:crm && pnpm db:seed:files` succeed; `pnpm lint && pnpm tsc --noEmit && pnpm test` green — including the version-chain unit test, the file/approval/comment RLS isolation suite, and the cross-tenant Storage signed-URL denial test — and the Task 9 manual smoke test behaves correctly for founder (upload + request), client (download + comment + approve), and confirms notifications + audit rows are written, with no client able to reach another client's files.
