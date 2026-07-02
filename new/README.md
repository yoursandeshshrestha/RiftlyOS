# Agency OS — START HERE (read me first)

Hi Sandesh — this package is the full specification for **Agency OS**, the agency operating system (internal app + client portal). It contains the product requirements and a complete, step-by-step implementation-plan suite designed to be built **with Claude (Claude Code)**, one plan at a time.

From: Levi (Milktree). Questions: `info@milktreeagency.com`.

> **Implementation stack (v2.1 — locked):** We are **sticking to React and Supabase**, evolving the existing **`riftly-dashboard`** repo at the project root. Do **not** greenfield a Next.js app. See PRD §0.1 and Plan 00 §2.1. Individual plans may still describe Next.js/Drizzle steps from the original research pass — **adapt those steps** to the React + Supabase mapping in Plan 00 §2.1; do not delete the original plan text.

---

## 1. Read in this order

1. **`Agency-OS-PRD.md`** — the product requirements: what we're building and why, the user roles, every module, the integration architecture (how we fetch each client's GA4 / Search Console / Google Ads / Meta / GBP data + leads), invoicing, the data model, security/multi-tenancy, and the phased roadmap.
2. **`docs/plans/2026-06-28-00-conventions-and-build-order.md`** — **READ THIS BEFORE ANY OTHER PLAN.** It is the index: the exact build order, the canonical names/file-paths/enums every plan uses, and a short list of reconciliation rules. Where any plan disagrees with this file, this file wins.
3. **The plans, in the build order given in Plan 00** — `01-foundation` → `01b` (shared services) → `02`…`20`. Each plan is self-contained.

---

## 2. What's in this package

```
README.md                         <- you are here
Agency-OS-PRD.md                  <- the product spec
docs/plans/
  2026-06-28-00-...build-order.md <- the index / conventions (read first)
  2026-06-28-01-foundation.md
  2026-06-28-01b-shared-platform-services.md   (a.k.a. "Plan 1.5")
  2026-06-28-02-clients-crm.md
  ... through ...
  2026-06-28-20-settings-permissions-notifications.md   (22 plan files total)
archive/
  Agency OS — Product Requirements Document.pdf   <- SUPERSEDED first draft, kept for context only
```

> The PDF in `archive/` is the original rough draft. It is **superseded** by `Agency-OS-PRD.md` (notably: invoicing IS in scope now, and client task boards are two-way). Use the `.md`.

---

## 3. How to build it

- **Each plan is test-first (TDD)** and broken into bite-sized steps with complete, runnable code: write the failing test → run it → implement the minimum → make it pass → commit. Follow them in order; don't skip the tests (the RLS/tenant-isolation tests are the safety net for the client portal).
- **Recommended workflow:** open this folder in **Claude Code** and work through one plan at a time. A good prompt per plan: *"Implement `docs/plans/2026-06-28-NN-….md` exactly, task by task, running the tests at each step."*
- **Stack (original v2.0 spec in PRD §10):** Next.js 16 (App Router, TypeScript) on Vercel · Supabase Postgres + Auth with **row-level security** for tenant isolation · Drizzle ORM · Tailwind + shadcn/ui · dnd-kit (Kanban) · Recharts · Inngest (scheduled syncs + monthly reports) · Resend (email) · Supabase Vault (client API tokens) · Anthropic SDK (AI reports) · Stripe (invoicing/payments).
- **Stack (chosen — v2.1, see PRD §0.1 / Plan 00 §2.1):** **React (Vite) + TypeScript** + `react-router-dom` · **Supabase** (Postgres, Auth, RLS, Storage, Vault, Edge Functions) · **SQL migrations** in `supabase/migrations/` + `@supabase/supabase-js` · Tailwind + shadcn/ui · dnd-kit · Recharts · Inngest and/or Edge Functions · Resend · Anthropic SDK (server-side) · Stripe · static hosting (Vercel/Netlify) for the SPA.

---

## 4. Do this on Day 1 (it's the long pole)

The external data integrations (Google Ads, Meta, Google Business Profile, GA4/Search Console) require **API access approvals that take weeks** and are partly outside our control. **Start every approval in PRD §6.4 on day one**, in parallel with coding. Phase 1 (the whole operations app + Stripe invoicing — Plans 01–05, 19-basic, 20) is deliberately built to need **none** of these, so you can ship real value while approvals are pending.

---

## 5. Quickstart

1. Read §1 above (PRD, then Plan 00 — especially **§2.1 React + Supabase**).
2. **Evolve the existing app** at the repo root (`riftly-dashboard`) per **Plan 01** goals (tenancy, RLS, auth, app shell) — **do not** run `create next-app`. Map Plan 01 file paths using Plan 00 §2.1.
3. Then **Plan 1.5** (shared services), then continue down the build-order table in Plan 00.
4. Kick off the API-approval applications (PRD §6.4) in parallel.

---

## 6. Open questions for Levi (don't block Phase 1)

- Approximate **client count + team size** (tunes auth choice + rate-limit batching).
- ~~The **live link / repo** of the current/early build, if any.~~ **Resolved:** `riftly-dashboard` — React + Supabase.
- **E-sign** provider preference (Plan 16).
- Whether we use **CallRail / WhatConverts** for call tracking (affects the Leads module, Plan 10).
