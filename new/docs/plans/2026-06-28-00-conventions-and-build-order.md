# Agency OS — Plan 00: Conventions & Build Order (READ FIRST)

This is the index and single source of truth for the Agency OS implementation-plan suite. Read it before any other plan. It defines the **build order**, the **canonical names/paths** every plan must use, and the **reconciliation rules** that resolve the few cross-plan inconsistencies. Where any individual plan disagrees with this document on a shared name, path, or ordering, **this document wins.**

The source spec is [`Agency-OS-PRD.md`](../../Agency-OS-PRD.md) (v2.1 — **React + Supabase**, see PRD §0.1). Each plan is a self-contained, test-first (TDD) build unit. Two ways to execute a plan: **subagent-driven** (a fresh agent per task, review between tasks) or **inline** (batch with checkpoints) — see `superpowers:subagent-driven-development` / `superpowers:executing-plans`.

> **Stack amendment (v2.1):** Plans were written against a greenfield **Next.js + Drizzle** scaffold. We are **evolving `riftly-dashboard`** with **React (Vite) + Supabase** instead. **Keep every plan's original steps** for requirements and acceptance criteria; **adapt file paths and server patterns** using §2.1 below. Where §2.1 conflicts with a plan's Next.js/Drizzle instructions, **§2.1 wins**.

---

## 1. Build order

Build top-to-bottom. Each plan produces working, tested software on its own. Phases map to PRD §12.

| # | Plan file | Module | PRD § | Depends on |
|--|--|--|--|--|
| 1 | `01-foundation` | Tenancy, RLS, auth, app shell | 3, 9, 10 | — *(adapt: evolve existing repo — §2.1)* |
| 2 | `01b-shared-platform-services` (**Plan 1.5**) | Inngest client+route, email `sendEmail`, `audit_event`+`recordAuditEvent` | 5.14, 9 | 01 |
| 3 | `02-clients-crm` | Client accounts + CRM deals | 5.3, 5.4 | 01 |
| 4 | `03-tasks-time` | Kanban tasks (two-way) + time entries | 5.2, 5.9 | 01, 02 |
| 5 | `04-finance-invoicing` | Stripe invoicing + payments | 5.8 | 01, 1.5, 02 |
| 6 | `05-portal-notifications-audit-skills` | Portal shell, notifications, skills *(audit superseded — see §4)* | 5.13–5.15 | 01, 1.5, 02–04 |
| 7 | `06-integration-framework` | Connections, token vault, sync scheduler, metrics store | 6.1, 6.2 | 01, 1.5, 02 |
| 8 | `07-ga4-gsc-connectors` | GA4 + Search Console | 6.3 | 06 |
| 9 | `08-google-ads-meta-connectors` | Google Ads + Meta | 6.3 | 06 |
| 10 | `09-gbp-connector` | Google Business Profile | 6.3 | 06 |
| 11 | `10-unified-leads` | Unified leads inbox | 5.7 | 06 |
| 12 | `11-analytics-aggregator-ui` | Analytics dashboards (internal + portal) | 5.6 | 06–10 |
| 13 | `12-ai-report-generator` | Monthly AI report | 7 | 1.5, 03, 04, 06, 11 |
| 14 | `13-onboarding-wizard` | Connect flows + connection health | 5.5 | 06–10 |
| 15 | `14-time-profitability` | Time reports + profitability | 5.9 | 1.5, 03, 04 |
| 16 | `15-messaging` | DMs + channels | 5.12 | 01, 02 |
| 17 | `16-contracts-esign` | Proposals + e-sign | 5.10 | 1.5, 02 |
| 18 | `17-approvals-files` | Approvals + file sharing | 5.11 | 02, 05 |
| 19 | `18-chat-looker-gocardless` | Ask-your-data chat, Looker embed, GoCardless | 6.1, 6.3, 5.8 | 04, 06, 11, 12 |
| 20 | `19-founder-cockpit` | Founder exec cockpit | 5.1 | 1.5, 02, 04, 10, 11 |
| 21 | `20-settings-permissions-notifications` | Settings hub, team permissions, renewal alerts, notification wiring | 3.3, 4.1, 5.4, 5.14, 5.2 | 1.5, 02, 03, 05 |

> **Cockpit (19) and Settings (20) are numbered last but are not "Phase 3".** They depend on data from earlier plans, so they are built once those exist. Cockpit can ship a **basic** version right after Plan 04 (finance cards) and gain leads/analytics cards after Plans 10/11 — each card is gated on data availability. Settings (20) can be built any time after Plan 05.

**Phases (PRD §12):** Phase 1 = 01, 1.5, 02–05, 19(basic), 20. Phase 2 = 06–13, 19(full). Phase 3 = 14–18.

---

## 2. Canonical conventions (every plan follows these)

**Stack (original v2.0 spec — preserved for context):** Next.js 16 App Router + TypeScript strict · pnpm · Supabase Postgres + Auth · Drizzle ORM (`src/db/schema.ts`; `pnpm db:generate` / `db:migrate`; custom SQL via `--custom`) · postgres.js · Tailwind + shadcn/ui · Vitest · Inngest · Resend · Supabase Vault · `@anthropic-ai/sdk` (`claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5`) · Stripe · dnd-kit · Recharts · Vercel.

### 2.1 React + Supabase implementation (chosen — v2.1)

**We are sticking to React and Supabase.** Evolve the live app at the **repository root** (`riftly-dashboard`). Do **not** scaffold Next.js or migrate to Drizzle unless explicitly decided later.

| Concern | Next.js plan text says | → Use in `riftly-dashboard` |
|--|--|--|
| Framework | Next.js 16 App Router | **React 19 + Vite** + `react-router-dom` |
| Package manager | pnpm | **npm** or **bun** (match repo lockfile) |
| Routes / layouts | `src/app/(internal)/…`, `src/app/(portal)/…`, `middleware.ts` | `src/App.tsx` routes + `src/pages/…` + layout components (`DashboardLayout`, portal layout when added). Role guards in route wrappers (`ProtectedRoute`, etc.) — same as `AuthContext` / `WorkspaceContext`. |
| Supabase browser client | `src/lib/supabase/client.ts` | `src/lib/supabase.ts` (existing) |
| Supabase server client | `src/lib/supabase/server.ts` (SSR) | **Not used in SPA** — user-scoped reads/writes via browser client + RLS; **`service_role` only in Edge Functions** |
| Schema / migrations | Drizzle `src/db/schema.ts` + `drizzle/` | **`supabase/migrations/*.sql`** + regenerate `src/lib/database.types.ts` (`supabase gen types`) |
| ORM | Drizzle queries | **`@supabase/supabase-js`** `.from()` / `.rpc()` from React; raw SQL in migrations |
| API routes / webhooks | `src/app/api/…/route.ts` | **Supabase Edge Functions** (`supabase/functions/…`) — Stripe webhooks, Inngest serve (if used), connector sync triggers |
| Background jobs | `src/app/api/inngest/route.ts` | Edge Function Inngest handler **or** external Inngest endpoint; register functions in `src/lib/inngest/functions/` (create when Plan 1.5 lands) |
| Auth helpers | `src/lib/auth.ts` `getSession()` server | `src/contexts/AuthContext.tsx` + `src/contexts/WorkspaceContext.tsx`; extract shared helpers to `src/lib/auth.ts` as needed |
| Tests | Vitest + `tests/helpers/db.ts` RLS harness | **Add Vitest** when implementing Plan 01 goals; RLS tests can run against local Supabase (`supabase start`) |
| Hosting | Vercel (Next.js) | **Vercel/Netlify** static deploy of Vite `dist/` + Supabase project |

**Tenancy note:** The live schema today uses `workspaces` / `workspace_members` / `projects` (client accounts). PRD/Plan 01 target `organizations` / `memberships`. **Evolve incrementally** — either rename/migrate toward the PRD model or document a mapping (`workspace` ≈ agency org, `project` ≈ client). RLS and isolation requirements are unchanged.

**Tenancy & security (from Plan 01 — adapt to React + Supabase):**
- `organizations` = tenants (`org_type` `agency|client`); `profiles`; `memberships(user_id, organization_id, role app_role founder|team|client)`.
- RLS helpers **`public.has_org_access(uuid)`** and **`public.is_agency_staff()`** already exist — reuse in every policy.
- Every tenant-scoped table has **`organization_id` as the leading column** of a composite index and an **RLS isolation test** using `tests/helpers/db.ts` (`asUser`, `userIdByEmail`, `sql`).
- `service_role` only for admin/jobs (audit writes, seeds, system-user syncs) — never user-facing reads.
- Auth: `src/lib/auth.ts` exports `getSession()` / `isStaff()` (+ `isFounder()` after Plan 20). JWT claims `app_role` + `org_id` come from `custom_access_token_hook`.

**Canonical shared modules (owned by Plan 1.5 — import, never recreate):**
| Concern | Import from | Export |
|--|--|--|
| Background jobs | `@/lib/inngest/client` | `inngest` |
| Job registration | `src/app/api/inngest/route.ts` *(Next.js)* → **`supabase/functions/inngest/index.ts`** or dedicated serve URL *(React + Supabase — §2.1)* | central `functions: [...]` **registry** — append your functions |
| Email | `@/lib/email/resend` | `sendEmail({ to, subject, html })` |
| Audit | `@/lib/audit/record` | `recordAuditEvent({ actorId, action, targetType, targetId, metadata, organizationId })` |
| Audit store | `audit_event` table | (created by Plan 1.5) |

**Integration provider enum (from Plan 06):** symbol **`integrationProvider`** (DB type `integration_provider`); values: `fake, ga4, gsc, google_ads, meta_ads, gbp, callrail, whatconverts, web_form, stripe`. **Meta = `meta_ads`.**

---

## 3. Table-naming canon

PRD §8 is the *conceptual* model. The implemented DDL uses these exact names; cross-plan references already match them. Use the **implemented** name:

| Concept (PRD §8) | Implemented table | Owning plan |
|--|--|--|
| customer / invoice / line_item / payment / subscription / revenue_target | `customers` · `invoices` · `line_items` · `payments` · `subscriptions` · `revenue_targets` (plural) | 04 |
| cost_rate / profitability_rollup | `cost_rates` · `profitability_rollups` (plural) | 14 |
| report | `reports` (plural) | 12 |
| board/column/task/time_entry | `boards` · `board_columns` · `tasks` · `time_entries` (plural) | 03 |
| everything else (client, deal, connection, metric_daily, lead, notification, audit_event, conversation, contract, approval, skill_doc, …) | **singular** (as in PRD §8) | various |

Rule of thumb: **finance, time, reports, and tasks tables are plural; all others singular.** When a plan references another module's table, it already uses the names above.

---

## 4. Reconciliation rules (the few cross-plan fixes — already applied)

These were found by a consistency critic and resolved. Listed so you understand the "why".

1. **Provider enum (fixed in code).** Canonical is `integrationProvider` / value `meta_ads`. Plan 08 was corrected (it previously used `connectorProvider` / `'meta'`). Plan 11 deliberately reads **both** `meta` and `meta_ads` tags (`META_PROVIDERS`) as harmless back-compat — leave it; with Plan 08 fixed, real rows are tagged `meta_ads`. Plan 11's inline comments still mention the old drift; ignore the prose, the code is correct.

2. **Shared infrastructure is owned by Plan 1.5** (Inngest client+route, `sendEmail`, `audit_event`+`recordAuditEvent`). **Plans 05 and 06 carry a reconciliation notice at the top** instructing you to SKIP their duplicate creation steps and import the canonical modules instead. Specifically:
   - **Plan 05:** in Task 2 create only `notification`, `notification_pref`, `skill_doc` — **not** `audit_event`; skip Plan 05's Inngest-client, email-client, `recordAuditEvent`, and `audit_event` RLS/test steps (all from Plan 1.5). Keep notifications, skills, portal shell, and register the notification-email function in the Plan 1.5 registry.
   - **Plan 06:** import `inngest` from `@/lib/inngest/client`; append the sync/webhook functions to the registry rather than recreating the client/route.
   - **Plan 14:** corrected to import the canonical client (was `src/inngest/client.ts`).
   - **Plan 04:** dependency note corrected to attribute shared infra to Plan 1.5 and import audit from `@/lib/audit/record`.

3. **Plan 05's inline plan-number cross-references are off by one** (it predates the Clients=Plan 02 insertion, so it calls Tasks "Plan 02" and Finance "Plan 03"). Use the **§1 build-order table** as the source of truth: Tasks = Plan 03, Finance = Plan 04. The function names it needs (`createTask`, invoice/payment readers) are correct; only the plan numbers are mislabeled.

4. **Email:** canonical send is `sendEmail` from `@/lib/email/resend`. Plan 05's optional `@/lib/email/client.ts` (raw `resend` instance) is redundant; prefer `sendEmail`.

5. **React + Supabase (v2.1).** PRD §0.1 and Plan 00 §2.1 lock the stack to **React (Vite) + Supabase**, evolving `riftly-dashboard`. Individual plans (especially **01**, **1.5**, **04**, **06**, **12**) still contain Next.js App Router, Drizzle, and `src/app/api/…` steps from the original pass — **do not delete that text**; treat it as the functional spec and **map paths per §2.1**. Skip `create next-app`, `middleware.ts`, Server Components, and Drizzle setup unless we explicitly revisit. Server-only work → **Supabase Edge Functions**.

---

## 5. Coverage notes

- **PRD §5.1 Founder Cockpit** → Plan 19 (was only a placeholder in Plan 01).
- **PRD §3.3 granular team permissions, §4.1/§12 Settings/user-management, §5.4 renewal alerts, §5.2 client-task & @mention notification emitters** → Plan 20.
- **Deferred by design (not bugs):** task labels (PRD §5.2 card field) — add later with the standard `organization_id`-leading + RLS pattern; client sub-roles (Client-Admin vs Viewer) — noted in PRD §3.2 as out of v1 scope.

---

## 6. Definition of done (whole suite)

For each plan: `pnpm lint && pnpm test` green *(or `npm run lint && npm test` / `bun` equivalents in `riftly-dashboard`)*, including every new RLS isolation test, and the plan's manual smoke test. For the suite: the external-integration plans (06–10, 13) additionally require the API approvals in PRD §6.4 to be in progress/granted — start those on Day 1 in parallel with Phase 1, which has no external dependencies.
